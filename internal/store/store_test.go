package store

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/nanaaikinson/spool/internal/domain"
)

func TestAuditAndSavedViews(t *testing.T) {
	dsn := os.Getenv("SPOOL_TEST_DATABASE")
	if dsn == "" {
		t.Skip("set SPOOL_TEST_DATABASE for PostgreSQL integration")
	}
	s, e := Open(context.Background(), dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer s.DB.Close()
	ctx := context.Background()
	actor := "test-" + time.Now().Format("150405.000000000")
	id, e := s.Begin(ctx, actor, "archive", "test", "task")
	if e != nil {
		t.Fatal(e)
	}
	defer s.DB.NewDelete().Model((*auditModel)(nil)).Where("id = ?", id).Exec(ctx)
	if e = s.Finish(ctx, id, true); e != nil {
		t.Fatal(e)
	}
	if e = s.Finish(ctx, id, false); e == nil {
		t.Fatal("finalized audit overwritten")
	}
	v, e := s.SaveView(ctx, actor, domain.ViewRequest{Name: "Failed jobs", Path: "/tasks?state=retry"})
	if e != nil || v.ID == "" {
		t.Fatal("saved view", e)
	}
	defer s.DeleteView(ctx, actor, v.ID)
	others, e := s.Views(ctx, actor+"-other")
	if e != nil || len(others) != 0 {
		t.Fatal("view ownership leaked")
	}
	mine, e := s.Views(ctx, actor)
	if e != nil || len(mine) != 1 {
		t.Fatal("own view missing")
	}
}
