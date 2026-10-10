package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/nanaaikinson/spool/internal/domain"
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
