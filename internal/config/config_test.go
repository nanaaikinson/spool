package config

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/hibiken/asynq"
)

func TestRedisCredentials(t *testing.T) {
	for _, tc := range []struct {
		name     string
		uri      string
		username string
		password string
		db       int
		tls      bool
	}{
		{"password only", "redis://:secret@redis.example.com:6379/2", "", "secret", 2, false},
		{
			"ACL user",
			"redis://spool:secret%40%3A%2F@redis.example.com:6379/4",
			"spool",
			"secret@:/",
			4,
			false,
		},
		{"TLS and ACL user", "rediss://spool:secret@redis.example.com:6380/0", "spool", "secret", 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			opt, ok := (Config{RedisURL: tc.uri}).Redis().(asynq.RedisClientOpt)
			if !ok {
				t.Fatal("expected a RedisClientOpt")
			}
			if opt.Username != tc.username || opt.Password != tc.password || opt.DB != tc.db {
				t.Fatal("Redis credentials or database were not preserved")
			}
			if (opt.TLSConfig != nil) != tc.tls {
				t.Fatal("unexpected TLS configuration")
			}
			if tc.tls && opt.TLSConfig.ServerName != "redis.example.com" {
				t.Fatal("TLS server name was not preserved")
			}
		})
	}
}

func TestReadOnlyWithoutDatabase(t *testing.T) {
	t.Setenv("REDIS_URL", "redis://127.0.0.1:6379/0")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("DATABASE_PATH", "")
	t.Setenv("SPOOL_READ_ONLY", "false")
	c, e := Load()
	if e != nil {
		t.Fatal(e)
	}
	if !c.ReadOnly || c.ReadOnlyReason != "no_database" {
		t.Fatalf("read only = %v (%q), want no_database", c.ReadOnly, c.ReadOnlyReason)
	}
	t.Setenv("DATABASE_PATH", "/data/spool.db")
	if c, e = Load(); e != nil || c.ReadOnly || c.ReadOnlyReason != "" {
		t.Fatalf("with database: %v %v %q", e, c.ReadOnly, c.ReadOnlyReason)
	}
	// A leftover PostgreSQL URL must not silently drop to read-only.
	t.Setenv("DATABASE_URL", "postgres://spool@localhost/spool")
	if _, e = Load(); e == nil || !strings.Contains(e.Error(), "DATABASE_URL") {
		t.Fatalf("legacy DATABASE_URL accepted: %v", e)
	}
	t.Setenv("DATABASE_URL", "")
	t.Setenv("SPOOL_READ_ONLY", "true")
	if c, e = Load(); e != nil || !c.ReadOnly || c.ReadOnlyReason != "configured" {
		t.Fatalf("configured: %v %v %q", e, c.ReadOnly, c.ReadOnlyReason)
	}
}

func TestLogRetention(t *testing.T) {
	t.Setenv("REDIS_URL", "redis://127.0.0.1:6379/0")
	t.Setenv("DATABASE_URL", "")
	for value, want := range map[string]time.Duration{"": 72 * time.Hour, "7d": 7 * 24 * time.Hour, "36h": 36 * time.Hour} {
		if value == "" {
			os.Unsetenv("SPOOL_LOG_RETENTION")
		} else {
			t.Setenv("SPOOL_LOG_RETENTION", value)
		}
		if c, e := Load(); e != nil || c.LogRetention != want {
			t.Errorf("%q: %v, %v; want %v", value, c.LogRetention, e, want)
		}
	}
	for _, bad := range []string{"30m", "400d", "3 days", "-1d"} {
		t.Setenv("SPOOL_LOG_RETENTION", bad)
		if _, e := Load(); e == nil || !strings.Contains(e.Error(), "SPOOL_LOG_RETENTION") {
			t.Errorf("%q accepted: %v", bad, e)
		}
	}
}

func writeCA(t *testing.T) string {
	t.Helper()
	key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
	}
	der, e := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if e != nil {
		t.Fatal(e)
	}
	path := filepath.Join(t.TempDir(), "ca.pem")
	if e := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600); e != nil {
		t.Fatal(e)
	}
	return path
}

func TestRedisTLSFiles(t *testing.T) {
	ca := writeCA(t)
	t.Setenv("DATABASE_URL", "")
	t.Setenv("REDIS_TLS_CA_FILE", ca)

	t.Setenv("REDIS_URL", "redis://redis.example.com:6379/0")
	if _, e := Load(); e == nil || !strings.Contains(e.Error(), "rediss://") {
		t.Fatalf("plain redis:// with TLS files: %v", e)
	}

	t.Setenv("REDIS_URL", "rediss://redis.example.com:6380/0")
	c, e := Load()
	if e != nil {
		t.Fatal(e)
	}
	opt := c.Redis().(asynq.RedisClientOpt)
	if opt.TLSConfig == nil || opt.TLSConfig.RootCAs == nil || opt.TLSConfig.ServerName != "redis.example.com" {
		t.Fatalf("TLS config not applied: %+v", opt.TLSConfig)
	}

	t.Setenv("REDIS_URL", "redis-sentinel://sentinel.example.com:26379?master=main")
	if c, e = Load(); e != nil {
		t.Fatal(e)
	}
	if failover := c.Redis().(asynq.RedisFailoverClientOpt); failover.TLSConfig == nil || failover.TLSConfig.RootCAs == nil {
		t.Fatal("sentinel connection did not get TLS")
	}

	t.Setenv("REDIS_TLS_CA_FILE", filepath.Join(t.TempDir(), "missing.pem"))
	if _, e := Load(); e == nil {
		t.Fatal("missing CA file accepted")
	}
	t.Setenv("REDIS_TLS_CA_FILE", "")
	t.Setenv("REDIS_TLS_CERT_FILE", ca)
	if _, e := Load(); e == nil || !strings.Contains(e.Error(), "REDIS_TLS_KEY_FILE") {
		t.Fatalf("certificate without key: %v", e)
	}
}

func TestRedisTargetHidesCredentials(t *testing.T) {
	for uri, want := range map[string]string{
		"redis://:secret@redis.example.com:6379/2":           "redis://redis.example.com:6379 db 2",
		"rediss://spool:secret@redis.example.com:6380":       "rediss://redis.example.com:6380 db 0",
		"redis-sentinel://:pw@s1:26379,s2:26379?master=main": "redis-sentinel://s1:26379,s2:26379 db 0",
		"redis-socket://:secret@/var/run/redis.sock?db=3":    "redis-socket:///var/run/redis.sock db 3",
	} {
		got := (Config{RedisURL: uri}).RedisTarget()
		if got != want {
			t.Errorf("RedisTarget(%q) = %q, want %q", uri, got, want)
		}
		if strings.Contains(got, "secret") || strings.Contains(got, "pw") {
			t.Errorf("RedisTarget(%q) leaked a credential: %q", uri, got)
		}
	}
}

func TestRedisSentinelOptions(t *testing.T) {
	opt, ok := (Config{
		RedisURL: "redis-sentinel://spool:master%40pw@s1:26379,s2:26379/3?master=main&sentinel_password=sentinel-pw",
	}).Redis().(asynq.RedisFailoverClientOpt)
	if !ok {
		t.Fatal("not a failover option")
	}
	if opt.MasterName != "main" || len(opt.SentinelAddrs) != 2 || opt.DB != 3 {
		t.Fatalf("addresses or database wrong: %+v", opt)
	}
	if opt.Username != "spool" || opt.Password != "master@pw" || opt.SentinelPassword != "sentinel-pw" {
		t.Fatalf("credentials wrong: user %q, password %q, sentinel %q", opt.Username, opt.Password, opt.SentinelPassword)
	}
	// Without sentinel_password, one password covers both, as Asynq does.
	shared := (Config{RedisURL: "redis-sentinel://:pw@s1:26379?master=main"}).Redis().(asynq.RedisFailoverClientOpt)
	if shared.Password != "pw" || shared.SentinelPassword != "pw" || shared.DB != 0 {
		t.Fatalf("shared password: %+v", shared)
	}
}

func TestMetricsTokenValidation(t *testing.T) {
	for _, token := range []string{"", strings.Repeat("a", 32), "short", strings.Repeat("a", 32) + "\n"} {
		t.Setenv("SPOOL_METRICS_TOKEN", token)
		c, err := Load()
		valid := token == "" || token == strings.Repeat("a", 32)
		if valid && (err != nil || c.MetricsToken != token) {
			t.Fatalf("valid token configuration failed: %v", err)
		}
		if !valid && (err == nil || strings.Contains(err.Error(), token)) {
			t.Fatal("invalid token must produce an error without the secret")
		}
	}
}

func TestDeploymentMetadata(t *testing.T) {
	t.Setenv("SPOOL_ENV", "staging")
	t.Setenv("SPOOL_INSTANCE_NAME", "")
	t.Setenv("SPOOL_SUPPORT_URL", "")
	c, err := Load()
	if err != nil || c.InstanceName != "staging" {
		t.Fatalf("metadata defaults: %v", err)
	}
	t.Setenv("SPOOL_INSTANCE_NAME", "Acme operations")
	for _, link := range []string{"https://support.example.com/help", "mailto:support@example.com"} {
		t.Setenv("SPOOL_SUPPORT_URL", link)
		c, err = Load()
		if err != nil || c.InstanceName != "Acme operations" || c.SupportURL != link {
			t.Fatalf("valid metadata rejected: %v", err)
		}
	}
	for _, link := range []string{"javascript:alert(1)", "http://support.example.com", "https://user:secret@support.example.com", "//support.example.com", "mailto:"} {
		t.Setenv("SPOOL_SUPPORT_URL", link)
		if _, err = Load(); err == nil {
			t.Fatal("unsafe support link accepted")
		}
	}
}

func TestDefaultCredentialsAndSessionKey(t *testing.T) {
	t.Setenv("REDIS_URL", "redis://127.0.0.1:6379/0")
	t.Setenv("DATABASE_URL", "")
	for _, k := range []string{"SPOOL_ADMIN_USER", "SPOOL_ADMIN_PASSWORD", "SPOOL_VIEWER_USER", "SPOOL_VIEWER_PASSWORD", "SPOOL_SESSION_KEY"} {
		t.Setenv(k, "")
	}
	// Loopback keeps sign-in off.
	t.Setenv("SPOOL_ADDR", "127.0.0.1:8088")
	if c, e := Load(); e != nil || c.AdminUser != "" || c.DefaultCredentials || c.GeneratedSessionKey {
		t.Fatalf("loopback: %v %+v", e, c)
	}
	// Beyond loopback, defaults apply and a session key is generated.
	t.Setenv("SPOOL_ADDR", "0.0.0.0:8003")
	c, e := Load()
	if e != nil || c.AdminUser != "admin" || c.AdminPassword != "admin" || !c.DefaultCredentials || !c.GeneratedSessionKey || len(c.SessionKey) < 32 {
		t.Fatalf("defaults: %v %+v", e, c)
	}
	// Explicit values win.
	t.Setenv("SPOOL_ADMIN_USER", "root")
	t.Setenv("SPOOL_ADMIN_PASSWORD", "pw")
	t.Setenv("SPOOL_SESSION_KEY", strings.Repeat("k", 32))
	c, e = Load()
	if e != nil || c.AdminUser != "root" || c.DefaultCredentials || c.GeneratedSessionKey || c.SessionKey != strings.Repeat("k", 32) {
		t.Fatalf("explicit: %v %+v", e, c)
	}
	// A viewer alone must not gain a default admin backdoor.
	t.Setenv("SPOOL_ADMIN_USER", "")
	t.Setenv("SPOOL_ADMIN_PASSWORD", "")
	t.Setenv("SPOOL_VIEWER_USER", "v")
	t.Setenv("SPOOL_VIEWER_PASSWORD", "pw")
	if c, e = Load(); e != nil || c.AdminUser != "" || c.DefaultCredentials {
		t.Fatalf("viewer only: %v %+v", e, c)
	}
}
