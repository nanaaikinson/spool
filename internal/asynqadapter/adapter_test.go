package asynqadapter

import (
	"bytes"
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/nanaaikinson/spool/internal/domain"
)

func TestPayload(t *testing.T) {
	if p := payload([]byte(`{"a":1}`)); p.Encoding != "json" || p.Truncated {
		t.Fatalf("JSON encoding: %+v", p)
	}
	if p := payload([]byte{0xff, 0, 0x80}); p.Encoding != "base64" {
		t.Fatal("binary must not be corrupted")
	}
	p := payload(bytes.Repeat([]byte("x"), MaxPayload+1))
	if !p.Truncated || p.Bytes != MaxPayload+1 || len(p.Data) != MaxPayload {
		t.Fatal("payload bound is incorrect")
	}
}

func TestActionEligibility(t *testing.T) {
	for _, s := range []domain.TaskState{
		domain.Pending,
		domain.Active,
		domain.Retry,
		domain.Archived,
		domain.Completed,
		domain.Scheduled,
		domain.Aggregating,
	} {
		if Allowed(s, "retry") != (s == domain.Retry || s == domain.Archived || s == domain.Scheduled) {
			t.Fatalf("retry state %s", s)
		}
		if s == domain.Active && Allowed(s, "delete") {
			t.Fatal("active task deletion must be prohibited")
		}
		if Allowed(s, "cancel") != (s == domain.Active) {
			t.Fatal("cancellation eligibility")
		}
	}
}

func TestRealRedisLifecycle(t *testing.T) {
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
	q := "spool-test-" + time.Now().Format("150405.000000000")
	ctx := context.Background()
	inspector := asynq.NewInspector(opt)
	defer inspector.Close()
	defer inspector.DeleteQueue(q, true)
	if _, e := a.Queue(ctx, q); !errors.Is(e, ErrNotFound) {
		t.Fatalf("missing queue: %v", e)
	}
	var ids []string
	for i := 0; i < 3; i++ {
		task, e := a.client.EnqueueContext(ctx, asynq.NewTask("test:inspect", []byte("raw payload")), asynq.Queue(q))
		if e != nil {
			t.Fatal(e)
		}
		ids = append(ids, task.ID)
	}
	if e := a.QueueAction(ctx, q, "pause"); e != nil {
		t.Fatal(e)
	}
	queue, e := a.Queue(ctx, q)
	if e != nil || !queue.Paused {
		t.Fatal("pause", e)
	}
	if e := a.QueueAction(ctx, q, "resume"); e != nil {
		t.Fatal(e)
	}
	page, e := a.Tasks(ctx, domain.TaskFilter{Queue: q, State: "pending", Limit: 2})
	if e != nil || len(page.Data) != 2 || !page.Pagination.HasMore {
		t.Fatalf("page %+v %v", page, e)
	}
	next, e := a.Tasks(
		ctx,
		domain.TaskFilter{Queue: q, State: "pending", Limit: 2, Cursor: page.Pagination.NextCursor},
	)
	if e != nil || len(next.Data) != 1 {
		t.Fatalf("next %+v %v", next, e)
	}
	if _, e := a.Tasks(
		ctx,
		domain.TaskFilter{Queue: q, State: "archived", Limit: 2, Cursor: page.Pagination.NextCursor},
	); !errors.Is(e, ErrCursor) {
		t.Fatal("changed filters accepted a cursor")
	}
	if e := a.TaskAction(ctx, q, ids[0], "archive"); e != nil {
		t.Fatal(e)
	}
	task, e := a.Task(ctx, q, ids[0])
	if e != nil || task.State != domain.Archived {
		t.Fatal("archive", e)
	}
	if e := a.TaskAction(ctx, q, ids[0], "retry"); e != nil {
		t.Fatal(e)
	}
	task, e = a.Task(ctx, q, ids[0])
	if e != nil || task.State != domain.Pending {
		t.Fatal("retry", e)
	}
	if e := a.TaskAction(ctx, q, ids[0], "delete"); e != nil {
		t.Fatal(e)
	}
	if _, e := a.Task(ctx, q, ids[0]); !errors.Is(e, ErrNotFound) {
		t.Fatal("deleted task still present")
	}
}

func TestAllowedAll(t *testing.T) {
	for _, tc := range []struct {
		state, action string
		want          bool
	}{
		{"retry", "retry", true},
		{"archived", "retry", true},
		{"pending", "retry", false},
		{"completed", "retry", false},
		{"pending", "archive", true},
		{"archived", "archive", false},
		{"completed", "archive", false},
		{"completed", "delete", true},
		{"aggregating", "delete", true},
		{"active", "delete", false},
		{"active", "retry", false},
		{"active", "archive", false},
		{"bogus", "delete", false},
		{"retry", "cancel", false},
	} {
		if got := AllowedAll(tc.state, tc.action); got != tc.want {
			t.Errorf("AllowedAll(%q, %q) = %v, want %v", tc.state, tc.action, got, tc.want)
		}
	}
}

func TestRealRedisBulkAndQueueDeletion(t *testing.T) {
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
	q := "spool-bulk-" + time.Now().Format("150405.000000000")
	ctx := context.Background()
	inspector := asynq.NewInspector(opt)
	defer inspector.Close()
	defer inspector.DeleteQueue(q, true)
	for i := 0; i < 4; i++ {
		if _, e := a.client.EnqueueContext(ctx, asynq.NewTask("test:bulk", nil), asynq.Queue(q)); e != nil {
			t.Fatal(e)
		}
	}
	if _, e := a.client.EnqueueContext(ctx, asynq.NewTask("test:later", nil), asynq.Queue(q), asynq.ProcessIn(time.Hour)); e != nil {
		t.Fatal(e)
	}
	if e := a.QueueAction(ctx, q, "delete"); !errors.Is(e, ErrQueueNotEmpty) {
		t.Fatalf("non-empty queue deletion: %v", e)
	}
	if n, e := a.TaskActionAll(ctx, q, "pending", "", "archive"); e != nil || n != 4 {
		t.Fatalf("archive pending: %d %v", n, e)
	}
	if got, _ := a.Queue(ctx, q); got.Pending != 0 || got.Archived != 4 || got.Scheduled != 1 {
		t.Fatalf("after archive: %+v", got)
	}
	if n, e := a.TaskActionAll(ctx, q, "archived", "", "retry"); e != nil || n != 4 {
		t.Fatalf("retry archived: %d %v", n, e)
	}
	if got, _ := a.Queue(ctx, q); got.Pending != 4 || got.Archived != 0 {
		t.Fatalf("after retry: %+v", got)
	}
	if _, e := a.TaskActionAll(ctx, q, "active", "", "delete"); !errors.Is(e, ErrConflict) {
		t.Fatalf("active tasks must be refused: %v", e)
	}
	if _, e := a.TaskActionAll(ctx, q, "aggregating", "", "delete"); !errors.Is(e, ErrConflict) {
		t.Fatalf("aggregating needs a group: %v", e)
	}
	if _, e := a.TaskActionAll(ctx, q, "pending", "g", "delete"); !errors.Is(e, ErrConflict) {
		t.Fatalf("group only applies to aggregating: %v", e)
	}
	if _, e := a.TaskActionAll(ctx, "spool-missing-queue", "pending", "", "delete"); !errors.Is(e, ErrNotFound) {
		t.Fatalf("missing queue: %v", e)
	}
	if n, e := a.TaskActionAll(ctx, q, "pending", "", "delete"); e != nil || n != 4 {
		t.Fatalf("delete pending: %d %v", n, e)
	}
	if n, e := a.TaskActionAll(ctx, q, "scheduled", "", "delete"); e != nil || n != 1 {
		t.Fatalf("delete scheduled: %d %v", n, e)
	}
	if e := a.QueueAction(ctx, q, "delete"); e != nil {
		t.Fatalf("empty queue deletion: %v", e)
	}
	if _, e := a.Queue(ctx, q); !errors.Is(e, ErrNotFound) {
		t.Fatalf("deleted queue still present: %v", e)
	}
	if e := a.QueueAction(ctx, q, "delete"); !errors.Is(e, ErrNotFound) {
		t.Fatalf("second deletion: %v", e)
	}
}

func TestRealRedisSchedulerEventsAndDetails(t *testing.T) {
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
	q := "spool-sched-" + time.Now().Format("150405.000000000")
	inspector := asynq.NewInspector(opt)
	defer inspector.Close()
	defer inspector.DeleteQueue(q, true)
	scheduler := asynq.NewScheduler(opt, nil)
	id, e := scheduler.Register("@every 1s", asynq.NewTask("test:cron", nil), asynq.Queue(q))
	if e != nil {
		t.Fatal(e)
	}
	if e := scheduler.Start(); e != nil {
		t.Fatal(e)
	}
	defer scheduler.Shutdown()
	var events []domain.SchedulerEvent
	for deadline := time.Now().Add(6 * time.Second); time.Now().Before(deadline) && len(events) < 2; time.Sleep(250 * time.Millisecond) {
		if events, e = a.SchedulerEvents(context.Background(), id, 30); e != nil {
			t.Fatal(e)
		}
	}
	if len(events) < 2 || events[0].TaskID == "" || events[0].EnqueuedAt.Before(events[len(events)-1].EnqueuedAt) {
		t.Fatalf("events must be newest first: %+v", events)
	}
	if limited, e := a.SchedulerEvents(context.Background(), id, 1); e != nil || len(limited) != 1 {
		t.Fatalf("limit: %+v %v", limited, e)
	}
	if none, e := a.SchedulerEvents(context.Background(), "no-such-entry", 30); e != nil || len(none) != 0 {
		t.Fatalf("unknown entry: %+v %v", none, e)
	}
	cluster, e := a.RedisCluster(context.Background())
	if e != nil || cluster.Enabled || len(cluster.Queues) != 0 {
		t.Fatalf("standalone Redis is not a cluster: %+v %v", cluster, e)
	}
	raw, e := a.RedisRaw(context.Background())
	if e != nil || len(raw.Sections) < 3 || raw.Sections[0].Name != "Server" || len(raw.Sections[0].Fields) == 0 {
		t.Fatalf("raw info: %+v %v", raw, e)
	}
}
