package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/nanaaikinson/spool/internal/domain"
	"github.com/nanaaikinson/spool/internal/store"
)

func TestManagedOrganizationsAndRBAC(t *testing.T) {
	dsn, redis := os.Getenv("SPOOL_TEST_DATABASE"), os.Getenv("SPOOL_TEST_REDIS")
	if dsn == "" || redis == "" {
		t.Skip("set SPOOL_TEST_DATABASE and SPOOL_TEST_REDIS for integration")
	}
	ctx := context.Background()
	base, e := store.Open(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	schema := "rbac_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e := base.DB.ExecContext(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	defer base.DB.Close()
	defer base.DB.ExecContext(ctx, "DROP SCHEMA "+schema+" CASCADE")
	u, _ := url.Parse(dsn)
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, e := store.Open(ctx, u.String())
	if e != nil {
		t.Fatal(e)
	}
	defer db.DB.Close()
	a := testAPI(&fakeSource{})
	a.Store = db
	a.Config.MultiOrg = true
	a.Config.MetricsToken = strings.Repeat("m", 32)
	a.Config.DataKey = strings.Repeat("d", 32)
	a.Config.SetupToken = strings.Repeat("s", 32)
	a.Config.RedisURL = redis
	h := a.Handler(http.NotFoundHandler())
	request := func(method, path string, body any, cookie, org string, want int) []byte {
		t.Helper()
		raw := ""
		if body != nil {
			b, _ := json.Marshal(body)
			raw = string(b)
		}
		headers := map[string]string{"X-Spool-Action": "confirmed"}
		if cookie != "" {
			headers["Cookie"] = cookie
		}
		if org != "" {
			headers["X-Spool-Organization"] = org
		}
		w := call(h, method, path, raw, headers)
		if w.Code != want {
			t.Fatalf("%s %s returned %d, want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		return w.Body.Bytes()
	}
	setup := domain.SetupRequest{Token: "wrong", Username: "root", Password: "long-root-password", Organization: domain.OrganizationRequest{Name: "Alpha", RedisURL: redis}}
	request("POST", "/api/v1/setup", setup, "", "", 403)
	setup.Token = a.Config.SetupToken
	raw := request("POST", "/api/v1/setup", setup, "", "", 200)
	var alpha domain.Organization
	_ = json.Unmarshal(raw, &alpha)
	request("POST", "/api/v1/setup", setup, "", "", 409)
	login := func(name, password string) string {
		t.Helper()
		b, _ := json.Marshal(domain.LoginRequest{Username: name, Password: password})
		w := call(h, "POST", "/api/v1/session", string(b), nil)
		if w.Code != 200 {
			t.Fatal("login failed", w.Body.String())
		}
		return w.Result().Cookies()[0].String()
	}
	root := login("root", setup.Password)
	request("GET", "/metrics", nil, root, "", 401)
	secondRedis, _ := url.Parse(redis)
	secondRedis.Path = "/14"
	raw = request("POST", "/api/v1/organizations", domain.OrganizationRequest{Name: "Beta", RedisURL: secondRedis.String()}, root, "", 200)
	var beta domain.Organization
	_ = json.Unmarshal(raw, &beta)
	for _, role := range []string{"admin", "operator", "viewer"} {
		request("POST", "/api/v1/members", domain.MemberRequest{Username: role, Password: "long-" + role + "-password", Role: role}, root, alpha.ID, 200)
	}
	admin := login("admin", "long-admin-password")
	operator := login("operator", "long-operator-password")
	viewer := login("viewer", "long-viewer-password")
	request("GET", "/api/v1/organizations", nil, viewer, "", 200)
	request("GET", "/api/v1/queues", nil, viewer, beta.ID, 401)
	request("POST", "/api/v1/session/organization", domain.SwitchOrganizationRequest{ID: beta.ID}, viewer, "", 403)
	request("GET", "/api/v1/members", nil, viewer, "", 403)
	request("GET", "/api/v1/users", nil, admin, "", 403)
	request("POST", "/api/v1/organizations", domain.OrganizationRequest{Name: "Denied", RedisURL: redis}, admin, "", 403)
	request("PUT", "/api/v1/organization/connection", domain.OrganizationRequest{Name: "Denied", RedisURL: redis}, admin, "", 403)
	request("POST", "/api/v1/views", domain.ViewRequest{Name: "No", Path: "/tasks"}, viewer, "", 403)
	raw = request("POST", "/api/v1/views", domain.ViewRequest{Name: "Alpha only", Path: "/tasks"}, root, alpha.ID, 200)
	var view domain.SavedView
	_ = json.Unmarshal(raw, &view)
	raw = request("GET", "/api/v1/views", nil, root, beta.ID, 200)
	if strings.Contains(string(raw), view.ID) {
		t.Fatal("view leaked across organizations")
	}
	request("DELETE", "/api/v1/views/"+view.ID, domain.ActionRequest{Confirm: true}, root, beta.ID, 200)
	raw = request("GET", "/api/v1/views", nil, root, alpha.ID, 200)
	if !strings.Contains(string(raw), view.ID) {
		t.Fatal("cross-organization delete changed view")
	}
	// Same task ID and queue in different Redis databases must resolve different payloads.
	queue := "rbac-" + uuid.NewString()
	id := "same-task"
	for _, target := range []struct{ uri, payload string }{{redis, "alpha-payload"}, {secondRedis.String(), "beta-private-payload"}} {
		cfg := a.Config
		cfg.RedisURL = target.uri
		client := asynq.NewClient(cfg.Redis())
		inspector := asynq.NewInspector(cfg.Redis())
		if _, e := client.EnqueueContext(ctx, asynq.NewTask("test", []byte(target.payload)), asynq.Queue(queue), asynq.TaskID(id)); e != nil {
			t.Fatal(e)
		}
		defer client.Close()
		defer inspector.Close()
		defer inspector.DeleteQueue(queue, true)
	}
	raw = request("GET", "/api/v1/tasks/"+queue+"/"+id, nil, viewer, "", 200)
	if !strings.Contains(string(raw), "alpha-payload") || strings.Contains(string(raw), "beta-private") {
		t.Fatal("task isolation failed")
	}
	raw = request("GET", "/api/v1/tasks/"+queue+"/"+id, nil, root, beta.ID, 200)
	if !strings.Contains(string(raw), "beta-private-payload") {
		t.Fatal("organization connection not selected")
	}
	request("POST", "/api/v1/queues/"+queue+"/pause", domain.ActionRequest{Confirm: true}, viewer, "", 403)
	request("POST", "/api/v1/queues/"+queue+"/pause", domain.ActionRequest{Confirm: true}, operator, "", 200)
	op, _ := db.Authenticate(ctx, "operator", "long-operator-password")
	request("PATCH", "/api/v1/members/"+op.ID, domain.MemberRoleRequest{Role: "viewer"}, admin, "", 200)
	request("POST", "/api/v1/queues/"+queue+"/resume", domain.ActionRequest{Confirm: true}, operator, "", 403)
	request("POST", "/api/v1/members", domain.MemberRequest{Username: "operator", Role: "operator"}, root, beta.ID, 200)
	request("GET", "/api/v1/tasks/"+queue+"/"+id, nil, operator, beta.ID, 200)
	request("POST", "/api/v1/queues/"+queue+"/pause", domain.ActionRequest{Confirm: true}, operator, beta.ID, 200)
	v, _ := db.Authenticate(ctx, "viewer", "long-viewer-password")
	request("PATCH", "/api/v1/users/"+v.ID, domain.UserUpdateRequest{Disabled: new(true)}, root, "", 200)
	request("GET", "/api/v1/queues", nil, viewer, "", 401)
	request("POST", "/api/v1/account/password", domain.PasswordRequest{CurrentPassword: setup.Password, Password: "changed-root-password"}, root, "", 200)
	request("GET", "/api/v1/users", nil, root, "", 401)
	raw = request("GET", "/api/v1/session", nil, "", "", 200)
	for _, secret := range []string{a.Config.DataKey, a.Config.SetupToken, "password_hash", redis, "beta-private"} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("public session leaked private identity data")
		}
	}
}

func TestRolePermissions(t *testing.T) {
	for _, role := range []string{"admin", "operator", "viewer"} {
		c := claims{Role: role, OrganizationID: "org"}
		if !allowed("listTasks", "GET", c, false) {
			t.Fatal("role cannot read", role)
		}
		if allowed("pauseQueue", "POST", c, false) != (role != "viewer") {
			t.Fatal("task role mismatch", role)
		}
		if allowed("addMember", "POST", c, false) != (role == "admin") {
			t.Fatal("membership role mismatch", role)
		}
		if allowed("createOrganization", "POST", c, false) || allowed("listUsers", "GET", c, false) {
			t.Fatal("organization role gained deployment access", role)
		}
		if allowed("pauseQueue", "POST", c, true) {
			t.Fatal("read-only bypass", role)
		}
		if allowed("futureMutation", "POST", c, false) {
			t.Fatal("unknown mutation allowed", role)
		}
	}
}
