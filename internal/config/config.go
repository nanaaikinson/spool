package config

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"

	z "github.com/Oudwins/zog"
	"github.com/hibiken/asynq"
	"github.com/nanaaikinson/chandlery/env"
)

type Config struct {
	MultiOrg         bool
	SetupToken       string
	DataKey          string
	OrganizationName string
	Addr             string
	RedisURL         string
	DatabaseURL      string
	PrometheusURL    string
	Environment      string
	InstanceName     string
	DeploymentMode   string
	SupportURL       string
	MetricsJob       string
	StaticDir        string
	AdminUser        string
	AdminPassword    string
	ViewerUser       string
	ViewerPassword   string
	SessionKey       string
	MetricsToken     string
	ReadOnly         bool
	// ReadOnlyReason says why changes are disabled: "configured" when
	// SPOOL_READ_ONLY is set, "no_database" when there is nowhere to record
	// audit entries. Empty when changes are allowed.
	ReadOnlyReason string
	SecureCookie   bool
	// RedisTLS adds a private CA or client certificate to rediss:// and
	// redis-sentinel:// connections. Nil uses the system trust store.
	RedisTLS *tls.Config
}

func Load() (Config, error) {
	if _, e := os.Stat(".env"); e == nil {
		if e = env.Load(".env"); e != nil {
			return Config{}, fmt.Errorf("could not load .env")
		}
	}
	c := Config{
		MultiOrg:         env.GetBool("SPOOL_MULTI_ORG", false),
		SetupToken:       env.Get("SPOOL_SETUP_TOKEN"),
		DataKey:          env.Get("SPOOL_DATA_KEY"),
		OrganizationName: env.Get("SPOOL_ORGANIZATION_NAME", "My organization"),
		Addr:             env.Get("SPOOL_ADDR", "127.0.0.1:8088"),
		RedisURL:         env.Get("REDIS_URL", "redis://127.0.0.1:6388/0"),
		DatabaseURL:      env.Get("DATABASE_URL"),
		PrometheusURL:    env.Get("PROMETHEUS_URL"),
		Environment:      env.Get("SPOOL_ENV", "development"),
		InstanceName:     env.Get("SPOOL_INSTANCE_NAME"),
		DeploymentMode:   env.Get("SPOOL_DEPLOYMENT_MODE", "self-hosted"),
		SupportURL:       env.Get("SPOOL_SUPPORT_URL"),
		MetricsJob:       env.Get("SPOOL_METRICS_JOB", "spool"),
		StaticDir:        env.Get("SPOOL_STATIC_DIR", "apps/web/dist"),
		AdminUser:        env.Get("SPOOL_ADMIN_USER"),
		AdminPassword:    env.Get("SPOOL_ADMIN_PASSWORD"),
		ViewerUser:       env.Get("SPOOL_VIEWER_USER"),
		ViewerPassword:   env.Get("SPOOL_VIEWER_PASSWORD"),
		SessionKey:       env.Get("SPOOL_SESSION_KEY"),
		MetricsToken:     env.Get("SPOOL_METRICS_TOKEN"),
		ReadOnly:         env.GetBool("SPOOL_READ_ONLY", false),
		SecureCookie:     env.GetBool("SPOOL_SECURE_COOKIE", false),
	}
	if c.MultiOrg {
		if len(c.MetricsToken) < 32 {
			return c, fmt.Errorf("organization management requires SPOOL_METRICS_TOKEN to protect the combined metrics export")
		}
		if c.DatabaseURL == "" || len(c.DataKey) < 32 {
			return c, fmt.Errorf("organization management requires DATABASE_URL and a stable SPOOL_DATA_KEY of at least 32 characters")
		}
		if c.SetupToken != "" && len(c.SetupToken) < 32 {
			return c, fmt.Errorf("SPOOL_SETUP_TOKEN must be at least 32 characters")
		}

		if strings.TrimSpace(c.OrganizationName) == "" || len(c.OrganizationName) > 80 || strings.ContainsAny(c.OrganizationName, "\r\n\x00") {
			return c, fmt.Errorf("SPOOL_ORGANIZATION_NAME must be 1–80 characters")
		}
	}
	issues := z.Struct(z.Shape{
		"Addr":        z.String().Required(),
		"Environment": z.String().Required().Max(80),
		"RedisURL":    z.String().Required(),
	}).Validate(&c)
	if len(issues) > 0 {
		return c, fmt.Errorf("invalid configuration: SPOOL_ADDR, SPOOL_ENV, and REDIS_URL must be set, and SPOOL_ENV must be at most 80 characters")
	}
	if c.InstanceName == "" {
		c.InstanceName = c.Environment
	}
	if len(c.InstanceName) > 80 || strings.ContainsAny(c.InstanceName, "\r\n") {
		return c, fmt.Errorf("SPOOL_INSTANCE_NAME must be at most 80 characters without line breaks")
	}
	if c.DeploymentMode != "self-hosted" && c.DeploymentMode != "hosted" {
		return c, fmt.Errorf("SPOOL_DEPLOYMENT_MODE must be self-hosted or hosted")
	}
	if c.MetricsJob == "" || len(c.MetricsJob) > 80 {
		return c, fmt.Errorf("SPOOL_METRICS_JOB must be between 1 and 80 characters")
	}
	if c.SupportURL != "" {
		u, err := url.Parse(c.SupportURL)
		if err != nil || u.User != nil || strings.ContainsAny(c.SupportURL, "\r\n") || !((u.Scheme == "https" && u.Hostname() != "") || (u.Scheme == "mailto" && strings.Contains(u.Opaque, "@"))) {
			return c, fmt.Errorf("SPOOL_SUPPORT_URL must be an HTTPS or mailto link without embedded credentials")
		}
	}
	if (c.AdminUser == "") != (c.AdminPassword == "") || (c.ViewerUser == "") != (c.ViewerPassword == "") {
		return c, fmt.Errorf("set both the username and password for each account (SPOOL_ADMIN_USER/SPOOL_ADMIN_PASSWORD, SPOOL_VIEWER_USER/SPOOL_VIEWER_PASSWORD)")
	}
	if c.AdminUser != "" && c.ViewerUser == c.AdminUser {
		return c, fmt.Errorf("SPOOL_ADMIN_USER and SPOOL_VIEWER_USER must differ")
	}
	if !c.MultiOrg && c.AdminUser == "" && c.ViewerUser == "" && !strings.HasPrefix(c.Addr, "127.0.0.1:") && !strings.HasPrefix(c.Addr, "localhost:") {
		return c, fmt.Errorf("SPOOL_ADDR is not a loopback address; set SPOOL_ADMIN_USER or SPOOL_VIEWER_USER to require sign-in")
	}
	if c.MultiOrg || c.AdminUser != "" || c.ViewerUser != "" {
		if len(c.SessionKey) < 32 {
			return c, fmt.Errorf("SPOOL_SESSION_KEY must be at least 32 characters when sign-in is enabled")
		}
	}
	if _, err := asynq.ParseRedisURI(c.RedisURL); err != nil {
		return c, fmt.Errorf("invalid REDIS_URL")
	}
	if c.MetricsToken != "" && (len(c.MetricsToken) < 32 || strings.ContainsAny(c.MetricsToken, " \t\r\n")) {
		return c, fmt.Errorf("SPOOL_METRICS_TOKEN must be at least 32 characters without whitespace")
	}
	tlsConfig, e := redisTLS(
		env.Get("REDIS_TLS_CA_FILE"),
		env.Get("REDIS_TLS_CERT_FILE"),
		env.Get("REDIS_TLS_KEY_FILE"),
	)
	if e != nil {
		return c, e
	}
	if tlsConfig != nil && !strings.HasPrefix(c.RedisURL, "rediss://") && !strings.HasPrefix(c.RedisURL, "redis-sentinel://") {
		return c, fmt.Errorf("REDIS_TLS_* settings need a rediss:// or redis-sentinel:// REDIS_URL")
	}
	c.RedisTLS = tlsConfig
	// Every change is recorded in the audit log before it runs, so without
	// PostgreSQL Spool can only observe.
	switch {
	case c.ReadOnly:
		c.ReadOnlyReason = "configured"
	case c.DatabaseURL == "":
		c.ReadOnly, c.ReadOnlyReason = true, "no_database"
	}
	if c.PrometheusURL != "" {
		u, e := url.Parse(c.PrometheusURL)
		if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return c, fmt.Errorf("invalid PROMETHEUS_URL")
		}
	}
	return c, nil
}

func (c Config) Redis() asynq.RedisConnOpt {
	opt, _ := asynq.ParseRedisURI(c.RedisURL)
	switch o := opt.(type) {
	case asynq.RedisClientOpt:
		// Asynq v0.26 parses passwords and TLS but omits the Redis ACL username.
		if u, err := url.Parse(c.RedisURL); err == nil && u.User != nil {
			o.Username = u.User.Username()
		}
		o.TLSConfig = withRedisTLS(o.TLSConfig, c.RedisTLS)
		return o
	case asynq.RedisFailoverClientOpt:
		// Asynq v0.26 reads only the Sentinel addresses, master name and a
		// Sentinel password. Also take the database from the path, and use the
		// URL credentials for the master, with sentinel_password overriding the
		// Sentinel's own password when it differs.
		if u, err := url.Parse(c.RedisURL); err == nil {
			if db, err := strconv.Atoi(strings.Trim(u.Path, "/")); err == nil {
				o.DB = db
			}
			if u.User != nil {
				o.Username = u.User.Username()
				o.Password, _ = u.User.Password()
			}
			if p := u.Query().Get("sentinel_password"); p != "" {
				o.SentinelPassword = p
			}
		}
		o.TLSConfig = withRedisTLS(o.TLSConfig, c.RedisTLS)
		return o
	}
	return opt
}

// withRedisTLS layers the configured CA and client certificate over the TLS
// settings Asynq derived from the URL, keeping its server name. It enables TLS
// for redis-sentinel:// URLs, which have no TLS scheme of their own.
func withRedisTLS(base, extra *tls.Config) *tls.Config {
	if extra == nil {
		return base
	}
	out := extra.Clone()
	if base != nil && out.ServerName == "" {
		out.ServerName = base.ServerName
	}
	return out
}

// redisTLS builds the TLS settings for a private CA and an optional client
// certificate. It returns nil when none are configured.
func redisTLS(caFile, certFile, keyFile string) (*tls.Config, error) {
	if caFile == "" && certFile == "" && keyFile == "" {
		return nil, nil
	}
	if (certFile == "") != (keyFile == "") {
		return nil, fmt.Errorf("set both REDIS_TLS_CERT_FILE and REDIS_TLS_KEY_FILE for a Redis client certificate")
	}
	cfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if caFile != "" {
		pem, e := os.ReadFile(caFile)
		if e != nil {
			return nil, fmt.Errorf("could not read REDIS_TLS_CA_FILE: %w", e)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("REDIS_TLS_CA_FILE contains no PEM certificates")
		}
		cfg.RootCAs = pool
	}
	if certFile != "" {
		cert, e := tls.LoadX509KeyPair(certFile, keyFile)
		if e != nil {
			return nil, fmt.Errorf("could not load the Redis client certificate: %w", e)
		}
		cfg.Certificates = []tls.Certificate{cert}
	}
	return cfg, nil
}

// RedisTarget describes the Redis connection for logs without credentials:
// scheme, hosts and database number.
func (c Config) RedisTarget() string {
	u, e := url.Parse(c.RedisURL)
	if e != nil {
		return "invalid REDIS_URL"
	}
	target := u.Scheme + "://" + u.Host
	if u.Scheme == "redis-socket" {
		target = u.Scheme + "://" + u.Path
	} else if db := strings.Trim(u.Path, "/"); db != "" {
		target += " db " + db
	} else {
		target += " db 0"
	}
	if db := u.Query().Get("db"); db != "" && u.Scheme == "redis-socket" {
		target += " db " + db
	}
	return target
}
