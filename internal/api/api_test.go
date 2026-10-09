package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
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
	writes int
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
	if !identifier.MatchString("email:high") {
		t.Fatal("colon queue rejected")
	}
	if validView("//evil.test/tasks") || validView("/tasks/../session") {
		t.Fatal("unsafe saved view accepted")
	}
}

func TestRealHTTPMutation(t *testing.T) {
	address, dsn := os.Getenv("SPOOL_TEST_REDIS"), os.Getenv("SPOOL_TEST_DATABASE")
	if address == "" || dsn == "" {
		t.Skip("set isolated Redis and PostgreSQL test URLs")
	}
	opt, e := asynq.ParseRedisURI(address)
	if e != nil {
		t.Fatal(e)
	}
	source := asynqadapter.New(opt)
	defer source.Close()
	db, e := store.Open(context.Background(), dsn)
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
	audits, e := db.Audits(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	count := 0
	for _, r := range audits {
		if r.Queue == q && r.Status == "succeeded" {
			count++
		}
	}
	if count != 2 {
		t.Fatalf("successful audits %d", count)
	}
}
