package asynqadapter

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hibiken/asynq"
	"github.com/nanaaikinson/spool/internal/domain"
)

var ErrNotFound = errors.New("not found")

var ErrConflict = errors.New("action conflicts with current task state")

var ErrCursor = errors.New("invalid cursor")

type Source interface {
	Queues(context.Context) ([]domain.Queue, error)
	Queue(context.Context, string) (domain.Queue, error)
	Tasks(context.Context, domain.TaskFilter) (domain.TaskList, error)
	Task(context.Context, string, string) (domain.Task, error)
	Servers(context.Context) ([]domain.Server, error)
	ErrorGroups(context.Context, string, int) (domain.ErrorGroupList, error)
	Schedulers(context.Context) ([]domain.Scheduler, error)
	QueueAction(context.Context, string, string) error
	TaskAction(context.Context, string, string, string) error
	Clone(context.Context, string, string, domain.CloneRequest) (domain.Task, error)
	Close() error
}

type Adapter struct {
	inspector *asynq.Inspector
	client    *asynq.Client
	schedules scheduleCache
	// Entries, when set, persists periodic entries; see ScheduleStore.
	Entries ScheduleStore
}

func New(opt asynq.RedisConnOpt) *Adapter {
	return &Adapter{inspector: asynq.NewInspector(opt), client: asynq.NewClient(opt)}
}

func (a *Adapter) Close() error {
	return errors.Join(a.inspector.Close(), a.client.Close())
}

func mapError(err error) error {
	if errors.Is(err, asynq.ErrTaskNotFound) || errors.Is(err, asynq.ErrQueueNotFound) {
		return ErrNotFound
	}
	return err
}

func (a *Adapter) Queues(ctx context.Context) ([]domain.Queue, error) {
	names, err := a.inspector.Queues()
	if err != nil {
		return nil, err
	}
	sort.Strings(names)
	out := make([]domain.Queue, 0, len(names))
	for _, n := range names {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		q, err := a.Queue(ctx, n)
		if errors.Is(err, ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		out = append(out, q)
	}
	return out, nil
}

func (a *Adapter) Queue(ctx context.Context, name string) (domain.Queue, error) {
	if err := ctx.Err(); err != nil {
		return domain.Queue{}, err
	}
	q, e := a.inspector.GetQueueInfo(name)
	if e != nil {
		// GetQueueInfo returns asynq's internal not-found error rather than
		// ErrQueueNotFound, so confirm a missing queue against the queue list.
		if names, err := a.inspector.Queues(); err == nil && !slices.Contains(names, name) {
			return domain.Queue{}, ErrNotFound
		}
		return domain.Queue{}, mapError(e)
	}
	return domain.Queue{
		Name:           q.Queue,
		Paused:         q.Paused,
		Pending:        q.Pending,
		Active:         q.Active,
		Scheduled:      q.Scheduled,
		Retry:          q.Retry,
		Archived:       q.Archived,
		Completed:      q.Completed,
		Aggregating:    q.Aggregating,
		Processed:      q.Processed,
		Failed:         q.Failed,
		ProcessedTotal: q.ProcessedTotal,
		FailedTotal:    q.FailedTotal,
		LatencySeconds: q.Latency.Seconds(),
		MemoryBytes:    q.MemoryUsage,
		Timestamp:      q.Timestamp,
	}, nil
}

func optional(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}

func summary(t *asynq.TaskInfo) domain.TaskSummary {
	return domain.TaskSummary{
		ID:            t.ID,
		Queue:         t.Queue,
		Type:          t.Type,
		State:         domain.TaskState(t.State.String()),
		Retried:       t.Retried,
		MaxRetry:      t.MaxRetry,
		LastError:     t.LastErr,
		LastFailedAt:  optional(t.LastFailedAt),
		NextProcessAt: optional(t.NextProcessAt),
		CompletedAt:   optional(t.CompletedAt),
		Orphaned:      t.IsOrphaned,
	}
}

const MaxPayload = 256 * 1024

func payload(b []byte) domain.Payload {
	p := domain.Payload{Bytes: len(b), Encoding: "utf8"}
	if len(b) > MaxPayload {
		b = b[:MaxPayload]
		p.Truncated = true
	}
	if utf8.Valid(b) {
		p.Data = string(b)
		if json.Valid(b) {
			p.Encoding = "json"
		}
	} else {
		p.Data = base64.StdEncoding.EncodeToString(b)
		p.Encoding = "base64"
	}
	return p
}

func Allowed(state domain.TaskState, action string) bool {
	switch action {
	case "retry":
		return state == domain.Retry || state == domain.Archived || state == domain.Scheduled
	case "archive":
		return state == domain.Pending || state == domain.Retry || state == domain.Scheduled
	case "delete":
		return state != domain.Active
	case "cancel":
		return state == domain.Active
	case "clone":
		return true
	}
	return false
}

func task(t *asynq.TaskInfo) domain.Task {
	actions := []string{}
	for _, s := range []string{"retry", "archive", "delete", "cancel", "clone"} {
		if Allowed(domain.TaskState(t.State.String()), s) && !(s == "cancel" && t.IsOrphaned) {
			actions = append(actions, s)
		}
	}
	headers := t.Headers
	if headers == nil {
		headers = map[string]string{}
	}
	return domain.Task{
		TaskSummary:      summary(t),
		Payload:          payload(t.Payload),
		Result:           payload(t.Result),
		Headers:          headers,
		TimeoutSeconds:   t.Timeout.Seconds(),
		Deadline:         optional(t.Deadline),
		Group:            t.Group,
		RetentionSeconds: t.Retention.Seconds(),
		Actions:          actions,
	}
}

func (a *Adapter) Task(ctx context.Context, q, id string) (domain.Task, error) {
	if e := ctx.Err(); e != nil {
		return domain.Task{}, e
	}
	t, e := a.inspector.GetTaskInfo(q, id)
	if e != nil {
		return domain.Task{}, mapError(e)
	}
	out := task(t)
	summaries := []domain.TaskSummary{out.TaskSummary}
	a.annotate(ctx, summaries)
	out.Schedule = summaries[0].Schedule
	return out, nil
}

type cursor struct {
	Bucket int    `json:"b"`
	Page   int    `json:"p"`
	Scope  string `json:"s"`
}

type bucket struct {
	queue string
	state string
	count int
}

func (a *Adapter) Tasks(ctx context.Context, f domain.TaskFilter) (domain.TaskList, error) {
	out := domain.TaskList{Data: []domain.TaskSummary{}, Pagination: domain.Pagination{Scope: "native-page"}}
	if f.ID != "" && f.Queue != "" {
		t, e := a.Task(ctx, f.Queue, f.ID)
		if errors.Is(e, ErrNotFound) {
			return out, nil
		}
		if e != nil {
			return out, e
		}
		out.Pagination.Total = 1
		if matches(t.TaskSummary, f) {
			out.Data = append(out.Data, t.TaskSummary)
		}
		return out, nil
	}
	queues, e := a.Queues(ctx)
	if e != nil {
		return out, e
	}
	if len(queues) > 256 {
		return out, fmt.Errorf("too many queues to list tasks (limit 256)")
	}
	buckets := []bucket{}
	for _, q := range queues {
		if f.Queue != "" && q.Name != f.Queue {
			continue
		}
		counts := map[string]int{
			"pending":     q.Pending,
			"active":      q.Active,
			"scheduled":   q.Scheduled,
			"retry":       q.Retry,
			"archived":    q.Archived,
			"completed":   q.Completed,
			"aggregating": q.Aggregating,
		}
		for _, state := range []string{"retry", "archived", "active", "pending", "scheduled", "completed", "aggregating"} {
			if f.State != "" && f.State != state && !(f.State == "failed" && (state == "retry" || state == "archived")) {
				continue
			}
			if state == "aggregating" && f.Group == "" {
				continue
			}
			buckets = append(buckets, bucket{q.Name, state, counts[state]})
			out.Pagination.Total += counts[state]
		}
	}
	signatureFilter := f
	signatureFilter.Cursor = ""
	raw, _ := json.Marshal(signatureFilter)
	hash := fmt.Sprintf("%x", sha256.Sum256(raw))
	c := cursor{Page: 1, Scope: hash}
	if f.Cursor != "" {
		b, err := base64.RawURLEncoding.DecodeString(f.Cursor)
		if err != nil || json.Unmarshal(b, &c) != nil ||
			c.Scope != hash || c.Page < 1 || c.Page > 1000000 ||
			c.Bucket < 0 || c.Bucket >= len(buckets) {
			return out, ErrCursor
		}
	}
	// Read a single Asynq page rather than scanning Redis to satisfy arbitrary filters,
	// so a filtered page can be empty and still have a next cursor.
	if c.Bucket >= len(buckets) {
		return out, nil
	}
	for c.Bucket < len(buckets) && buckets[c.Bucket].count == 0 {
		c.Bucket++
		c.Page = 1
	}
	if c.Bucket >= len(buckets) {
		return out, nil
	}
	b := buckets[c.Bucket]
	opts := []asynq.ListOption{asynq.PageSize(f.Limit), asynq.Page(c.Page)}
	var ts []*asynq.TaskInfo
	switch b.state {
	case "pending":
		ts, e = a.inspector.ListPendingTasks(b.queue, opts...)
	case "active":
		ts, e = a.inspector.ListActiveTasks(b.queue, opts...)
	case "scheduled":
		ts, e = a.inspector.ListScheduledTasks(b.queue, opts...)
	case "retry":
		ts, e = a.inspector.ListRetryTasks(b.queue, opts...)
	case "archived":
		ts, e = a.inspector.ListArchivedTasks(b.queue, opts...)
	case "completed":
		ts, e = a.inspector.ListCompletedTasks(b.queue, opts...)
	case "aggregating":
		ts, e = a.inspector.ListAggregatingTasks(b.queue, f.Group, opts...)
	}
	if e != nil && !errors.Is(mapError(e), ErrNotFound) {
		return out, e
	}
	for _, t := range ts {
		s := summary(t)
		if matches(s, f) {
			out.Data = append(out.Data, s)
		}
	}
	if len(ts) == f.Limit {
		c.Page++
	} else {
		c.Bucket++
		c.Page = 1
	}
	if c.Bucket < len(buckets) {
		raw, _ := json.Marshal(c)
		out.Pagination.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
		out.Pagination.HasMore = true
	}
	a.annotate(ctx, out.Data)
	return out, nil
}

func matches(t domain.TaskSummary, f domain.TaskFilter) bool {
	return (f.ID == "" || t.ID == f.ID) &&
		(f.Type == "" || strings.Contains(strings.ToLower(t.Type), strings.ToLower(f.Type))) &&
		t.Retried >= f.MinRetry &&
		(f.FailedAfter == nil || (t.LastFailedAt != nil && !t.LastFailedAt.Before(*f.FailedAfter))) &&
		(f.State == "" || f.State == string(t.State) ||
			(f.State == "failed" && (t.State == domain.Retry || t.State == domain.Archived)))
}

func (a *Adapter) Servers(ctx context.Context) ([]domain.Server, error) {
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	ss, e := a.inspector.Servers()
	if e != nil {
		return nil, e
	}
	out := make([]domain.Server, 0, len(ss))
	for _, s := range ss {
		workers := []domain.Worker{}
		for _, w := range s.ActiveWorkers {
			workers = append(
				workers,
				domain.Worker{
					TaskID:   w.TaskID,
					TaskType: w.TaskType,
					Queue:    w.Queue,
					Started:  w.Started,
					Deadline: optional(w.Deadline),
				},
			)
		}
		out = append(
			out,
			domain.Server{
				ID:             s.ID,
				Host:           s.Host,
				PID:            s.PID,
				Concurrency:    s.Concurrency,
				Queues:         s.Queues,
				StrictPriority: s.StrictPriority,
				Started:        s.Started,
				Status:         s.Status,
				Workers:        workers,
			},
		)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].ID < out[j].ID
	})
	return out, nil
}

func (a *Adapter) Schedulers(ctx context.Context) ([]domain.Scheduler, error) {
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	ss, e := a.inspector.SchedulerEntries()
	out := []domain.Scheduler{}
	for _, s := range ss {
		out = append(
			out,
			domain.Scheduler{
				ID:       s.ID,
				Spec:     s.Spec,
				Type:     s.Task.Type(),
				Next:     s.Next,
				Previous: optional(s.Prev),
			},
		)
	}
	return out, e
}

func (a *Adapter) QueueAction(ctx context.Context, q, action string) error {
	if _, e := a.Queue(ctx, q); e != nil {
		return e
	}
	if action == "pause" {
		return mapError(a.inspector.PauseQueue(q))
	}
	if action == "resume" {
		return mapError(a.inspector.UnpauseQueue(q))
	}
	return ErrConflict
}

func (a *Adapter) TaskAction(ctx context.Context, q, id, action string) error {
	t, e := a.Task(ctx, q, id)
	if e != nil {
		return e
	}
	if !Allowed(t.State, action) {
		return ErrConflict
	}
	switch action {
	case "retry":
		e = a.inspector.RunTask(q, id)
	case "archive":
		e = a.inspector.ArchiveTask(q, id)
	case "delete":
		e = a.inspector.DeleteTask(q, id)
	case "cancel":
		servers, err := a.Servers(ctx)
		if err != nil {
			return err
		}
		matches := 0
		for _, server := range servers {
			for _, worker := range server.Workers {
				if worker.TaskID == id {
					if worker.Queue != q {
						return ErrConflict
					}
					matches++
				}
			}
		}
		if matches != 1 {
			return ErrConflict
		}
		e = a.inspector.CancelProcessing(id)
	default:
		return ErrConflict
	}
	return mapError(e)
}

func (a *Adapter) Clone(ctx context.Context, q, id string, r domain.CloneRequest) (domain.Task, error) {
	if _, e := a.Task(ctx, q, id); e != nil {
		return domain.Task{}, e
	}
	info, e := a.client.EnqueueContext(
		ctx,
		asynq.NewTask(r.Type, []byte(r.Payload)),
		asynq.Queue(r.Queue),
		asynq.MaxRetry(r.MaxRetry),
		asynq.Retention(24*time.Hour),
	)
	if e != nil {
		return domain.Task{}, e
	}
	return task(info), nil
}
