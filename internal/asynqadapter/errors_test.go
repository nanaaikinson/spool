package asynqadapter

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/nanaaikinson/spool/internal/domain"
)

func TestNormalizeError(t *testing.T) {
	cases := map[string]string{
		"billing API returned 503: upstream unavailable":          "billing API returned 503: upstream unavailable",
		"order 7f3e2b1c-0d4a-4e5f-9a8b-1c2d3e4f5a6b not found":    "order <id> not found",
		`user "ada@example.com" rejected at 2026-10-09T12:00:01Z`: `user "…" rejected at <time>`,
		"dial tcp 10.0.3.17:6379: connect: connection refused":    "dial tcp <addr>: connect: connection refused",
		"invoice 1234567 exceeded limit of 500":                   "invoice <n> exceeded limit of 500",
		"object deadbeef1234 missing; checksum feedface":          "object <hex> missing; checksum feedface",
		"panic: boom\ngoroutine 1 [running]:\nmain.main()":        "panic: boom",
		"  ": "(no error recorded)",
	}
	for in, want := range cases {
		if got := NormalizeError(in); got != want {
			t.Errorf("NormalizeError(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestGroupFailures(t *testing.T) {
	at := func(m int) *time.Time {
		v := time.Date(2026, 10, 9, 12, m, 0, 0, time.UTC)
		return &v
	}
	tasks := []domain.TaskSummary{
		{ID: "a", Queue: "critical", Type: "invoice:sync", State: domain.Retry, LastError: "order 1111111 failed: 503", LastFailedAt: at(1)},
		{ID: "b", Queue: "default", Type: "invoice:sync", State: domain.Archived, LastError: "order 2222222 failed: 503", LastFailedAt: at(5)},
		{ID: "c", Queue: "critical", Type: "invoice:sync", State: domain.Retry, LastError: "order 3333333 failed: 429", LastFailedAt: at(3)},
		{ID: "d", Queue: "critical", Type: "email:send", State: domain.Retry, LastError: "order 4444444 failed: 503", LastFailedAt: at(2)},
	}
	groups := groupFailures(tasks)
	if len(groups) != 3 {
		t.Fatalf("got %d groups, want 3: %+v", len(groups), groups)
	}
	g := groups[0]
	if g.Type != "invoice:sync" || g.Pattern != "order <n> failed: 503" || g.Count != 2 || g.Retry != 1 || g.Archived != 1 {
		t.Fatalf("unexpected top group: %+v", g)
	}
	if len(g.Queues) != 2 || g.Queues[0] != "critical" || g.Queues[1] != "default" {
		t.Fatalf("queues = %v", g.Queues)
	}
	if !g.FirstSeen.Equal(*at(1)) || !g.LastSeen.Equal(*at(5)) || g.Sample.ID != "b" || g.Error != "order 2222222 failed: 503" {
		t.Fatalf("recency fields wrong: %+v", g)
	}
}

func TestAllocate(t *testing.T) {
	got := allocate([]bucket{{"a", "retry", 21}, {"a", "archived", 9000}, {"b", "retry", 21}, {"b", "archived", 50}}, 500)
	want := []int{21, 408, 21, 50}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("allocate = %v, want %v", got, want)
		}
	}
}

func TestRealRedisErrorGroups(t *testing.T) {
	address := os.Getenv("SPOOL_TEST_REDIS")
	if address == "" {
		t.Skip("set SPOOL_TEST_REDIS to an isolated test database")
	}
	opt, e := asynq.ParseRedisURI(address)
	if e != nil {
		t.Fatal(e)
	}
	a := New(opt)
	defer a.Close()
	q := "spool-groups-" + time.Now().Format("150405.000000000")
	ctx := context.Background()
	inspector := asynq.NewInspector(opt)
	defer inspector.Close()
	defer inspector.DeleteQueue(q, true)
	for i := 0; i < 25; i++ {
		task, e := a.client.EnqueueContext(ctx, asynq.NewTask("test:group", nil), asynq.Queue(q))
		if e != nil {
			t.Fatal(e)
		}
		if e := inspector.ArchiveTask(q, task.ID); e != nil {
			t.Fatal(e)
		}
	}
	// A sample smaller than the archive exercises the last-page read.
	out, e := a.ErrorGroups(ctx, q, 10)
	if e != nil {
		t.Fatal(e)
	}
	if out.Total != 25 || out.Sampled != 10 || len(out.Data) != 1 || out.Data[0].Count != 10 || out.Data[0].Archived != 10 {
		t.Fatalf("unexpected groups: %+v", out)
	}
}
