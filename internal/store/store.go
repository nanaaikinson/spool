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

type Store struct {
	DB     *bun.DB
	audits cdb.Repository[*auditModel]
	views  cdb.Repository[*viewModel]
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
		_, e := tx.ExecContext(ctx, migrations.Initial)
		return e
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
		return errors.New("audit intent no longer pending")
	}
	return nil
}

func (s *Store) Audits(ctx context.Context) ([]domain.Audit, error) {
	if s == nil {
		return nil, ErrUnavailable
	}
	rows, e := s.audits.GetMany(
		ctx,
		func(q *bun.SelectQuery) *bun.SelectQuery {
			return q.OrderExpr("created_at DESC, id DESC").Limit(100)
		},
	)
	out := make([]domain.Audit, 0, len(rows))
	for _, r := range rows {
		out = append(
			out,
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
	return out, e
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
