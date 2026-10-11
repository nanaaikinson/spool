package store

import (
	"context"
	"fmt"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/nanaaikinson/spool/internal/domain"
)

func TestParseLogSearch(t *testing.T) {
	got := ParseLogSearch(`timeout level:error -healthcheck code:DEPENDENCY_* message:"request failed" "two words" -level:info`)
	want := []LogTerm{
		{Value: "timeout"},
		{Field: "level", Value: "error"},
		{Value: "healthcheck", Negate: true},
		{Field: "code", Value: "DEPENDENCY_*"},
		{Field: "message", Value: "request failed"},
		{Value: "two words"},
		{Field: "level", Value: "info", Negate: true},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("terms = %+v", got)
	}
	if len(ParseLogSearch("  - \"\"  ")) != 1 {
		// A lone hyphen is free text, not an empty negation.
		t.Fatalf("stray syntax = %+v", ParseLogSearch("  - \"\"  "))
	}
}

func openLogs(t *testing.T) (*Store, time.Time) {
	t.Helper()
	ctx := context.Background()
	s, e := Open(ctx, filepath.Join(t.TempDir(), "spool.db"))
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.DB.Close() })
	base := time.Now().Add(-30 * time.Minute).Truncate(time.Minute)
	entries := []domain.ServerLog{
		{Time: base, Level: "INFO", Message: "server listening", Caller: "cmd/server/main.go:106"},
		{Time: base.Add(time.Minute), Level: "WARN", Message: "cannot reach Redis yet", Attrs: []domain.LogAttr{{Key: "redis", Value: "redis://cache:6379 db 0"}}},
		{Time: base.Add(2 * time.Minute), Level: "ERROR", Message: "request failed", Caller: "internal/api/queues.go:22", Attrs: []domain.LogAttr{{Key: "code", Value: "DEPENDENCY_UNAVAILABLE"}, {Key: "request_id", Value: "100%_done"}}},
		{Time: base.Add(3 * time.Minute), Level: "ERROR", Message: "request failed", Attrs: []domain.LogAttr{{Key: "code", Value: "AUDIT_UNAVAILABLE"}}},
		{Time: base.Add(4 * time.Minute), Level: "INFO", Message: "signed in", Attrs: []domain.LogAttr{{Key: "actor", Value: "admin"}}},
	}
	if e := s.RecordServerLogs(ctx, entries); e != nil {
		t.Fatal(e)
	}
	return s, base
}

func messages(l domain.ServerLogList) []string {
	out := []string{}
	for _, e := range l.Data {
		out = append(out, fmt.Sprintf("%s %s", e.Level, e.Message))
	}
	return out
}

func TestServerLogSearch(t *testing.T) {
	s, base := openLogs(t)
	ctx := context.Background()
	q := func(search string) LogQuery {
		return LogQuery{Search: search, Start: base.Add(-time.Hour), End: base.Add(time.Hour)}
	}
	cases := map[string][]string{
		"":                                {"INFO signed in", "ERROR request failed", "ERROR request failed", "WARN cannot reach Redis yet", "INFO server listening"},
		"level:error":                     {"ERROR request failed", "ERROR request failed"},
		"level:warning level:info":        {"INFO signed in", "WARN cannot reach Redis yet", "INFO server listening"},
		"-level:info -level:error":        {"WARN cannot reach Redis yet"},
		"code:dependency_*":               {"ERROR request failed"},
		`message:"Request Failed" -audit`: {"ERROR request failed"},
		`"cache:6379"`:                    {"WARN cannot reach Redis yet"},
		"cache:6379":                      {},
		"queues.go":                       {"ERROR request failed"},
		"caller:*main.go*":                {"INFO server listening"},
		"100%_":                           {"ERROR request failed"},
		"100%x":                           {},
		"actor:admin level:info":          {"INFO signed in"},
	}
	for search, want := range cases {
		got, e := s.ServerLogs(ctx, q(search), 0, 50)
		if e != nil || !reflect.DeepEqual(messages(got), want) {
			t.Errorf("%q = %v, %v; want %v", search, messages(got), e, want)
		}
	}
	// The range is start-inclusive and end-exclusive.
	got, _ := s.ServerLogs(ctx, LogQuery{Start: base.Add(time.Minute), End: base.Add(3 * time.Minute)}, 0, 50)
	if !reflect.DeepEqual(messages(got), []string{"ERROR request failed", "WARN cannot reach Redis yet"}) {
		t.Errorf("range = %v", messages(got))
	}
}

func TestServerLogPagingAroundAndHistogram(t *testing.T) {
	s, base := openLogs(t)
	ctx := context.Background()
	all := LogQuery{Start: base.Add(-time.Hour), End: base.Add(time.Hour)}
	first, e := s.ServerLogs(ctx, all, 0, 2)
	if e != nil || len(first.Data) != 2 || !first.HasMore {
		t.Fatalf("first page = %+v, %v", first, e)
	}
	rest, e := s.ServerLogs(ctx, all, first.Data[1].ID, 10)
	if e != nil || len(rest.Data) != 3 || rest.HasMore {
		t.Fatalf("older page = %+v, %v", rest, e)
	}
	around, e := s.LogsAround(ctx, rest.Data[0].ID, 1)
	if e != nil || !reflect.DeepEqual(messages(around), []string{"ERROR request failed", "ERROR request failed", "WARN cannot reach Redis yet"}) {
		t.Fatalf("around = %v, %v", messages(around), e)
	}
	h, e := s.LogHistogram(ctx, LogQuery{Start: base, End: base.Add(5 * time.Minute)}, time.Minute)
	if e != nil || len(h.Buckets) != 5 || h.Total != 5 || h.StepSeconds != 60 {
		t.Fatalf("histogram = %+v, %v", h, e)
	}
	if b := h.Buckets[2]; b.Error != 1 || b.Info != 0 || !b.Start.Equal(base.Add(2*time.Minute)) {
		t.Fatalf("bucket = %+v", b)
	}
	errs, _ := s.LogHistogram(ctx, LogQuery{Search: "level:error", Start: base, End: base.Add(5 * time.Minute)}, time.Minute)
	if errs.Total != 2 {
		t.Fatalf("filtered histogram total = %d", errs.Total)
	}
}

func TestServerLogRetention(t *testing.T) {
	s, _ := openLogs(t)
	ctx := context.Background()
	old := domain.ServerLog{Time: time.Now().Add(-73 * time.Hour), Level: "INFO", Message: "ancient"}
	if e := s.RecordServerLogs(ctx, []domain.ServerLog{old}); e != nil {
		t.Fatal(e)
	}
	removed, e := s.PruneServerLogs(ctx, time.Now().Add(-72*time.Hour))
	if e != nil || removed != 1 {
		t.Fatalf("pruned %d, %v; want the one expired record", removed, e)
	}
	if n, _ := s.DB.NewSelect().Model((*logModel)(nil)).Count(ctx); n != 5 {
		t.Fatalf("recent records after prune = %d, want 5", n)
	}
	batch := make([]domain.ServerLog, LogLimit+10)
	for i := range batch {
		batch[i] = domain.ServerLog{Time: time.Now(), Level: "INFO", Message: "bulk"}
	}
	if e := s.RecordServerLogs(ctx, batch); e != nil {
		t.Fatal(e)
	}
	if n, _ := s.DB.NewSelect().Model((*logModel)(nil)).Count(ctx); n != LogLimit {
		t.Fatalf("kept %d records, want %d", n, LogLimit)
	}
}
