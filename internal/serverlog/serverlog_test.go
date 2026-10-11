package serverlog

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"

	"github.com/nanaaikinson/spool/internal/domain"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

type memory struct {
	mu      sync.Mutex
	entries []domain.ServerLog
}

func (m *memory) RecordServerLogs(_ context.Context, es []domain.ServerLog) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.entries = append(m.entries, es...)
	return nil
}

func TestRecorderKeepsEveryLevel(t *testing.T) {
	var out bytes.Buffer
	r := New(slog.NewJSONHandler(&out, &slog.HandlerOptions{AddSource: true}), 16)
	log := slog.New(r.Handler())
	// Logged before the database is attached, as startup warnings are.
	log.Warn("cannot reach Redis yet", "redis", "redis://cache:6379 db 0")
	log.Info("server listening")
	log.With("request_id", "req-1").WithGroup("http").Error("request failed", "status", 503)
	m := &memory{}
	r.Attach(m)
	r.Close()
	if n := strings.Count(out.String(), "\n"); n != 3 {
		t.Fatalf("stdout lines = %d, want every record", n)
	}
	if len(m.entries) != 3 {
		t.Fatalf("recorded %d entries, want all three: %+v", len(m.entries), m.entries)
	}
	warn, info, failed := m.entries[0], m.entries[1], m.entries[2]
	if info.Level != "INFO" || info.Message != "server listening" {
		t.Fatalf("info = %+v", info)
	}
	if warn.Level != "WARN" || warn.Message != "cannot reach Redis yet" || !strings.HasSuffix(strings.Split(warn.Caller, ":")[0], "serverlog_test.go") {
		t.Fatalf("warning = %+v", warn)
	}
	want := []domain.LogAttr{{Key: "request_id", Value: "req-1"}, {Key: "http.status", Value: "503"}}
	if failed.Level != "ERROR" || len(failed.Attrs) != 2 || failed.Attrs[0] != want[0] || failed.Attrs[1] != want[1] {
		t.Fatalf("error = %+v", failed)
	}
	if testutil.ToFloat64(r.events.WithLabelValues("INFO")) != 1 || testutil.ToFloat64(r.events.WithLabelValues("ERROR")) != 1 {
		t.Fatal("log event counter not incremented")
	}
	// Logging after shutdown neither blocks nor panics.
	log.Error("late")
}

func TestRecorderDropsWhenQueueIsFull(t *testing.T) {
	r := New(slog.NewTextHandler(io.Discard, nil), 1)
	log := slog.New(r.Handler())
	log.Error("first")
	log.Error("second")
	m := &memory{}
	r.Attach(m)
	r.Close()
	if len(m.entries) != 1 || m.entries[0].Message != "first" {
		t.Fatalf("entries = %+v", m.entries)
	}
}
