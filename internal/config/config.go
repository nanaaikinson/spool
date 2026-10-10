package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"

	z "github.com/Oudwins/zog"
	"github.com/hibiken/asynq"
	"github.com/nanaaikinson/chandlery/env"
)

type Config struct {
	Addr           string
	RedisURL       string
	DatabaseURL    string
	PrometheusURL  string
	Environment    string
	StaticDir      string
	AdminUser      string
	AdminPassword  string
	ViewerUser     string
	ViewerPassword string
	SessionKey     string
	ReadOnly       bool
	SecureCookie   bool
}

func Load() (Config, error) {
	if _, e := os.Stat(".env"); e == nil {
		if e = env.Load(".env"); e != nil {
			return Config{}, fmt.Errorf("could not load .env")
		}
	}
	c := Config{
		Addr:           env.Get("SPOOL_ADDR", "127.0.0.1:8088"),
		RedisURL:       env.Get("REDIS_URL", "redis://127.0.0.1:6388/0"),
		DatabaseURL:    env.Get("DATABASE_URL"),
		PrometheusURL:  env.Get("PROMETHEUS_URL"),
		Environment:    env.Get("SPOOL_ENV", "development"),
		StaticDir:      env.Get("SPOOL_STATIC_DIR", "apps/web/dist"),
		AdminUser:      env.Get("SPOOL_ADMIN_USER"),
		AdminPassword:  env.Get("SPOOL_ADMIN_PASSWORD"),
		ViewerUser:     env.Get("SPOOL_VIEWER_USER"),
		ViewerPassword: env.Get("SPOOL_VIEWER_PASSWORD"),
		SessionKey:     env.Get("SPOOL_SESSION_KEY"),
		ReadOnly:       env.GetBool("SPOOL_READ_ONLY", false),
		SecureCookie:   env.GetBool("SPOOL_SECURE_COOKIE", false),
	}
	issues := z.Struct(z.Shape{
		"Addr":        z.String().Required(),
		"Environment": z.String().Required().Max(80),
		"RedisURL":    z.String().Required(),
	}).Validate(&c)
	if len(issues) > 0 {
		return c, fmt.Errorf("invalid configuration: SPOOL_ADDR, SPOOL_ENV, and REDIS_URL must be set, and SPOOL_ENV must be at most 80 characters")
	}
	if (c.AdminUser == "") != (c.AdminPassword == "") || (c.ViewerUser == "") != (c.ViewerPassword == "") {
		return c, fmt.Errorf("set both the username and password for each account (SPOOL_ADMIN_USER/SPOOL_ADMIN_PASSWORD, SPOOL_VIEWER_USER/SPOOL_VIEWER_PASSWORD)")
	}
	if c.AdminUser != "" && c.ViewerUser == c.AdminUser {
		return c, fmt.Errorf("SPOOL_ADMIN_USER and SPOOL_VIEWER_USER must differ")
	}
	if c.AdminUser == "" && c.ViewerUser == "" && !strings.HasPrefix(c.Addr, "127.0.0.1:") && !strings.HasPrefix(c.Addr, "localhost:") {
		return c, fmt.Errorf("SPOOL_ADDR is not a loopback address; set SPOOL_ADMIN_USER or SPOOL_VIEWER_USER to require sign-in")
	}
	if c.AdminUser != "" || c.ViewerUser != "" {
		if len(c.SessionKey) < 32 {
			return c, fmt.Errorf("SPOOL_SESSION_KEY must be at least 32 characters when sign-in is enabled")
		}
	}
	if _, err := asynq.ParseRedisURI(c.RedisURL); err != nil {
		return c, fmt.Errorf("invalid REDIS_URL")
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
	// Asynq v0.26 parses passwords and TLS but omits the Redis ACL username.
	if redis, ok := opt.(asynq.RedisClientOpt); ok {
		if u, err := url.Parse(c.RedisURL); err == nil && u.User != nil {
			redis.Username = u.User.Username()
		}
		return redis
	}
	return opt
}
