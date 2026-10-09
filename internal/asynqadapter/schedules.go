package asynqadapter

import (
	"context"
	"sync"
	"time"

	"github.com/hibiken/asynq"
	"github.com/nanaaikinson/spool/internal/domain"
)

// Asynq keeps the last 1000 enqueue events per live periodic entry, and deletes
// them when the scheduler shuts down. Spool reads that history to link tasks to
// the cron spec that created them, and persists the links when it has a store.
const (
	scheduleHistory  = 1000
	scheduleCacheTTL = 10 * time.Second
	// Bounds the entries kept in memory; each costs one history read per sync.
	maxRememberedEntries = 200
	// Links older than this are pruned; few tasks are retained that long.
	scheduleLinkRetention = 30 * 24 * time.Hour
	schedulePruneInterval = time.Hour
)

// ScheduleStore persists periodic entries and the tasks they enqueued, so links
// survive restarts of both the scheduler and Spool.
type ScheduleStore interface {
	RecordScheduleEntries(context.Context, []domain.Scheduler) error
	RecordScheduleLinks(context.Context, []domain.ScheduleLink) error
	ScheduleLinks(context.Context, []string) (map[string]domain.ScheduleRef, error)
	PruneSchedules(context.Context, time.Time) error
}

type scheduleCache struct {
	mu       sync.Mutex
	builtAt  time.Time
	prunedAt time.Time
	index    map[string]*domain.ScheduleRef
	// known holds every entry whose history is read. A restarted scheduler that
	// did not shut down cleanly leaves its history behind under the old entry
	// ID; remembering the spec keeps those tasks linked.
	known map[string]*domain.ScheduleRef
	order []string
	// synced is the newest enqueue already persisted per entry.
	synced map[string]time.Time
}

// remember stores a fresh pointer rather than mutating the old one, which an
// index handed out earlier may still be reading.
func (c *scheduleCache) remember(ref domain.ScheduleRef) {
	if _, ok := c.known[ref.EntryID]; !ok {
		c.order = append(c.order, ref.EntryID)
	}
	c.known[ref.EntryID] = &domain.ScheduleRef{EntryID: ref.EntryID, Spec: ref.Spec}
}

// scheduleIndex maps task IDs to entries from the enqueue history currently in
// Redis, persisting new entries and links along the way. It rebuilds at most
// every scheduleCacheTTL. Failures degrade to fewer links, never to an error.
func (a *Adapter) scheduleIndex(ctx context.Context) map[string]*domain.ScheduleRef {
	a.schedules.mu.Lock()
	defer a.schedules.mu.Unlock()
	c := &a.schedules
	if c.index != nil && time.Since(c.builtAt) < scheduleCacheTTL {
		return c.index
	}
	if c.known == nil {
		c.known = map[string]*domain.ScheduleRef{}
		c.synced = map[string]time.Time{}
	}
	var live []domain.Scheduler
	if entries, e := a.inspector.SchedulerEntries(); e == nil {
		for _, entry := range entries {
			live = append(live, domain.Scheduler{ID: entry.ID, Spec: entry.Spec, Type: entry.Task.Type()})
			c.remember(domain.ScheduleRef{EntryID: entry.ID, Spec: entry.Spec})
		}
	}
	for len(c.order) > maxRememberedEntries {
		delete(c.known, c.order[0])
		delete(c.synced, c.order[0])
		c.order = c.order[1:]
	}
	storeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	persist := a.Entries != nil && a.Entries.RecordScheduleEntries(storeCtx, live) == nil
	index := map[string]*domain.ScheduleRef{}
	for _, id := range c.order {
		if ctx.Err() != nil {
			break
		}
		// Events come newest first.
		events, e := a.inspector.ListSchedulerEnqueueEvents(id, asynq.PageSize(scheduleHistory))
		if e != nil {
			continue
		}
		var fresh []domain.ScheduleLink
		for _, ev := range events {
			index[ev.TaskID] = c.known[id]
			// Timestamps have one-second precision; re-sending the boundary second
			// is harmless because existing links are kept.
			if persist && !ev.EnqueuedAt.Before(c.synced[id]) {
				fresh = append(fresh, domain.ScheduleLink{TaskID: ev.TaskID, EntryID: id, EnqueuedAt: ev.EnqueuedAt})
			}
		}
		if len(fresh) > 0 && a.Entries.RecordScheduleLinks(storeCtx, fresh) == nil {
			c.synced[id] = fresh[0].EnqueuedAt
		}
	}
	if persist && time.Since(c.prunedAt) > schedulePruneInterval {
		if a.Entries.PruneSchedules(storeCtx, time.Now().Add(-scheduleLinkRetention)) == nil {
			c.prunedAt = time.Now()
		}
	}
	c.index, c.builtAt = index, time.Now()
	return index
}

// annotate sets Schedule on tasks enqueued by a periodic entry: from history
// still in Redis first, then from links persisted earlier.
func (a *Adapter) annotate(ctx context.Context, tasks []domain.TaskSummary) {
	if len(tasks) == 0 {
		return
	}
	index := a.scheduleIndex(ctx)
	var missing []string
	for i := range tasks {
		tasks[i].Schedule = index[tasks[i].ID]
		if tasks[i].Schedule == nil {
			missing = append(missing, tasks[i].ID)
		}
	}
	if a.Entries == nil || len(missing) == 0 {
		return
	}
	storeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	refs, e := a.Entries.ScheduleLinks(storeCtx, missing)
	if e != nil {
		return
	}
	for i := range tasks {
		if ref, ok := refs[tasks[i].ID]; ok && tasks[i].Schedule == nil {
			tasks[i].Schedule = &ref
		}
	}
}
