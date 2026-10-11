package store

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"time"

	cdb "github.com/nanaaikinson/chandlery/db"
	"github.com/nanaaikinson/spool/db/migrations"
	"github.com/nanaaikinson/spool/internal/domain"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	_ "modernc.org/sqlite"
)

var ErrUnavailable = errors.New("audit database unavailable")

type auditModel struct {
	bun.BaseModel `bun:"table:audit_logs"`
	cdb.IdentityModel
	Actor     string
	Action    string
	Queue     string
	TaskID    string
	Status    string
	CreatedAt time.Time
}

type viewModel struct {
	bun.BaseModel `bun:"table:saved_views"`
	cdb.IdentityModel
	Actor     string
	Name      string
	Path      string
	CreatedAt time.Time
}

type scheduleEntryModel struct {
	bun.BaseModel `bun:"table:schedule_entries"`
	EntryID       string    `bun:"entry_id,pk"`
	Spec          string    `bun:"spec"`
	TaskType      string    `bun:"task_type"`
	FirstSeen     time.Time `bun:"first_seen"`
	LastSeen      time.Time `bun:"last_seen"`
}

type Store struct {
	DB     *bun.DB
	audits cdb.Repository[*auditModel]
	views  cdb.Repository[*viewModel]
}

// Open opens the SQLite database at path, creating the file and its directory
// when missing, and applies migrations. An empty path returns a nil Store:
// Spool runs read-only.
func Open(ctx context.Context, path string) (*Store, error) {
	if path == "" {
		return nil, nil
	}
	if e := os.MkdirAll(filepath.Dir(path), 0o700); e != nil {
		return nil, e
	}
	// Pragmas go in the DSN so every connection gets them. Immediate
	// transactions take the write lock up front instead of failing on upgrade.
	dsn := path + "?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_txlock=immediate"
	sqldb, e := sql.Open("sqlite", dsn)
	if e != nil {
		return nil, e
	}
	db := bun.NewDB(sqldb, sqlitedialect.New())
	// SQLite allows one writer; a single connection serializes access in
	// process rather than contending for the file lock.
	db.SetMaxOpenConns(1)
	if e := db.PingContext(ctx); e != nil {
		db.Close()
		return nil, e
	}
	e = db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		for _, m := range []string{migrations.Initial, migrations.ScheduleEntries} {
			if _, e := tx.ExecContext(ctx, m); e != nil {
				return e
			}
		}
		return nil
	})
	if e != nil {
		db.Close()
		return nil, e
	}
	return &Store{db, cdb.NewRepository[*auditModel](db), cdb.NewRepository[*viewModel](db)}, nil
}

func (s *Store) Ping(ctx context.Context) error {
	if s == nil {
		return ErrUnavailable
	}
	return s.DB.PingContext(ctx)
}

func (s *Store) Begin(ctx context.Context, actor, action, q, id string) (string, error) {
	if s == nil {
		return "", ErrUnavailable
	}
	a := &auditModel{
		Actor:     actor,
		Action:    action,
		Queue:     q,
		TaskID:    id,
		Status:    "pending",
		CreatedAt: time.Now(),
	}
	if e := s.audits.Create(ctx, a); e != nil {
		return "", ErrUnavailable
	}
	return a.ID, nil
}

func (s *Store) Finish(ctx context.Context, id string, success bool) error {
	status := "failed"
	if success {
		status = "succeeded"
	}
	res, e := s.DB.NewUpdate().
		Model((*auditModel)(nil)).
		Set("status = ?", status).
		Where("id = ? AND status = 'pending'", id).
		Exec(ctx)
	if e != nil {
		return e
	}
	n, e := res.RowsAffected()
	if e != nil {
		return e
	}
	if n != 1 {
		return errors.New("audit record is no longer pending")
	}
	return nil
}

// Audits returns one page of the audit log, newest first, and the total
// number of records. Pages start at 1.
func (s *Store) Audits(ctx context.Context, page, limit int) (domain.AuditList, error) {
	out := domain.AuditList{Data: []domain.Audit{}, Page: page, Limit: limit}
	if s == nil {
		return out, ErrUnavailable
	}
	var rows []auditModel
	total, e := s.DB.NewSelect().
		Model(&rows).
		OrderExpr("created_at DESC, id DESC").
		Limit(limit).
		Offset((page - 1) * limit).
		ScanAndCount(ctx)
	if e != nil {
		return out, e
	}
	out.Total = total
	for _, r := range rows {
		out.Data = append(
			out.Data,
			domain.Audit{
				ID:        r.ID,
				Actor:     r.Actor,
				Action:    r.Action,
				Queue:     r.Queue,
				TaskID:    r.TaskID,
				Status:    r.Status,
				CreatedAt: r.CreatedAt,
			},
		)
	}
	return out, nil
}

func (s *Store) Views(ctx context.Context, actor string) ([]domain.SavedView, error) {
	if s == nil {
		return nil, ErrUnavailable
	}
	rows, e := s.views.GetMany(ctx, func(q *bun.SelectQuery) *bun.SelectQuery {
		return q.Where("actor = ?", actor).OrderExpr("created_at DESC").Limit(100)
	})
	out := make([]domain.SavedView, 0, len(rows))
	for _, r := range rows {
		out = append(
			out,
			domain.SavedView{ID: r.ID, Actor: r.Actor, Name: r.Name, Path: r.Path, CreatedAt: r.CreatedAt},
		)
	}
	return out, e
}

func (s *Store) SaveView(ctx context.Context, actor string, r domain.ViewRequest) (domain.SavedView, error) {
	if s == nil {
		return domain.SavedView{}, ErrUnavailable
	}
	v := &viewModel{Actor: actor, Name: r.Name, Path: r.Path, CreatedAt: time.Now()}
	e := s.views.Create(ctx, v)
	return domain.SavedView{ID: v.ID, Actor: v.Actor, Name: v.Name, Path: v.Path, CreatedAt: v.CreatedAt}, e
}

func (s *Store) DeleteView(ctx context.Context, actor, id string) error {
	if s == nil {
		return ErrUnavailable
	}
	_, e := s.DB.NewDelete().Model((*viewModel)(nil)).Where("id = ? AND actor = ?", id, actor).Exec(ctx)
	return e
}

// RecordScheduleEntries upserts live periodic entries, refreshing last_seen.
func (s *Store) RecordScheduleEntries(ctx context.Context, entries []domain.Scheduler) error {
	if s == nil {
		return ErrUnavailable
	}
	if len(entries) == 0 {
		return nil
	}
	now := time.Now()
	rows := make([]scheduleEntryModel, 0, len(entries))
	for _, e := range entries {
		rows = append(rows, scheduleEntryModel{EntryID: e.ID, Spec: e.Spec, TaskType: e.Type, FirstSeen: now, LastSeen: now})
	}
	_, e := s.DB.NewInsert().
		Model(&rows).
		On("CONFLICT (entry_id) DO UPDATE").
		Set("spec = EXCLUDED.spec, task_type = EXCLUDED.task_type, last_seen = EXCLUDED.last_seen").
		Exec(ctx)
	return e
}

type scheduleLinkModel struct {
	bun.BaseModel `bun:"table:schedule_links"`
	TaskID        string    `bun:"task_id,pk"`
	EntryID       string    `bun:"entry_id,pk"`
	EnqueuedAt    time.Time `bun:"enqueued_at"`
}

// RecordScheduleLinks stores task-to-entry links; existing links are left unchanged.
func (s *Store) RecordScheduleLinks(ctx context.Context, links []domain.ScheduleLink) error {
	if s == nil {
		return ErrUnavailable
	}
	if len(links) == 0 {
		return nil
	}
	rows := make([]scheduleLinkModel, 0, len(links))
	for _, l := range links {
		rows = append(rows, scheduleLinkModel{TaskID: l.TaskID, EntryID: l.EntryID, EnqueuedAt: l.EnqueuedAt})
	}
	_, e := s.DB.NewInsert().Model(&rows).On("CONFLICT DO NOTHING").Exec(ctx)
	return e
}

// ScheduleLinks returns the periodic entry behind each of the given tasks. A
// custom task ID reused across entries resolves to the latest enqueue.
func (s *Store) ScheduleLinks(ctx context.Context, taskIDs []string) (map[string]domain.ScheduleRef, error) {
	if s == nil {
		return nil, ErrUnavailable
	}
	var rows []struct {
		TaskID  string `bun:"task_id"`
		EntryID string `bun:"entry_id"`
		Spec    string `bun:"spec"`
	}
	e := s.DB.NewSelect().
		TableExpr("schedule_links AS l").
		Join("JOIN schedule_entries AS e ON e.entry_id = l.entry_id").
		ColumnExpr("l.task_id, l.entry_id, e.spec").
		Where("l.task_id IN (?)", bun.In(taskIDs)).
		OrderExpr("l.enqueued_at").
		Scan(ctx, &rows)
	if e != nil {
		return nil, e
	}
	out := make(map[string]domain.ScheduleRef, len(rows))
	for _, r := range rows {
		out[r.TaskID] = domain.ScheduleRef{EntryID: r.EntryID, Spec: r.Spec}
	}
	return out, nil
}

// PruneSchedules drops links enqueued before the cutoff and entries that have
// not been seen since then and no longer link to any task.
func (s *Store) PruneSchedules(ctx context.Context, before time.Time) error {
	if s == nil {
		return ErrUnavailable
	}
	return s.DB.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, e := tx.NewDelete().Model((*scheduleLinkModel)(nil)).Where("enqueued_at < ?", before).Exec(ctx); e != nil {
			return e
		}
		_, e := tx.NewDelete().
			Model((*scheduleEntryModel)(nil)).
			Where("last_seen < ?", before).
			Where("NOT EXISTS (SELECT 1 FROM schedule_links AS l WHERE l.entry_id = ?TableAlias.entry_id)").
			Exec(ctx)
		return e
	})
}
