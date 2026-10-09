package asynqadapter

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/nanaaikinson/spool/internal/domain"
)

// memoryStore is an in-process ScheduleStore for tests.
type memoryStore struct {
	mu      sync.Mutex
	entries map[string]string
	links   map[string]string
}

func (m *memoryStore) RecordScheduleEntries(_ context.Context, es []domain.Scheduler) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, e := range es {
		m.entries[e.ID] = e.Spec
	}
	return nil
}

func (m *memoryStore) RecordScheduleLinks(_ context.Context, ls []domain.ScheduleLink) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, l := range ls {
		m.links[l.TaskID] = l.EntryID
	}
	return nil
}

func (m *memoryStore) ScheduleLinks(_ context.Context, ids []string) (map[string]domain.ScheduleRef, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]domain.ScheduleRef{}
	for _, id := range ids {
		if entry, ok := m.links[id]; ok {
			out[id] = domain.ScheduleRef{EntryID: entry, Spec: m.entries[entry]}
		}
	}
	return out, nil
}

func (m *memoryStore) PruneSchedules(context.Context, time.Time) error { return nil }

func TestRealRedisScheduleLinks(t *testing.T) {
	address := os.Getenv("SPOOL_TEST_REDIS")
	if address == "" {
		t.Skip("set SPOOL_TEST_REDIS to an isolated test database")
	}
	opt, e := asynq.ParseRedisURI(address)
	if e != nil {
		t.Fatal(e)
	}
	store := &memoryStore{entries: map[string]string{}, links: map[string]string{}}
	a := New(opt)
	a.Entries = store
	defer a.Close()
	q := "spool-cron-" + time.Now().Format("150405.000000000")
	ctx := context.Background()
	inspector := asynq.NewInspector(opt)
	defer inspector.Close()
	defer inspector.DeleteQueue(q, true)
	scheduler := asynq.NewScheduler(opt, nil)
	entryID, e := scheduler.Register("@every 1s", asynq.NewTask("test:cron", nil), asynq.Queue(q))
	if e != nil {
		t.Fatal(e)
	}
	if e := scheduler.Start(); e != nil {
		t.Fatal(e)
	}
	defer scheduler.Shutdown()
	oneOff, e := a.client.EnqueueContext(ctx, asynq.NewTask("test:once", nil), asynq.Queue(q), asynq.ProcessIn(time.Hour))
	if e != nil {
		t.Fatal(e)
	}
	var list domain.TaskList
	// Entries appear after the scheduler's first heartbeat, which can take ~10s.
	deadline := time.Now().Add(25 * time.Second)
	for time.Now().Before(deadline) {
		list, e = a.Tasks(ctx, domain.TaskFilter{Queue: q, State: "pending", Limit: 50})
		if e != nil {
			t.Fatal(e)
		}
		if len(list.Data) > 0 && list.Data[0].Schedule != nil {
			break
		}
		time.Sleep(500 * time.Millisecond)
		a.schedules.mu.Lock()
		a.schedules.index = nil
		a.schedules.mu.Unlock()
	}
	if len(list.Data) == 0 || list.Data[0].Schedule == nil {
		t.Fatalf("periodic task not linked: %+v", list.Data)
	}
	if ref := list.Data[0].Schedule; ref.EntryID != entryID || ref.Spec != "@every 1s" {
		t.Fatalf("schedule = %+v, want entry %s", ref, entryID)
	}
	task, e := a.Task(ctx, q, oneOff.ID)
	if e != nil {
		t.Fatal(e)
	}
	if task.Schedule != nil {
		t.Fatalf("one-off task linked to %+v", task.Schedule)
	}
	// A clean shutdown deletes the entry's enqueue history from Redis. A fresh
	// adapter (as after a Spool restart) must still link through the store.
	linked := list.Data[0].ID
	scheduler.Shutdown()
	if events, _ := inspector.ListSchedulerEnqueueEvents(entryID); len(events) != 0 {
		t.Fatalf("expected asynq to clear history, found %d events", len(events))
	}
	restarted := New(opt)
	restarted.Entries = store
	defer restarted.Close()
	after, e := restarted.Task(ctx, q, linked)
	if e != nil {
		t.Fatal(e)
	}
	if after.Schedule == nil || after.Schedule.EntryID != entryID || after.Schedule.Spec != "@every 1s" {
		t.Fatalf("link lost after shutdown: %+v", after.Schedule)
	}
}
