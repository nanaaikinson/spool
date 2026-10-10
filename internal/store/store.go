package store

import (
	"context"
	"database/sql"
	"errors"
	"time"

	cdb "github.com/nanaaikinson/chandlery/db"
	"github.com/nanaaikinson/spool/db/migrations"
	"github.com/nanaaikinson/spool/internal/domain"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

var ErrUnavailable = errors.New("audit database unavailable")

type auditModel struct {
	bun.BaseModel `bun:"table:audit_logs"`
	cdb.IdentityModel
	OrganizationID string
	Actor          string
	Action         string
	Queue          string
	TaskID         string
	Status         string
	CreatedAt      time.Time
}

type viewModel struct {
	bun.BaseModel `bun:"table:saved_views"`
	cdb.IdentityModel
	OrganizationID string
	Actor          string
	Name           string
	Path           string
	CreatedAt      time.Time
}

type scheduleEntryModel struct {
	bun.BaseModel  `bun:"table:schedule_entries"`
	OrganizationID string    `bun:"organization_id,pk"`
	EntryID        string    `bun:"entry_id,pk"`
	Spec           string    `bun:"spec"`
	TaskType       string    `bun:"task_type"`
	FirstSeen      time.Time `bun:"first_seen"`
	LastSeen       time.Time `bun:"last_seen"`
}

type Store struct {
	DB             *bun.DB
	OrganizationID string
	audits         cdb.Repository[*auditModel]
	views          cdb.Repository[*viewModel]
}

func Open(ctx context.Context, dsn string) (*Store, error) {
	if dsn == "" {
		return nil, nil
	}
	db := bun.NewDB(sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn))), pgdialect.New())
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	if e := db.PingContext(ctx); e != nil {
		db.Close()
		return nil, ErrUnavailable
	}
	e := db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, e := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(74290311)"); e != nil {
			return e
		}
		for _, m := range []string{migrations.Initial, migrations.ScheduleEntries, migrations.Organizations} {
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
	return &Store{DB: db, audits: cdb.NewRepository[*auditModel](db), views: cdb.NewRepository[*viewModel](db)}, nil
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
		OrganizationID: s.OrganizationID,
		Actor:          actor,
		Action:         action,
		Queue:          q,
		TaskID:         id,
		Status:         "pending",
		CreatedAt:      time.Now(),
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
		Where("id = ? AND status = 'pending' AND organization_id = ?", id, s.OrganizationID).
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
		Where("organization_id = ?", s.OrganizationID).
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
		return q.Where("actor = ? AND organization_id = ?", actor, s.OrganizationID).OrderExpr("created_at DESC").Limit(100)
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
	v := &viewModel{OrganizationID: s.OrganizationID, Actor: actor, Name: r.Name, Path: r.Path, CreatedAt: time.Now()}
	e := s.views.Create(ctx, v)
	return domain.SavedView{ID: v.ID, Actor: v.Actor, Name: v.Name, Path: v.Path, CreatedAt: v.CreatedAt}, e
}

func (s *Store) DeleteView(ctx context.Context, actor, id string) error {
	if s == nil {
		return ErrUnavailable
	}
	_, e := s.DB.NewDelete().Model((*viewModel)(nil)).Where("id = ? AND actor = ? AND organization_id = ?", id, actor, s.OrganizationID).Exec(ctx)
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
		rows = append(rows, scheduleEntryModel{OrganizationID: s.OrganizationID, EntryID: e.ID, Spec: e.Spec, TaskType: e.Type, FirstSeen: now, LastSeen: now})
	}
	_, e := s.DB.NewInsert().
		Model(&rows).
		On("CONFLICT (organization_id, entry_id) DO UPDATE").
		Set("spec = EXCLUDED.spec, task_type = EXCLUDED.task_type, last_seen = EXCLUDED.last_seen").
		Exec(ctx)
	return e
}

type scheduleLinkModel struct {
	bun.BaseModel  `bun:"table:schedule_links"`
	OrganizationID string    `bun:"organization_id,pk"`
	TaskID         string    `bun:"task_id,pk"`
	EntryID        string    `bun:"entry_id,pk"`
	EnqueuedAt     time.Time `bun:"enqueued_at"`
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
		rows = append(rows, scheduleLinkModel{OrganizationID: s.OrganizationID, TaskID: l.TaskID, EntryID: l.EntryID, EnqueuedAt: l.EnqueuedAt})
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
		Join("JOIN schedule_entries AS e ON e.entry_id = l.entry_id AND e.organization_id = l.organization_id").
		ColumnExpr("l.task_id, l.entry_id, e.spec").
		Where("l.task_id IN (?) AND l.organization_id = ?", bun.In(taskIDs), s.OrganizationID).
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
		if _, e := tx.NewDelete().Model((*scheduleLinkModel)(nil)).Where("enqueued_at < ? AND organization_id = ?", before, s.OrganizationID).Exec(ctx); e != nil {
			return e
		}
		_, e := tx.NewDelete().
			Model((*scheduleEntryModel)(nil)).
			Where("last_seen < ? AND organization_id = ?", before, s.OrganizationID).
			Where("NOT EXISTS (SELECT 1 FROM schedule_links AS l WHERE l.entry_id = ?TableAlias.entry_id AND l.organization_id = ?TableAlias.organization_id)").
			Exec(ctx)
		return e
	})
}

// Scoped shares the pool while enforcing organization ownership on operational records.
func (s *Store) Scoped(id string) *Store {
	if s == nil {
		return nil
	}
	out := *s
	out.OrganizationID = id
	return &out
}
