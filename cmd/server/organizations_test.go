package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/nanaaikinson/spool/internal/domain"
	"github.com/nanaaikinson/spool/internal/store"
)

func TestSetupCLI(t *testing.T) {
	input := `{"token":"private-token","username":"admin","password":"long-password","organization":{"name":"Alpha","redis_url":"","prometheus_url":""}}`
	f, e := os.CreateTemp(t.TempDir(), "setup")
	if e != nil {
		t.Fatal(e)
	}
	defer f.Close()
	if _, e := io.WriteString(f, input); e != nil {
		t.Fatal(e)
	}
	_, _ = f.Seek(0, 0)
	original := os.Stdin
	os.Stdin = f
	defer func() { os.Stdin = original }()
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if r.Method != "POST" || r.URL.Path != "/api/v1/setup" || r.Header.Get("X-Spool-Action") != "confirmed" {
			t.Error("invalid setup request")
		}
		var setup domain.SetupRequest
		if json.NewDecoder(r.Body).Decode(&setup) != nil || setup.Token != "private-token" || setup.Organization.Name != "Alpha" {
			t.Error("CLI did not preserve setup input")
		}
		_ = json.NewEncoder(w).Encode(domain.Organization{ID: "organization", Name: "Alpha"})
	}))
	defer server.Close()
	if e := setupCLI([]string{"--url", server.URL}); e != nil || !called {
		t.Fatal("CLI setup failed", e)
	}
	for _, address := range []string{"http://remote.example", "https://user:password@remote.example", "ftp://localhost"} {
		if e := setupCLI([]string{"--url", address}); e == nil {
			t.Fatal("unsafe CLI URL accepted")
		}
	}
	_, _ = f.Seek(0, 0)
	destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("CLI forwarded setup secrets through a redirect") }))
	defer destination.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
	}))
	defer redirect.Close()
	if e := setupCLI([]string{"--url", redirect.URL}); e == nil || !strings.Contains(e.Error(), "307") {
		t.Fatal("redirect was not rejected", e)
	}
}

func TestAdministratorRecoveryCLI(t *testing.T) {
	if e := recoverAdminCLI([]string{"recover", "--help"}); e != nil {
		t.Fatal(e)
	}
	if e := recoverAdminCLI([]string{"recover", "--username", "owner"}); e == nil {
		t.Fatal("recovery ran without confirmation")
	}
	t.Setenv("DATABASE_URL", "")
	if e := recoverAdminCLI([]string{"recover", "--username", "owner", "--confirm"}); e == nil || !strings.Contains(e.Error(), "DATABASE_URL") {
		t.Fatal("missing database URL not reported", e)
	}
	dsn := os.Getenv("SPOOL_TEST_DATABASE")
	if dsn == "" {
		t.Skip("set SPOOL_TEST_DATABASE for recovery CLI integration")
	}
	ctx := context.Background()
	base, e := store.Open(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer base.DB.Close()
	schema := "recovery_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e := base.DB.ExecContext(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	defer base.DB.ExecContext(ctx, "DROP SCHEMA "+schema+" CASCADE")
	u, _ := url.Parse(dsn)
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	t.Setenv("DATABASE_URL", u.String())
	db, e := store.Open(ctx, u.String())
	if e != nil {
		t.Fatal(e)
	}
	defer db.DB.Close()
	_, e = db.Setup(ctx, strings.Repeat("k", 32), domain.SetupRequest{Username: "owner", Password: "long-old-password", Organization: domain.OrganizationRequest{Name: "Alpha", RedisURL: "redis://unreachable.example:6379/0"}})
	if e != nil {
		t.Fatal(e)
	}
	before, _ := db.Authenticate(ctx, "owner", "long-old-password")
	input, e := os.CreateTemp(t.TempDir(), "recovery")
	if e != nil {
		t.Fatal(e)
	}
	defer input.Close()
	if _, e := io.WriteString(input, `{"password":"long-recovered-password"}`); e != nil {
		t.Fatal(e)
	}
	_, _ = input.Seek(0, 0)
	oldInput := os.Stdin
	os.Stdin = input
	defer func() { os.Stdin = oldInput }()
	if e := recoverAdminCLI([]string{"recover", "--username", "missing", "--confirm"}); e == nil {
		t.Fatal("recovery created an account")
	}
	_, _ = input.Seek(0, 0)
	if e := recoverAdminCLI([]string{"recover", "--username", "owner", "--confirm"}); e != nil {
		t.Fatal(e)
	}
	after, e := db.Authenticate(ctx, "owner", "long-recovered-password")
	if e != nil || after.AuthVersion == before.AuthVersion {
		t.Fatal("CLI did not recover and revoke sessions", e)
	}
	for _, value := range []string{`{"password":"too-short"}`, `{"password":"long-password","token":"unexpected"}`, `{"password":"long-password"} {}`, `{"password":"long-password"}` + strings.Repeat(" ", 1024)} {
		if e := input.Truncate(0); e != nil {
			t.Fatal(e)
		}
		_, _ = input.Seek(0, 0)
		_, _ = io.WriteString(input, value)
		_, _ = input.Seek(0, 0)
		if e := recoverAdminCLI([]string{"recover", "--username", "owner", "--confirm"}); e == nil {
			t.Fatal("invalid recovery input accepted")
		}
	}
}
