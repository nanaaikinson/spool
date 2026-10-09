package config

import (
	"testing"

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
