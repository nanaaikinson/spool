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
