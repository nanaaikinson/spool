package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/hibiken/asynq"
	"github.com/nanaaikinson/spool/internal/asynqadapter"
	"github.com/nanaaikinson/spool/internal/config"
	"github.com/nanaaikinson/spool/internal/domain"
	"github.com/nanaaikinson/spool/internal/events"
	"github.com/nanaaikinson/spool/internal/metrics"
	"github.com/nanaaikinson/spool/internal/store"
)

type fakeSource struct {
	asynqadapter.Source
	writes      int
	groupQueue  string
	groupSample int
	filter      domain.TaskFilter
}

func (f *fakeSource) Tasks(_ context.Context, filter domain.TaskFilter) (domain.TaskList, error) {
	f.filter = filter
	return domain.TaskList{}, nil
}

func (f *fakeSource) QueueAction(context.Context, string, string) error {
	f.writes++
	return nil
}

func (f *fakeSource) TaskAction(context.Context, string, string, string) error {
	f.writes++
	return nil
}

func (f *fakeSource) Queues(context.Context) ([]domain.Queue, error) {
	return []domain.Queue{}, nil
}

func (f *fakeSource) ErrorGroups(_ context.Context, queue string, sample int) (domain.ErrorGroupList, error) {
	f.groupQueue, f.groupSample = queue, sample
	return domain.ErrorGroupList{Data: []domain.ErrorGroup{}}, nil
}

func testAPI(source asynqadapter.Source) *API {
	return &API{
		Config:  config.Config{Environment: "test", SessionKey: strings.Repeat("a", 32)},
		Source:  source,
		Metrics: metrics.New(""),
		Events:  events.New(),
		Log:     slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
}

func call(h http.Handler, method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestMutationBoundaries(t *testing.T) {
	s := &fakeSource{}
	a := testAPI(s)
	h := a.Handler(http.NotFoundHandler())
	for _, tc := range []struct {
		body   string
		header map[string]string
		want   int
	}{
		{`{"confirm":true}`, nil, 403},
		{`{"confirm":false}`, map[string]string{"X-Spool-Action": "confirmed"}, 422},
		{
			`{"confirm":true}`,
			map[string]string{"X-Spool-Action": "confirmed", "Origin": "https://evil.test"},
			403,
		},
		{`{"confirm":true}`, map[string]string{"X-Spool-Action": "confirmed"}, 503},
		{`{"confirm":true,"extra":1}`, map[string]string{"X-Spool-Action": "confirmed"}, 400},
	} {
		w := call(h, "POST", "/api/v1/queues/default/pause", tc.body, tc.header)
		if w.Code != tc.want {
			t.Fatalf("got %d want %d: %s", w.Code, tc.want, w.Body.String())
		}
		var e domain.Error
		if json.Unmarshal(w.Body.Bytes(), &e) != nil || e.Code == "" {
			t.Fatal("structured errors required")
		}
	}
	if s.writes != 0 {
		t.Fatal("mutation reached Redis without confirmation/audit")
	}
	a.Config.ReadOnly = true
	w := call(
		h,
		"POST",
		"/api/v1/queues/default/pause",
		`{"confirm":true}`,
		map[string]string{"X-Spool-Action": "confirmed"},
	)
	if w.Code != 403 {
		t.Fatal("read-only mutation allowed")
	}
}

func TestSessionsAndRole(t *testing.T) {
	s := &fakeSource{}
	a := testAPI(s)
	a.Config.AdminUser = "admin"
	a.Config.AdminPassword = "admin-test"
	a.Config.ViewerUser = "viewer"
	a.Config.ViewerPassword = "viewer-test"
	h := a.Handler(http.NotFoundHandler())
	if w := call(h, "GET", "/api/v1/queues", "", nil); w.Code != 401 {
		t.Fatal("unauthenticated read allowed")
	}
	w := call(h, "POST", "/api/v1/session", `{"username":"viewer","password":"viewer-test"}`, nil)
	if w.Code != 200 || len(w.Result().Cookies()) != 1 {
		t.Fatal("login", w.Body.String())
	}
	cookie := w.Result().Cookies()[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatal("unsafe session cookie")
	}
	r := httptest.NewRequest("POST", "/api/v1/queues/default/pause", strings.NewReader(`{"confirm":true}`))
	r.AddCookie(cookie)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Spool-Action", "confirmed")
	result := httptest.NewRecorder()
	h.ServeHTTP(result, r)
	if result.Code != 403 || s.writes != 0 {
		t.Fatal("viewer acquired write access")
	}
	cookie.Value += "tampered"
	r = httptest.NewRequest("GET", "/api/v1/queues", nil)
	r.AddCookie(cookie)
	result = httptest.NewRecorder()
	h.ServeHTTP(result, r)
	if result.Code != 401 {
		t.Fatal("tampered cookie accepted")
	}
}

func TestServerLogsAreAdminOnly(t *testing.T) {
	ctx := context.Background()
	db, e := store.Open(ctx, filepath.Join(t.TempDir(), "spool.db"))
	if e != nil {
		t.Fatal(e)
	}
	defer db.DB.Close()
	if e := db.RecordServerLogs(ctx, []domain.ServerLog{{Time: time.Now(), Level: "ERROR", Message: "request failed"}}); e != nil {
		t.Fatal(e)
	}
	a := testAPI(&fakeSource{})
	a.Store = db
	a.Config.AdminUser, a.Config.AdminPassword = "admin", "admin-test"
	a.Config.ViewerUser, a.Config.ViewerPassword = "viewer", "viewer-test"
	// Read-only mode demotes the administrator to viewer for changes, not logs.
	a.Config.ReadOnly = true
	h := a.Handler(http.NotFoundHandler())
	logs := func(user, password string, path ...string) *httptest.ResponseRecorder {
		w := call(h, "POST", "/api/v1/session", `{"username":"`+user+`","password":"`+password+`"}`, nil)
		target := "/api/v1/logs?limit=10"
		if len(path) > 0 {
			target = path[0]
		}
		r := httptest.NewRequest("GET", target, nil)
		r.AddCookie(w.Result().Cookies()[0])
		result := httptest.NewRecorder()
		h.ServeHTTP(result, r)
		return result
	}
	if w := logs("viewer", "viewer-test"); w.Code != 403 {
		t.Fatalf("viewer: %d %s", w.Code, w.Body.String())
	}
	w := logs("admin", "admin-test")
	var list domain.ServerLogList
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &list) != nil || len(list.Data) != 1 || list.Data[0].Message != "request failed" {
		t.Fatalf("admin: %d %s", w.Code, w.Body.String())
	}
	var hist domain.LogHistogram
	w = logs("admin", "admin-test", "/api/v1/logs/histogram?q=level:error")
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &hist) != nil || hist.Total != 1 || hist.StepSeconds != 60 {
		t.Fatalf("histogram: %d %s", w.Code, w.Body.String())
	}
	if w = logs("viewer", "viewer-test", "/api/v1/logs/histogram"); w.Code != 403 {
		t.Fatalf("viewer histogram: %d", w.Code)
	}
	if w = logs("admin", "admin-test", "/api/v1/logs?start=2026-01-02T00:00:00Z&end=2026-01-01T00:00:00Z"); w.Code != 422 {
		t.Fatalf("inverted range: %d", w.Code)
	}
}

func TestRequestLinesUseAccessLogger(t *testing.T) {
	var server, access bytes.Buffer
	a := testAPI(&fakeSource{})
	a.Log = slog.New(slog.NewJSONHandler(&server, nil))
	a.Access = slog.New(slog.NewJSONHandler(&access, nil))
	call(a.Handler(http.NotFoundHandler()), "GET", "/api/v1/queues", "", nil)
	if strings.Contains(server.String(), "http request") || !strings.Contains(access.String(), `"route":"/api/v1/queues"`) {
		t.Fatalf("server log %q, access log %q", server.String(), access.String())
	}
}

func TestContractAndFilters(t *testing.T) {
	b, e := OpenAPI()
	if e != nil {
		t.Fatal(e)
	}
	doc, e := openapi3.NewLoader().LoadFromData(b)
	if e != nil {
		t.Fatal(e)
	}
	if e = doc.Validate(context.Background()); e != nil {
		t.Fatal(e)
	}
	if doc.OpenAPI != "3.1.0" {
		t.Fatal("contract version")
	}
	a := testAPI(&fakeSource{})
	h := a.Handler(http.NotFoundHandler())
	for _, query := range []string{
		"limit=101",
		"min_retry=-1",
		"state=unknown",
		"state=aggregating",
		"failed_after=invalid",
		"cursor=" + strings.Repeat("x", 2049),
	} {
		w := call(h, "GET", "/api/v1/tasks?"+query, "", nil)
		if w.Code != 422 {
			t.Fatalf("filter %s: %d %s", query, w.Code, w.Body.String())
		}
	}
	for _, query := range []string{"limit=49", "limit=1001", "limit=many", "queue=" + strings.Repeat("q", 201)} {
		w := call(h, "GET", "/api/v1/failures/groups?"+query, "", nil)
		if w.Code != 422 {
			t.Fatalf("groups %s: %d %s", query, w.Code, w.Body.String())
		}
	}
	groups := &fakeSource{}
	w := call(testAPI(groups).Handler(http.NotFoundHandler()), "GET", "/api/v1/failures/groups?queue=critical", "", nil)
	if w.Code != 200 || groups.groupQueue != "critical" || groups.groupSample != 500 {
		t.Fatalf("groups defaults: %d %s %+v", w.Code, w.Body.String(), groups)
	}
	if !identifier.MatchString("email:high") {
		t.Fatal("colon queue rejected")
	}
	if validView("//evil.test/tasks") || validView("/tasks/../session") {
		t.Fatal("unsafe saved view accepted")
	}
}

func TestEndpointHandlers(t *testing.T) {
	ids := map[string]bool{}
	for _, ep := range Endpoints() {
		if ep.Handle == nil {
			t.Errorf("%s %s has no handler", ep.Method, ep.Path)
		}
		if ids[ep.ID] {
			t.Errorf("duplicate endpoint ID %s", ep.ID)
		}
		ids[ep.ID] = true
	}
}

func TestParseQuery(t *testing.T) {
	ps := []Parameter{
		{Name: "metric", Type: "string", Required: true, Enum: []string{"depth", "latency", "failed"}},
		n("limit", "", 1, 100),
		n("page", "", 1, 1000000),
		{Name: "min", Type: "integer", Minimum: new(0)},
	}
	for query, want := range map[string]string{
		"":                           "metric is required.",
		"metric=bogus":               "metric must be one of depth, latency, or failed.",
		"metric=depth&limit=0":       "limit must be a whole number from 1 to 100.",
		"metric=depth&limit=101":     "limit must be a whole number from 1 to 100.",
		"metric=depth&limit=ten":     "limit must be a whole number from 1 to 100.",
		"metric=depth&limit=1.5":     "limit must be a whole number from 1 to 100.",
		"metric=depth&page=1000001":  "page must be a whole number from 1 to 1,000,000.",
		"metric=depth&min=-1":        "min must be a whole number of 0 or more.",
		"metric=depth&limit=5&min=x": "min must be a whole number of 0 or more.",
	} {
		v, _ := url.ParseQuery(query)
		_, f := parseQuery(ps, v)
		if f == nil || len(f.Reasons) != 1 || f.Reasons[0] != want {
			t.Errorf("%q: got %+v, want %q", query, f, want)
		}
	}
	v, _ := url.ParseQuery("metric=latency&limit=100&page=&other=x")
	ints, f := parseQuery(ps, v)
	if f != nil || len(ints) != 1 || ints["limit"] != 100 {
		t.Fatalf("valid query: %v %+v", ints, f)
	}
	if p := (params{ints: ints}); p.int("limit", 5) != 100 || p.int("page", 7) != 7 {
		t.Fatal("params fallback")
	}
}

func TestQueryValidation(t *testing.T) {
	s := &fakeSource{}
	h := testAPI(s).Handler(http.NotFoundHandler())
	for path, field := range map[string]string{
		"/api/v1/tasks?limit=0":                                          "limit",
		"/api/v1/tasks?limit=abc":                                        "limit",
		"/api/v1/tasks?min_retry=100001":                                 "min_retry",
		"/api/v1/tasks?state=done":                                       "state",
		"/api/v1/failures/groups?limit=1001":                             "limit",
		"/api/v1/failures/groups?limit=5e2":                              "limit",
		"/api/v1/audit?page=0":                                           "page",
		"/api/v1/audit?limit=101":                                        "limit",
		"/api/v1/audit?page=two":                                         "page",
		"/api/v1/metrics/query":                                          "metric",
		"/api/v1/metrics/query?metric=cpu":                               "metric",
		"/api/v1/metrics/query-range?metric=depth":                       "start",
		"/api/v1/metrics/query-range?metric=depth&start=a&end=b&step=14": "step",
	} {
		w := call(h, "GET", path, "", nil)
		var e domain.Error
		if w.Code != 422 || json.Unmarshal(w.Body.Bytes(), &e) != nil || e.Code != "VALIDATION_ERROR" ||
			len(e.Details.Fields) != 1 || e.Details.Fields[0].Field != field ||
			!strings.HasPrefix(e.Message, field+" ") || w.Header().Get("Content-Type") != "application/json" {
			t.Errorf("%s: %d %s", path, w.Code, w.Body.String())
		}
	}
	w := call(h, "GET", "/api/v1/tasks?limit=100&min_retry=3&state=failed", "", nil)
	if w.Code != 200 || s.filter.Limit != 100 || s.filter.MinRetry != 3 || s.filter.State != "failed" {
		t.Fatalf("valid tasks: %d %s %+v", w.Code, w.Body.String(), s.filter)
	}
	if w = call(h, "GET", "/api/v1/tasks", "", nil); w.Code != 200 || s.filter.Limit != 50 || s.filter.MinRetry != 0 {
		t.Fatalf("task defaults: %d %+v", w.Code, s.filter)
	}
	if w = call(h, "GET", "/api/v1/failures/groups?limit=50", "", nil); w.Code != 200 || s.groupSample != 50 {
		t.Fatalf("valid groups: %d %s", w.Code, w.Body.String())
	}
	// Valid parameters reach the handler, which then reports the missing dependency.
	for _, path := range []string{
		"/api/v1/audit?page=2&limit=100",
		"/api/v1/metrics/query?metric=depth",
		"/api/v1/metrics/query-range?metric=depth&start=2026-01-01T00:00:00Z&end=2026-01-01T01:00:00Z&step=15",
	} {
		if w = call(h, "GET", path, "", nil); w.Code != 503 {
			t.Errorf("%s: %d %s", path, w.Code, w.Body.String())
		}
	}
	if w = call(h, "GET", "/api/v1/metrics/query-range?metric=depth&start=2026-01-02T00:00:00Z&end=2026-01-01T00:00:00Z", "", nil); w.Code != 422 {
		t.Errorf("inverted range: %d", w.Code)
	}
}

func TestRealHTTPMutation(t *testing.T) {
	address := os.Getenv("SPOOL_TEST_REDIS")
	if address == "" {
		t.Skip("set an isolated Redis test URL")
	}
	opt, e := asynq.ParseRedisURI(address)
	if e != nil {
		t.Fatal(e)
	}
	source := asynqadapter.New(opt)
	defer source.Close()
	db, e := store.Open(context.Background(), filepath.Join(t.TempDir(), "spool.db"))
	if e != nil {
		t.Fatal(e)
	}
	defer db.DB.Close()
	a := testAPI(source)
	a.Store = db
	server := httptest.NewServer(a.Handler(http.NotFoundHandler()))
	defer server.Close()
	client := asynq.NewClient(opt)
	defer client.Close()
	q := "http-test-" + time.Now().Format("150405.000000000")
	inspector := asynq.NewInspector(opt)
	defer inspector.Close()
	defer inspector.DeleteQueue(q, true)
	task, e := client.Enqueue(asynq.NewTask("test:task", []byte(`{"safe":true}`)), asynq.Queue(q))
	if e != nil {
		t.Fatal(e)
	}
	for _, action := range []string{"archive", "retry"} {
		req, _ := http.NewRequest(
			"POST",
			server.URL+"/api/v1/tasks/"+q+"/"+task.ID+"/"+action,
			bytes.NewBufferString(`{"confirm":true}`),
		)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Spool-Action", "confirmed")
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		res.Body.Close()
		if res.StatusCode != 200 {
			t.Fatalf("real %s failed: %d", action, res.StatusCode)
		}
	}
	audits, e := db.Audits(context.Background(), 1, 100)
	if e != nil {
		t.Fatal(e)
	}
	count := 0
	for _, r := range audits.Data {
		if r.Queue == q && r.Status == "succeeded" {
			count++
		}
	}
	if count != 2 {
		t.Fatalf("successful audits %d", count)
	}
	for path, want := range map[string]int{"/api/v1/audit?page=1&limit=100": 200, "/api/v1/audit?limit=101": 422} {
		res, e := http.Get(server.URL + path)
		if e != nil {
			t.Fatal(e)
		}
		res.Body.Close()
		if res.StatusCode != want {
			t.Fatalf("%s: %d want %d", path, res.StatusCode, want)
		}
	}
}

func TestStaticBrandAssets(t *testing.T) {
	dir := t.TempDir()
	for name, body := range map[string]string{
		"index.html":       "<!doctype html>",
		"site.webmanifest": `{"name":"Spool"}`,
		"favicon.ico":      "\x00\x00\x01\x00",
	} {
		if e := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); e != nil {
			t.Fatal(e)
		}
	}
	a := testAPI(&fakeSource{})
	a.Config.StaticDir = dir
	h := a.Handler(http.NotFoundHandler())
	for path, want := range map[string]string{
		"/site.webmanifest": "application/manifest+json",
		"/favicon.ico":      "image/x-icon",
		"/queues":           "text/html; charset=utf-8",
	} {
		w := call(h, "GET", path, "", nil)
		if w.Code != 200 || w.Header().Get("Content-Type") != want {
			t.Fatalf("%s: %d %q, want %q", path, w.Code, w.Header().Get("Content-Type"), want)
		}
	}
}

func TestMetricsScrapeToken(t *testing.T) {
	a := testAPI(&fakeSource{})
	a.Config.AdminUser, a.Config.AdminPassword = "admin", "secret"
	a.Config.MetricsToken = strings.Repeat("m", 64)
	calls := 0
	h := a.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Write([]byte("sample_metric 1\n"))
	}))
	for _, authorization := range []string{"", "Bearer wrong", "Basic " + a.Config.MetricsToken, "Bearer " + a.Config.MetricsToken + "extra"} {
		w := call(h, "GET", "/metrics", "", map[string]string{"Authorization": authorization})
		if w.Code != 401 || w.Header().Get("WWW-Authenticate") == "" || strings.Contains(w.Body.String(), a.Config.MetricsToken) {
			t.Fatalf("unauthorized scrape: %d %s", w.Code, w.Body.String())
		}
	}
	w := call(h, "GET", "/metrics?token="+a.Config.MetricsToken, "", nil)
	if w.Code != 401 || calls != 0 {
		t.Fatal("unauthorized requests must not reach the collector")
	}
	login := call(h, "POST", "/api/v1/session", `{"username":"admin","password":"secret"}`, nil)
	if login.Code != 200 || len(login.Result().Cookies()) == 0 {
		t.Fatalf("login failed: %d", login.Code)
	}
	w = call(h, "GET", "/metrics", "", map[string]string{"Cookie": login.Result().Cookies()[0].String()})
	if w.Code != 401 || calls != 0 {
		t.Fatal("console cookies must not authorize metrics scrapes")
	}
	headers := map[string]string{"Authorization": "Bearer " + a.Config.MetricsToken}
	w = call(h, "GET", "/metrics", "", headers)
	if w.Code != 200 || w.Body.String() != "sample_metric 1\n" || calls != 1 {
		t.Fatal("valid scrape token did not reach collector")
	}
	w = call(h, "GET", "/api/v1/queues", "", headers)
	if w.Code != 401 {
		t.Fatal("metrics token must not grant console API access")
	}
	// Existing deployments remain compatible when no token is configured.
	a.Config.MetricsToken = ""
	w = call(h, "GET", "/metrics", "", nil)
	if w.Code != 200 || calls != 2 {
		t.Fatal("unconfigured scrape endpoint must remain accessible")
	}
}

// Error text deliberately contains credentials to verify diagnostics cannot leak them.
type disconnectedSource struct{ fakeSource }

func (s *disconnectedSource) Queues(context.Context) ([]domain.Queue, error) {
	return nil, fmt.Errorf("redis://user:private-password@secret-host/0")
}

func TestFailureLogsCallerAndRedactsCredentials(t *testing.T) {
	var out bytes.Buffer
	a := testAPI(&disconnectedSource{})
	a.Log = slog.New(slog.NewJSONHandler(&out, &slog.HandlerOptions{AddSource: true}))
	if w := call(a.Handler(http.NotFoundHandler()), "GET", "/api/v1/queues", "", nil); w.Code != 503 {
		t.Fatalf("status = %d", w.Code)
	}
	var entry struct {
		Msg    string
		Error  string
		Source struct{ File string }
	}
	for _, line := range bytes.Split(bytes.TrimSpace(out.Bytes()), []byte("\n")) {
		if json.Unmarshal(line, &entry) == nil && entry.Msg == "request failed" {
			break
		}
	}
	if entry.Msg != "request failed" || !strings.HasSuffix(entry.Source.File, "/internal/api/queues.go") {
		t.Fatalf("caller = %q in %s", entry.Source.File, out.String())
	}
	if strings.Contains(entry.Error, "private-password") || !strings.Contains(entry.Error, "secret-host") {
		t.Fatalf("error = %q", entry.Error)
	}
}

func TestDeploymentDiagnostics(t *testing.T) {
	a := testAPI(&fakeSource{})
	a.Config.InstanceName, a.Config.Environment = "Acme operations", "production"
	a.Config.SupportURL = "https://support.example.com"
	h := a.Handler(http.NotFoundHandler())
	w := call(h, "GET", "/api/v1/status", "", nil)
	var status domain.DeploymentStatus
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &status) != nil || !status.Redis.Available || status.QueueCount != 0 || status.Database.Configured || status.Metrics.Configured || status.CheckedAt.IsZero() {
		t.Fatalf("diagnostics: %d %s", w.Code, w.Body.String())
	}
	a.Source = &disconnectedSource{}
	a.Config.DatabasePath = "/secret-host/private-password/spool.db"
	w = call(h, "GET", "/api/v1/status", "", nil)
	if json.Unmarshal(w.Body.Bytes(), &status) != nil || status.Redis.Available || !status.Database.Configured || status.Database.Available {
		t.Fatal("failed connections reported healthy")
	}
	if strings.Contains(w.Body.String(), "private-password") || strings.Contains(w.Body.String(), "secret-host") {
		t.Fatal("diagnostics exposed a connection secret")
	}
	a.Config.AdminUser, a.Config.AdminPassword = "admin", "secret"
	if w = call(h, "GET", "/api/v1/status", "", nil); w.Code != 401 {
		t.Fatal("diagnostics must require sign-in")
	}
	w = call(h, "GET", "/api/v1/session", "", nil)
	var session domain.Session
	if json.Unmarshal(w.Body.Bytes(), &session) != nil || session.InstanceName != "Acme operations" || session.SupportURL != a.Config.SupportURL {
		t.Fatal("safe sign-in metadata missing")
	}
	if strings.Contains(w.Body.String(), "private-password") || strings.Contains(w.Body.String(), "secret-host") {
		t.Fatal("session exposed a connection secret")
	}
}

type slowSource struct {
	fakeSource
	started chan struct{}
	release chan struct{}
}

func (s *slowSource) Queues(context.Context) ([]domain.Queue, error) {
	close(s.started)
	<-s.release
	return nil, fmt.Errorf("private-password")
}

func TestDiagnosticsCancellationDoesNotWaitForInspector(t *testing.T) {
	source := &slowSource{started: make(chan struct{}), release: make(chan struct{})}
	defer close(source.release)
	a := testAPI(source)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request := httptest.NewRequest("GET", "/api/v1/status", nil).WithContext(ctx)
	response := httptest.NewRecorder()
	finished := make(chan struct{})
	go func() { a.Handler(http.NotFoundHandler()).ServeHTTP(response, request); close(finished) }()
	select {
	case <-source.started:
	case <-time.After(time.Second):
		t.Fatal("Inspector check did not start")
	}
	cancel()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("diagnostics waited for an Inspector call that ignored cancellation")
	}
	var status domain.DeploymentStatus
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &status) != nil || status.Redis.Available {
		t.Fatal("cancelled check must remain unavailable")
	}
}

type redisSource struct {
	fakeSource
	err error
}

func (s *redisSource) Redis(context.Context) (domain.RedisInfo, error) {
	return domain.RedisInfo{Version: "7.4.1", UsedMemoryBytes: 1 << 20}, s.err
}

func TestRedisInfo(t *testing.T) {
	s := &redisSource{}
	a := testAPI(s)
	h := a.Handler(http.NotFoundHandler())
	var info domain.RedisInfo
	w := call(h, "GET", "/api/v1/redis", "", nil)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &info) != nil || info.Version != "7.4.1" || info.UsedMemoryBytes != 1<<20 {
		t.Fatalf("redis info: %d %s", w.Code, w.Body.String())
	}
	s.err = fmt.Errorf("redis://user:private-password@secret-host/0")
	w = call(h, "GET", "/api/v1/redis", "", nil)
	if w.Code != 503 || strings.Contains(w.Body.String(), "private-password") || strings.Contains(w.Body.String(), "secret-host") {
		t.Fatalf("failure must be fixed text: %d %s", w.Code, w.Body.String())
	}
}
