package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/nanaaikinson/spool/internal/domain"
	"github.com/uptrace/bun"
)

func TestAuditAndSavedViews(t *testing.T) {
	s, e := Open(context.Background(), filepath.Join(t.TempDir(), "spool.db"))
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
	// At least three records exist, so pages of two have a second page.
	for i := 0; i < 2; i++ {
		more, e := s.Begin(ctx, actor, "retry", "test", "task")
		if e != nil {
			t.Fatal(e)
		}
		defer s.DB.NewDelete().Model((*auditModel)(nil)).Where("id = ?", more).Exec(ctx)
	}
	first, e := s.Audits(ctx, 1, 2)
	if e != nil || len(first.Data) != 2 || first.Total < 3 || first.Page != 1 {
		t.Fatal("first audit page", first, e)
	}
	second, e := s.Audits(ctx, 2, 2)
	if e != nil || len(second.Data) == 0 || second.Page != 2 {
		t.Fatal("second audit page", second, e)
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

func TestScheduleLinks(t *testing.T) {
	s, e := Open(context.Background(), filepath.Join(t.TempDir(), "spool.db"))
	if e != nil {
		t.Fatal(e)
	}
	defer s.DB.Close()
	ctx := context.Background()
	suffix := time.Now().Format("150405.000000000")
	entry, old := "test-entry-"+suffix, "test-old-entry-"+suffix
	defer s.DB.NewDelete().Model((*scheduleEntryModel)(nil)).Where("entry_id IN (?)", bun.In([]string{entry, old})).Exec(ctx)
	if e := s.RecordScheduleEntries(ctx, []domain.Scheduler{{ID: entry, Spec: "@every 1m", Type: "report:generate"}}); e != nil {
		t.Fatal(e)
	}
	// A later sighting updates the spec in place rather than adding a row.
	if e := s.RecordScheduleEntries(ctx, []domain.Scheduler{{ID: entry, Spec: "0 * * * *", Type: "report:generate"}}); e != nil {
		t.Fatal(e)
	}
	now := time.Now()
	links := []domain.ScheduleLink{{TaskID: "task-a-" + suffix, EntryID: entry, EnqueuedAt: now}}
	if e := s.RecordScheduleLinks(ctx, links); e != nil {
		t.Fatal(e)
	}
	if e := s.RecordScheduleLinks(ctx, links); e != nil {
		t.Fatal("duplicate link rejected", e)
	}
	refs, e := s.ScheduleLinks(ctx, []string{"task-a-" + suffix, "task-missing-" + suffix})
	if e != nil {
		t.Fatal(e)
	}
	if len(refs) != 1 || refs["task-a-"+suffix] != (domain.ScheduleRef{EntryID: entry, Spec: "0 * * * *"}) {
		t.Fatalf("links = %+v", refs)
	}
	// Pruning drops stale links, then entries left without links.
	if _, e := s.DB.NewInsert().Model(&scheduleEntryModel{EntryID: old, Spec: "@daily", TaskType: "x", FirstSeen: now.Add(-48 * time.Hour), LastSeen: now.Add(-48 * time.Hour)}).Exec(ctx); e != nil {
		t.Fatal(e)
	}
	if e := s.RecordScheduleLinks(ctx, []domain.ScheduleLink{{TaskID: "task-old-" + suffix, EntryID: old, EnqueuedAt: now.Add(-48 * time.Hour)}}); e != nil {
		t.Fatal(e)
	}
	if e := s.PruneSchedules(ctx, now.Add(-24*time.Hour)); e != nil {
		t.Fatal(e)
	}
	left, e := s.DB.NewSelect().Model((*scheduleEntryModel)(nil)).Where("entry_id IN (?)", bun.In([]string{entry, old})).Count(ctx)
	if e != nil || left != 1 {
		t.Fatalf("entries after prune = %d, %v", left, e)
	}
	refs, e = s.ScheduleLinks(ctx, []string{"task-a-" + suffix, "task-old-" + suffix})
	if e != nil || len(refs) != 1 {
		t.Fatalf("links after prune = %+v, %v", refs, e)
	}
}

func TestOpenAppliesPragmasAndReopens(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "spool.db")
	s, e := Open(ctx, path)
	if e != nil {
		t.Fatal(e)
	}
	var fk int
	var mode string
	if e := s.DB.QueryRowContext(ctx, "PRAGMA foreign_keys").Scan(&fk); e != nil || fk != 1 {
		t.Fatalf("foreign_keys = %d, %v", fk, e)
	}
	if e := s.DB.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&mode); e != nil || mode != "wal" {
		t.Fatalf("journal_mode = %q, %v", mode, e)
	}
	if _, e := s.Begin(ctx, "admin", "retry", "q", "t"); e != nil {
		t.Fatal(e)
	}
	s.DB.Close()
	// Migrations are idempotent and data survives a restart.
	s, e = Open(ctx, path)
	if e != nil {
		t.Fatal(e)
	}
	defer s.DB.Close()
	list, e := s.Audits(ctx, 1, 10)
	if e != nil || list.Total != 1 {
		t.Fatalf("after reopen: %+v, %v", list, e)
	}
	if _, e := Open(ctx, filepath.Join(t.TempDir(), "missing", "spool.db")); e == nil {
		t.Fatal("opened a database in a missing directory")
	}
}
