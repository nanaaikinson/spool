package store

import (
	"context"
	"errors"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/nanaaikinson/spool/db/migrations"
	"github.com/nanaaikinson/spool/internal/domain"
	"golang.org/x/crypto/bcrypt"
)

func identityStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("SPOOL_TEST_DATABASE")
	if dsn == "" {
		t.Skip("set SPOOL_TEST_DATABASE for PostgreSQL integration")
	}
	ctx := context.Background()
	base, e := Open(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	schema := "identity_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e := base.DB.ExecContext(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _, _ = base.DB.ExecContext(ctx, "DROP SCHEMA "+schema+" CASCADE"); _ = base.DB.Close() })
	u, _ := url.Parse(dsn)
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	s, e := Open(ctx, u.String())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = s.DB.Close() })
	return s
}
func TestIdentityIsolationAndConcurrentAdministration(t *testing.T) {
	s := identityStore(t)
	ctx := context.Background()
	key := strings.Repeat("k", 32)
	// Simulate retained legacy records, then verify startup migrations are idempotent.
	for _, migration := range []string{migrations.Initial, migrations.ScheduleEntries, migrations.Organizations} {
		if _, e := s.DB.ExecContext(ctx, migration); e != nil {
			t.Fatal(e)
		}
	}
	legacy, e := s.SaveView(ctx, "root", domain.ViewRequest{Name: "legacy", Path: "/tasks"})
	if e != nil {
		t.Fatal(e)
	}
	setup := domain.SetupRequest{Username: "root", Password: "long-root-password", Organization: domain.OrganizationRequest{Name: "Alpha", RedisURL: "rediss://user:private-secret@redis.example:6380/0"}}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, e := s.Setup(ctx, key, setup); results <- e }()
	}
	wg.Wait()
	close(results)
	successes := 0
	for e := range results {
		if e == nil {
			successes++
		} else if !errors.Is(e, ErrIdentityConflict) {
			t.Fatal(e)
		}
	}
	if successes != 1 {
		t.Fatal("concurrent first setup must create exactly one administrator")
	}
	root, e := s.Authenticate(ctx, "root", setup.Password)
	if e != nil {
		t.Fatal(e)
	}
	if bcrypt.CompareHashAndPassword([]byte(root.PasswordHash), []byte(setup.Password)) != nil || root.PasswordHash == setup.Password {
		t.Fatal("password not hashed")
	}
	orgs, e := s.Organizations(ctx, root.ID, true)
	if e != nil || len(orgs) != 1 {
		t.Fatal(e)
	}
	alpha := s.Scoped(orgs[0].ID)
	betaOrg, e := s.CreateOrganization(ctx, key, root.ID, "root", domain.OrganizationRequest{Name: "Beta", RedisURL: "redis://beta:6379/0"})
	if e != nil {
		t.Fatal(e)
	}
	beta := s.Scoped(betaOrg.ID)
	var cipher []byte
	if e := s.DB.QueryRowContext(ctx, "SELECT connection FROM organizations WHERE id=?", alpha.OrganizationID).Scan(&cipher); e != nil {
		t.Fatal(e)
	}
	if strings.Contains(string(cipher), "private-secret") {
		t.Fatal("connection stored in plaintext")
	}
	if _, e := s.Connection(ctx, alpha.OrganizationID, strings.Repeat("x", 32)); e == nil {
		t.Fatal("wrong key decrypted connection")
	}
	var betaCipher []byte
	if e := s.DB.QueryRowContext(ctx, "SELECT connection FROM organizations WHERE id=?", beta.OrganizationID).Scan(&betaCipher); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.ExecContext(ctx, "UPDATE organizations SET connection=? WHERE id=?", cipher, beta.OrganizationID); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Connection(ctx, beta.OrganizationID, key); e == nil {
		t.Fatal("ciphertext moved between organizations decrypted")
	}
	if _, e := s.DB.ExecContext(ctx, "UPDATE organizations SET connection=? WHERE id=?", betaCipher, beta.OrganizationID); e != nil {
		t.Fatal(e)
	}
	connection, e := s.Connection(ctx, alpha.OrganizationID, key)
	if e != nil || connection.RedisURL != setup.Organization.RedisURL {
		t.Fatal("connection round trip", e)
	}
	views, e := alpha.Views(ctx, "root")
	if e != nil || len(views) != 1 || views[0].ID != legacy.ID {
		t.Fatal("legacy views not adopted", e)
	}
	if e := beta.DeleteView(ctx, "root", legacy.ID); e != nil {
		t.Fatal(e)
	}
	views, _ = alpha.Views(ctx, "root")
	if len(views) != 1 {
		t.Fatal("cross-organization view delete")
	}
	views, _ = beta.Views(ctx, "root")
	if len(views) != 0 {
		t.Fatal("cross-organization view read")
	}
	audit, e := alpha.Begin(ctx, "root", "pause", "common", "same-task")
	if e != nil {
		t.Fatal(e)
	}
	if e := beta.Finish(ctx, audit, true); e == nil {
		t.Fatal("cross-organization audit update")
	}
	if e := alpha.Finish(ctx, audit, true); e != nil {
		t.Fatal(e)
	}
	auditList, e := beta.Audits(ctx, 1, 100)
	if e != nil {
		t.Fatal(e)
	}
	for _, a := range auditList.Data {
		if a.ID == audit {
			t.Fatal("cross-organization audit read")
		}
	}
	for _, org := range []*Store{alpha, beta} {
		if e := org.RecordScheduleEntries(ctx, []domain.Scheduler{{ID: "same-entry", Spec: org.OrganizationID, Type: "same-type"}}); e != nil {
			t.Fatal(e)
		}
		if e := org.RecordScheduleLinks(ctx, []domain.ScheduleLink{{TaskID: "same-task", EntryID: "same-entry", EnqueuedAt: time.Now()}}); e != nil {
			t.Fatal(e)
		}
	}
	refs, e := alpha.ScheduleLinks(ctx, []string{"same-task"})
	if e != nil || refs["same-task"].Spec != alpha.OrganizationID {
		t.Fatal("cross-organization schedule join", e)
	}
	rotated := setup.Organization
	rotated.RedisURL = "rediss://other:rotated-secret@redis.example:6380/0"
	if e := alpha.UpdateConnection(ctx, key, "root", rotated); e != nil {
		t.Fatal(e)
	}
	refs, e = alpha.ScheduleLinks(ctx, []string{"same-task"})
	if e != nil || len(refs) != 1 {
		t.Fatal("credential rotation lost schedule links", e)
	}
	rotated.RedisURL = "rediss://other:rotated-secret@redis.example:6380/1"
	if e := alpha.UpdateConnection(ctx, key, "root", rotated); e != nil {
		t.Fatal(e)
	}
	refs, e = alpha.ScheduleLinks(ctx, []string{"same-task"})
	if e != nil || len(refs) != 0 {
		t.Fatal("new Redis database retained stale schedule links", e)
	}
	refs, e = beta.ScheduleLinks(ctx, []string{"same-task"})
	if e != nil || len(refs) != 1 {
		t.Fatal("connection replacement changed another organization", e)
	}
	// Restore Alpha's links to verify pruning Beta remains scoped.
	if e := alpha.RecordScheduleEntries(ctx, []domain.Scheduler{{ID: "same-entry", Spec: alpha.OrganizationID, Type: "same-type"}}); e != nil {
		t.Fatal(e)
	}
	if e := alpha.RecordScheduleLinks(ctx, []domain.ScheduleLink{{TaskID: "same-task", EntryID: "same-entry", EnqueuedAt: time.Now()}}); e != nil {
		t.Fatal(e)
	}
	if e := beta.PruneSchedules(ctx, time.Now().Add(time.Hour)); e != nil {
		t.Fatal(e)
	}
	refs, e = alpha.ScheduleLinks(ctx, []string{"same-task"})
	if e != nil || len(refs) != 1 {
		t.Fatal("cross-organization schedule prune", e)
	}
	if e := alpha.AddMember(ctx, "root", domain.MemberRequest{Username: "second", Password: "long-second-password", Role: "admin"}); e != nil {
		t.Fatal(e)
	}
	second, _ := s.Authenticate(ctx, "second", "long-second-password")
	if e := alpha.AddMember(ctx, "root", domain.MemberRequest{Username: "second", Password: "replace-password", Role: "viewer"}); !errors.Is(e, ErrIdentityConflict) {
		t.Fatal("existing account password overwritten", e)
	}
	results = make(chan error, 2)
	for _, id := range []string{root.ID, second.ID} {
		wg.Add(1)
		go func(id string) { defer wg.Done(); results <- alpha.ChangeMember(ctx, "root", id, "viewer", false) }(id)
	}
	wg.Wait()
	close(results)
	successes = 0
	for e := range results {
		if e == nil {
			successes++
		} else if !errors.Is(e, ErrLastAdmin) {
			t.Fatal(e)
		}
	}
	if successes != 1 {
		t.Fatal("concurrent demotion lost last administrator")
	}
	if e := s.UpdateUser(ctx, "root", root.ID, domain.UserUpdateRequest{Disabled: new(true)}); !errors.Is(e, ErrLastAdmin) {
		t.Fatal("disabled last deployment administrator", e)
	}
	if e := alpha.AddMember(ctx, "root", domain.MemberRequest{Username: "disabled", Password: "long-disabled-password", Role: "viewer"}); e != nil {
		t.Fatal(e)
	}
	disabled, _ := s.Authenticate(ctx, "disabled", "long-disabled-password")
	if e := s.UpdateUser(ctx, "root", disabled.ID, domain.UserUpdateRequest{Disabled: new(true)}); e != nil {
		t.Fatal(e)
	}
	if e := s.UpdateUser(ctx, "root", disabled.ID, domain.UserUpdateRequest{Password: "reset-disabled-password"}); e != nil {
		t.Fatal(e)
	}
	account, _ := s.Account(ctx, disabled.ID)
	if !account.Disabled {
		t.Fatal("password-only reset reenabled disabled account")
	}
	before, _ := s.Account(ctx, second.ID)
	if e := s.ChangePassword(ctx, second.ID, "long-second-password", "new-second-password"); e != nil {
		t.Fatal(e)
	}
	after, _ := s.Account(ctx, second.ID)
	if before.AuthVersion == after.AuthVersion {
		t.Fatal("password did not revoke sessions")
	}
}
func TestIdentityInput(t *testing.T) {
	for _, password := range []string{"short", strings.Repeat("p", 73)} {
		if _, e := HashPassword(password); !errors.Is(e, ErrIdentityInvalid) {
			t.Fatal("invalid password accepted")
		}
	}
	for _, redis := range []string{"redis-socket://@/tmp/redis.sock", "https://redis.example", "rediss://"} {
		if ValidOrganization(domain.OrganizationRequest{Name: "A", RedisURL: redis}) {
			t.Fatal("invalid connection accepted")
		}
	}
	if ValidName("\n") || ValidRole("owner") || ValidUsername("bad user") {
		t.Fatal("invalid identity input accepted")
	}
}

func TestUpgradeWithRetainedScheduleLinks(t *testing.T) {
	dsn := os.Getenv("SPOOL_TEST_DATABASE")
	if dsn == "" {
		t.Skip("set SPOOL_TEST_DATABASE for integration")
	}
	ctx := context.Background()
	base, e := Open(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer base.DB.Close()
	schema := "upgrade_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e := base.DB.ExecContext(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	defer base.DB.ExecContext(ctx, "DROP SCHEMA "+schema+" CASCADE")
	tx, e := base.DB.BeginTx(ctx, nil)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback()
	if _, e := tx.ExecContext(ctx, "SET LOCAL search_path TO "+schema); e != nil {
		t.Fatal(e)
	}
	for _, sql := range []string{migrations.Initial, migrations.ScheduleEntries, `INSERT INTO schedule_entries(entry_id,spec,task_type) VALUES ('entry','@daily','report')`, `INSERT INTO schedule_links(task_id,entry_id,enqueued_at) VALUES ('task','entry',now())`} {
		if _, e := tx.ExecContext(ctx, sql); e != nil {
			t.Fatal(e)
		}
	}
	if e := tx.Commit(); e != nil {
		t.Fatal(e)
	}
	u, _ := url.Parse(dsn)
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	upgraded, e := Open(ctx, u.String())
	if e != nil {
		t.Fatal(e)
	}
	defer upgraded.DB.Close()
	org, e := upgraded.Setup(ctx, strings.Repeat("d", 32), domain.SetupRequest{Username: "root", Password: "long-root-password", Organization: domain.OrganizationRequest{Name: "Upgrade", RedisURL: "redis://localhost:6379/0"}})
	if e != nil {
		t.Fatal("legacy foreign-key adoption failed", e)
	}
	refs, e := upgraded.Scoped(org.ID).ScheduleLinks(ctx, []string{"task"})
	if e != nil || refs["task"].Spec != "@daily" {
		t.Fatal("migration lost retained links", e)
	}
	again, e := Open(ctx, u.String())
	if e != nil {
		t.Fatal("second startup failed", e)
	}
	_ = again.DB.Close()
}

func TestAdministrationTransferAndRecovery(t *testing.T) {
	s := identityStore(t)
	ctx := context.Background()
	key := strings.Repeat("k", 32)
	org, e := s.Setup(ctx, key, domain.SetupRequest{Username: "owner", Password: "long-owner-password", Organization: domain.OrganizationRequest{Name: "Alpha", RedisURL: "redis://alpha:6379/0"}})
	if e != nil {
		t.Fatal(e)
	}
	owner, _ := s.Authenticate(ctx, "owner", "long-owner-password")
	beta, e := s.CreateOrganization(ctx, key, owner.ID, "owner", domain.OrganizationRequest{Name: "Beta", RedisURL: "redis://beta:6379/0"})
	if e != nil {
		t.Fatal(e)
	}
	alpha := s.Scoped(org.ID)
	if e := alpha.AddMember(ctx, "owner", domain.MemberRequest{Username: "next", Password: "long-next-password", Role: "viewer"}); e != nil {
		t.Fatal(e)
	}
	next, _ := s.Authenticate(ctx, "next", "long-next-password")
	change := domain.AdministrationRequest{Action: "grant", CurrentPassword: "wrong-password", Confirm: true}
	if e := s.ChangeAdministration(ctx, owner.ID, next.ID, change); !errors.Is(e, ErrAdministrationDenied) {
		t.Fatal("wrong password granted authority", e)
	}
	if e := s.RecoverAdministrator(ctx, "next", "recovered-next-password"); !errors.Is(e, ErrIdentityNotFound) {
		t.Fatal("recovery promoted an ordinary account", e)
	}
	change.CurrentPassword = "long-owner-password"
	change.Action = "revoke"
	if e := s.ChangeAdministration(ctx, owner.ID, owner.ID, change); !errors.Is(e, ErrLastAdmin) {
		t.Fatal("removed last administrator", e)
	}
	change.Action = "grant"
	change.Confirm = false
	if e := s.ChangeAdministration(ctx, owner.ID, next.ID, change); !errors.Is(e, ErrIdentityInvalid) {
		t.Fatal("unconfirmed authority change", e)
	}
	change.Confirm = true
	if e := s.ChangeAdministration(ctx, owner.ID, next.ID, change); e != nil {
		t.Fatal(e)
	}
	promoted, _ := s.Account(ctx, next.ID)
	if !promoted.PlatformAdmin || promoted.AuthVersion == next.AuthVersion {
		t.Fatal("promotion did not grant authority and revoke sessions")
	}
	orgs, _ := s.Organizations(ctx, next.ID, promoted.PlatformAdmin)
	if len(orgs) != 2 {
		t.Fatal("promoted administrator cannot see all organizations")
	}
	change.Action = "revoke"
	if e := s.ChangeAdministration(ctx, owner.ID, next.ID, change); e != nil {
		t.Fatal(e)
	}
	revoked, _ := s.Account(ctx, next.ID)
	if revoked.PlatformAdmin || revoked.AuthVersion == promoted.AuthVersion {
		t.Fatal("revocation did not remove authority and sessions")
	}
	change.Action = "transfer"
	if e := s.ChangeAdministration(ctx, owner.ID, owner.ID, change); !errors.Is(e, ErrIdentityInvalid) {
		t.Fatal("self-transfer accepted", e)
	}
	if _, e := s.DB.ExecContext(ctx, "UPDATE users SET disabled=true WHERE id=?", next.ID); e != nil {
		t.Fatal(e)
	}
	if e := s.ChangeAdministration(ctx, owner.ID, next.ID, change); !errors.Is(e, ErrIdentityInvalid) {
		t.Fatal("transferred to disabled account", e)
	}
	stillOwner, _ := s.Account(ctx, owner.ID)
	if !stillOwner.PlatformAdmin {
		t.Fatal("failed transfer removed owner")
	}
	if _, e := s.DB.ExecContext(ctx, "UPDATE users SET disabled=false WHERE id=?", next.ID); e != nil {
		t.Fatal(e)
	}
	if e := s.ChangeAdministration(ctx, owner.ID, next.ID, change); e != nil {
		t.Fatal(e)
	}
	former, _ := s.Account(ctx, owner.ID)
	successor, _ := s.Account(ctx, next.ID)
	if former.PlatformAdmin || !successor.PlatformAdmin || former.AuthVersion == owner.AuthVersion || successor.AuthVersion == revoked.AuthVersion {
		t.Fatal("transfer was incomplete")
	}
	membership, _ := s.Organization(ctx, org.ID, owner.ID, false)
	if membership.Role != "admin" {
		t.Fatal("transfer changed organization membership")
	}
	if e := s.ChangeAdministration(ctx, owner.ID, next.ID, domain.AdministrationRequest{Action: "revoke", CurrentPassword: "long-owner-password", Confirm: true}); !errors.Is(e, ErrAdministrationDenied) {
		t.Fatal("former owner retained authority", e)
	}
	if e := s.RecoverAdministrator(ctx, "owner", "recovered-owner-password"); !errors.Is(e, ErrIdentityNotFound) {
		t.Fatal("recovery restored transferred authority", e)
	}
	if _, e := s.DB.ExecContext(ctx, "UPDATE users SET disabled=true WHERE id=?", next.ID); e != nil {
		t.Fatal(e)
	}
	if e := s.RecoverAdministrator(ctx, "next", "recovered-next-password"); e != nil {
		t.Fatal(e)
	}
	recovered, e := s.Authenticate(ctx, "next", "recovered-next-password")
	if e != nil || recovered.Disabled || recovered.AuthVersion == successor.AuthVersion {
		t.Fatal("recovery failed to re-enable and revoke sessions", e)
	}
	if _, e := s.Authenticate(ctx, "next", "long-next-password"); e == nil {
		t.Fatal("old password survived recovery")
	}
	for _, id := range []string{org.ID, beta.ID} {
		audits, e := s.Scoped(id).Audits(ctx, 1, 100)
		if e != nil {
			t.Fatal(e)
		}
		actions := map[string]bool{}
		for _, a := range audits.Data {
			actions[a.Action] = true
		}
		for _, action := range []string{"administration.grant", "administration.revoke", "administration.transfer", "administration.recover"} {
			if !actions[action] {
				t.Fatal("missing administration audit", id, action)
			}
		}
	}
}

func TestConcurrentAdministratorRevocation(t *testing.T) {
	s := identityStore(t)
	ctx := context.Background()
	org, e := s.Setup(ctx, strings.Repeat("k", 32), domain.SetupRequest{Username: "first", Password: "long-first-password", Organization: domain.OrganizationRequest{Name: "Alpha", RedisURL: "redis://alpha:6379/0"}})
	if e != nil {
		t.Fatal(e)
	}
	first, _ := s.Authenticate(ctx, "first", "long-first-password")
	if e := s.Scoped(org.ID).AddMember(ctx, "first", domain.MemberRequest{Username: "second", Password: "long-second-password", Role: "viewer"}); e != nil {
		t.Fatal(e)
	}
	second, _ := s.Authenticate(ctx, "second", "long-second-password")
	if e := s.ChangeAdministration(ctx, first.ID, second.ID, domain.AdministrationRequest{Action: "grant", CurrentPassword: "long-first-password", Confirm: true}); e != nil {
		t.Fatal(e)
	}
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, account := range []struct{ id, password string }{{first.ID, "long-first-password"}, {second.ID, "long-second-password"}} {
		wg.Add(1)
		go func(id, password string) {
			defer wg.Done()
			results <- s.ChangeAdministration(ctx, id, id, domain.AdministrationRequest{Action: "revoke", CurrentPassword: password, Confirm: true})
		}(account.id, account.password)
	}
	wg.Wait()
	close(results)
	successes := 0
	for e := range results {
		if e == nil {
			successes++
		} else if !errors.Is(e, ErrLastAdmin) {
			t.Fatal(e)
		}
	}
	if successes != 1 {
		t.Fatal("concurrent revocation lost last administrator")
	}
}
