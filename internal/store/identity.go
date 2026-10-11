package store

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/nanaaikinson/spool/internal/domain"
	"github.com/uptrace/bun"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrIdentityConflict     = errors.New("identity conflict")
	ErrIdentityInvalid      = errors.New("invalid identity input")
	ErrLastAdmin            = errors.New("last active administrator")
	ErrIdentityNotFound     = errors.New("identity not found")
	ErrAdministrationDenied = errors.New("administrator verification failed")
)
var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_.@-]{1,80}$`)

func ValidUsername(s string) bool { return usernamePattern.MatchString(s) }
func ValidRole(s string) bool     { return s == "admin" || s == "operator" || s == "viewer" }
func ValidName(s string) bool {
	return strings.TrimSpace(s) != "" && len(s) <= 80 && !strings.ContainsAny(s, "\r\n\x00")
}
func HashPassword(password string) (string, error) {
	// bcrypt accepts at most 72 bytes. Enforce this instead of silently truncating.
	if len(password) < 12 || len(password) > 72 {
		return "", ErrIdentityInvalid
	}
	b, e := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(b), e
}
func ValidOrganization(in domain.OrganizationRequest) bool {
	u, e := url.Parse(in.RedisURL)
	if e != nil || !ValidName(in.Name) || u.Hostname() == "" || (u.Scheme != "redis" && u.Scheme != "rediss" && u.Scheme != "redis-sentinel") {
		return false
	}
	if _, e := asynq.ParseRedisURI(in.RedisURL); e != nil {
		return false
	}
	if in.PrometheusURL != "" {
		u, e = url.Parse(in.PrometheusURL)
		if e != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return false
		}
	}
	return true
}

// Connection is encrypted with an independent installation key and organization ID as AAD.
func sealConnection(key, id string, in domain.OrganizationRequest) ([]byte, error) {
	sum := sha256.Sum256([]byte(key))
	block, e := aes.NewCipher(sum[:])
	if e != nil {
		return nil, e
	}
	gcm, e := cipher.NewGCM(block)
	if e != nil {
		return nil, e
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, e := rand.Read(nonce); e != nil {
		return nil, e
	}
	raw, e := json.Marshal(in)
	if e != nil {
		return nil, e
	}
	return gcm.Seal(nonce, nonce, raw, []byte(id)), nil
}
func (s *Store) Connection(ctx context.Context, id, key string) (domain.OrganizationRequest, error) {
	var encrypted []byte
	if e := s.DB.QueryRowContext(ctx, "SELECT connection FROM organizations WHERE id = ?", id).Scan(&encrypted); e != nil {
		return domain.OrganizationRequest{}, e
	}
	return openConnection(key, id, encrypted)
}
func openConnection(key, id string, encrypted []byte) (domain.OrganizationRequest, error) {
	var in domain.OrganizationRequest
	sum := sha256.Sum256([]byte(key))
	block, e := aes.NewCipher(sum[:])
	if e != nil {
		return in, e
	}
	gcm, e := cipher.NewGCM(block)
	if e != nil || len(encrypted) < gcm.NonceSize() {
		return in, ErrIdentityInvalid
	}
	raw, e := gcm.Open(nil, encrypted[:gcm.NonceSize()], encrypted[gcm.NonceSize():], []byte(id))
	if e != nil {
		return in, ErrIdentityInvalid
	}
	if json.Unmarshal(raw, &in) != nil {
		return in, ErrIdentityInvalid
	}
	return in, nil
}

type Account struct {
	domain.User
	PasswordHash string `json:"-"`
	AuthVersion  int    `json:"-"`
}

func (s *Store) Account(ctx context.Context, id string) (Account, error) {
	var u Account
	e := s.DB.QueryRowContext(ctx, "SELECT id, username, password_hash, disabled, platform_admin, auth_version, created_at FROM users WHERE id = ?", id).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Disabled, &u.PlatformAdmin, &u.AuthVersion, &u.CreatedAt)
	return u, e
}

// Dummy hash keeps nonexistent usernames on the same password verification path.
var dummyHash = "$2a$10$7EqJtq98hPqEX7fNZaFWoO5.cNYCfvDaP.sQDKmLcmSRyET/Ekmn."

func (s *Store) Authenticate(ctx context.Context, username, password string) (Account, error) {
	var id string
	e := s.DB.QueryRowContext(ctx, "SELECT id FROM users WHERE username = ?", username).Scan(&id)
	if e != nil {
		_ = bcrypt.CompareHashAndPassword([]byte(dummyHash), []byte(password))
		return Account{}, ErrIdentityNotFound
	}
	u, e := s.Account(ctx, id)
	if e != nil {
		return u, e
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil || u.Disabled {
		return Account{}, ErrIdentityNotFound
	}
	return u, nil
}
func (s *Store) NeedsSetup(ctx context.Context) (bool, error) {
	var n int
	e := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM users").Scan(&n)
	return n == 0, e
}

// identityTx serializes the rare identity writes, including setup and last-admin checks.
// ponytail: one database lock; replace with ordered per-organization locks if identity write traffic grows.
func (s *Store) identityTx(ctx context.Context, fn func(bun.Tx) error) error {
	return s.DB.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, e := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(74290312)"); e != nil {
			return e
		}
		return fn(tx)
	})
}
func identityAudit(ctx context.Context, tx bun.Tx, org, actor, action, target string) error {
	_, e := tx.ExecContext(ctx, "INSERT INTO audit_logs(id, organization_id, actor, action, queue, task_id, status) VALUES (?, ?, ?, ?, '', ?, 'succeeded')", uuid.NewString(), org, actor, action, target)
	return e
}
func insertOrganization(ctx context.Context, tx bun.Tx, key string, in domain.OrganizationRequest, userID string) (domain.Organization, error) {
	org := domain.Organization{ID: uuid.NewString(), Name: strings.TrimSpace(in.Name), Role: "admin"}
	encrypted, e := sealConnection(key, org.ID, in)
	if e != nil {
		return org, e
	}
	if e = tx.QueryRowContext(ctx, "INSERT INTO organizations(id, name, connection) VALUES (?, ?, ?) RETURNING created_at", org.ID, org.Name, encrypted).Scan(&org.CreatedAt); e != nil {
		return org, e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO organization_members(organization_id, user_id, role) VALUES (?, ?, 'admin')", org.ID, userID)
	return org, e
}
func (s *Store) Setup(ctx context.Context, key string, in domain.SetupRequest, viewer ...domain.LoginRequest) (domain.Organization, error) {
	if !ValidUsername(in.Username) || !ValidOrganization(in.Organization) {
		return domain.Organization{}, ErrIdentityInvalid
	}
	hash, e := HashPassword(in.Password)
	if e != nil {
		return domain.Organization{}, e
	}
	viewerHash := ""
	if len(viewer) > 1 {
		return domain.Organization{}, ErrIdentityInvalid
	}
	if len(viewer) == 1 {
		if !ValidUsername(viewer[0].Username) || viewer[0].Username == in.Username {
			return domain.Organization{}, ErrIdentityInvalid
		}
		viewerHash, e = HashPassword(viewer[0].Password)
		if e != nil {
			return domain.Organization{}, e
		}
	}
	var org domain.Organization
	e = s.identityTx(ctx, func(tx bun.Tx) error {
		var n int
		if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM users").Scan(&n); e != nil {
			return e
		}
		if n != 0 {
			return ErrIdentityConflict
		}
		id := uuid.NewString()
		if _, e := tx.ExecContext(ctx, "INSERT INTO users(id, username, password_hash, platform_admin) VALUES (?, ?, ?, true)", id, in.Username, hash); e != nil {
			return e
		}
		var e error
		org, e = insertOrganization(ctx, tx, key, in.Organization, id)
		if e != nil {
			return e
		}
		for _, table := range []string{"audit_logs", "saved_views", "schedule_entries", "schedule_links"} {
			if _, e := tx.ExecContext(ctx, "UPDATE "+table+" SET organization_id = ? WHERE organization_id = ''", org.ID); e != nil {
				return e
			}
		}
		if len(viewer) == 1 {
			viewerID := uuid.NewString()
			if _, e := tx.ExecContext(ctx, "INSERT INTO users(id, username, password_hash) VALUES (?, ?, ?)", viewerID, viewer[0].Username, viewerHash); e != nil {
				return e
			}
			if _, e := tx.ExecContext(ctx, "INSERT INTO organization_members(organization_id, user_id, role) VALUES (?, ?, 'viewer')", org.ID, viewerID); e != nil {
				return e
			}
		}
		return identityAudit(ctx, tx, org.ID, in.Username, "organization.setup", org.ID)
	})
	return org, e
}
func (s *Store) Organizations(ctx context.Context, userID string, platform bool) ([]domain.Organization, error) {
	out := []domain.Organization{}
	query := "SELECT o.id, o.name, m.role, o.created_at FROM organizations o JOIN organization_members m ON m.organization_id = o.id WHERE m.user_id = ? ORDER BY o.created_at, o.id"
	args := []any{userID}
	if platform {
		query = "SELECT id, name, 'admin', created_at FROM organizations ORDER BY created_at, id"
		args = nil
	}
	rows, e := s.DB.QueryContext(ctx, query, args...)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var o domain.Organization
		if e := rows.Scan(&o.ID, &o.Name, &o.Role, &o.CreatedAt); e != nil {
			return out, e
		}
		out = append(out, o)
	}
	return out, rows.Err()
}
func (s *Store) Organization(ctx context.Context, org, user string, platform bool) (domain.Organization, error) {
	var o domain.Organization
	query := "SELECT o.id, o.name, m.role, o.created_at FROM organizations o JOIN organization_members m ON m.organization_id = o.id WHERE o.id = ? AND m.user_id = ?"
	args := []any{org, user}
	if platform {
		query = "SELECT id, name, 'admin', created_at FROM organizations WHERE id = ?"
		args = []any{org}
	}
	e := s.DB.QueryRowContext(ctx, query, args...).Scan(&o.ID, &o.Name, &o.Role, &o.CreatedAt)
	return o, e
}
func (s *Store) CreateOrganization(ctx context.Context, key, userID, actor string, in domain.OrganizationRequest) (domain.Organization, error) {
	if !ValidOrganization(in) {
		return domain.Organization{}, ErrIdentityInvalid
	}
	var org domain.Organization
	e := s.identityTx(ctx, func(tx bun.Tx) error {
		var e error
		org, e = insertOrganization(ctx, tx, key, in, userID)
		if e != nil {
			return e
		}
		return identityAudit(ctx, tx, org.ID, actor, "organization.create", org.ID)
	})
	return org, e
}
func (s *Store) RenameOrganization(ctx context.Context, actor, name string) error {
	if !ValidName(name) {
		return ErrIdentityInvalid
	}
	return s.identityTx(ctx, func(tx bun.Tx) error {
		if _, e := tx.ExecContext(ctx, "UPDATE organizations SET name = ? WHERE id = ?", strings.TrimSpace(name), s.OrganizationID); e != nil {
			return e
		}
		return identityAudit(ctx, tx, s.OrganizationID, actor, "organization.rename", s.OrganizationID)
	})
}
func (s *Store) UpdateConnection(ctx context.Context, key, actor string, in domain.OrganizationRequest) error {
	if !ValidOrganization(in) {
		return ErrIdentityInvalid
	}
	encrypted, e := sealConnection(key, s.OrganizationID, in)
	if e != nil {
		return e
	}
	return s.identityTx(ctx, func(tx bun.Tx) error {
		var previous []byte
		if e := tx.QueryRowContext(ctx, "SELECT connection FROM organizations WHERE id = ?", s.OrganizationID).Scan(&previous); e != nil {
			return e
		}
		old, e := openConnection(key, s.OrganizationID, previous)
		if e != nil {
			return e
		}
		// Links refer to tasks in a specific Redis destination, not just task IDs.
		if redisDestination(old.RedisURL) != redisDestination(in.RedisURL) {
			if _, e := tx.ExecContext(ctx, "DELETE FROM schedule_entries WHERE organization_id = ?", s.OrganizationID); e != nil {
				return e
			}
		}
		if _, e := tx.ExecContext(ctx, "UPDATE organizations SET name = ?, connection = ? WHERE id = ?", strings.TrimSpace(in.Name), encrypted, s.OrganizationID); e != nil {
			return e
		}
		return identityAudit(ctx, tx, s.OrganizationID, actor, "organization.connection", s.OrganizationID)
	})
}

// Ignore credential rotations when deciding whether stored schedule links still apply.
func redisDestination(address string) string {
	u, _ := url.Parse(address) // Both stored and replacement connections are validated.
	u.User = nil
	u.Fragment = ""
	q := u.Query()
	q.Del("sentinel_password")
	u.RawQuery = q.Encode()
	return u.String()
}
func (s *Store) Members(ctx context.Context) ([]domain.Member, error) {
	out := []domain.Member{}
	rows, e := s.DB.QueryContext(ctx, "SELECT u.id, u.username, m.role, u.disabled FROM organization_members m JOIN users u ON u.id=m.user_id WHERE m.organization_id = ? ORDER BY u.username", s.OrganizationID)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var u domain.Member
		if e := rows.Scan(&u.ID, &u.Username, &u.Role, &u.Disabled); e != nil {
			return out, e
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
func (s *Store) AddMember(ctx context.Context, actor string, in domain.MemberRequest) error {
	if !ValidUsername(in.Username) || !ValidRole(in.Role) {
		return ErrIdentityInvalid
	}
	hash := ""
	if in.Password != "" {
		var e error
		hash, e = HashPassword(in.Password)
		if e != nil {
			return e
		}
	}
	return s.identityTx(ctx, func(tx bun.Tx) error {
		var id string
		e := tx.QueryRowContext(ctx, "SELECT id FROM users WHERE username = ?", in.Username).Scan(&id)
		if errors.Is(e, sql.ErrNoRows) {
			if hash == "" {
				return ErrIdentityNotFound
			}
			id = uuid.NewString()
			if _, e := tx.ExecContext(ctx, "INSERT INTO users(id, username, password_hash) VALUES (?, ?, ?)", id, in.Username, hash); e != nil {
				return e
			}
		} else if e != nil {
			return e
		} else if hash != "" {
			return ErrIdentityConflict
		}
		var exists int
		if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM organization_members WHERE organization_id=? AND user_id=?", s.OrganizationID, id).Scan(&exists); e != nil {
			return e
		}
		if exists != 0 {
			return ErrIdentityConflict
		}
		if _, e := tx.ExecContext(ctx, "INSERT INTO organization_members(organization_id,user_id,role) VALUES (?,?,?)", s.OrganizationID, id, in.Role); e != nil {
			return e
		}
		return identityAudit(ctx, tx, s.OrganizationID, actor, "member.add."+in.Role, id)
	})
}
func (s *Store) ChangeMember(ctx context.Context, actor, id, role string, remove bool) error {
	if !remove && !ValidRole(role) {
		return ErrIdentityInvalid
	}
	return s.identityTx(ctx, func(tx bun.Tx) error {
		var old string
		if e := tx.QueryRowContext(ctx, "SELECT role FROM organization_members WHERE organization_id=? AND user_id=?", s.OrganizationID, id).Scan(&old); errors.Is(e, sql.ErrNoRows) {
			return ErrIdentityNotFound
		} else if e != nil {
			return e
		}
		if old == "admin" && (remove || role != "admin") {
			var n int
			if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM organization_members m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? AND m.role='admin' AND NOT u.disabled AND u.id<>?", s.OrganizationID, id).Scan(&n); e != nil {
				return e
			}
			if n == 0 {
				return ErrLastAdmin
			}
		}
		action := "member.role." + role
		if remove {
			action = "member.remove"
			if _, e := tx.ExecContext(ctx, "DELETE FROM organization_members WHERE organization_id=? AND user_id=?", s.OrganizationID, id); e != nil {
				return e
			}
		} else {
			if _, e := tx.ExecContext(ctx, "UPDATE organization_members SET role=? WHERE organization_id=? AND user_id=?", role, s.OrganizationID, id); e != nil {
				return e
			}
		}
		return identityAudit(ctx, tx, s.OrganizationID, actor, action, id)
	})
}
func (s *Store) Users(ctx context.Context) ([]domain.User, error) {
	out := []domain.User{}
	rows, e := s.DB.QueryContext(ctx, "SELECT id,username,disabled,platform_admin,created_at FROM users ORDER BY username")
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var u domain.User
		if e := rows.Scan(&u.ID, &u.Username, &u.Disabled, &u.PlatformAdmin, &u.CreatedAt); e != nil {
			return out, e
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
func (s *Store) UpdateUser(ctx context.Context, actor, id string, in domain.UserUpdateRequest) error {
	hash := ""
	if in.Password != "" {
		var e error
		hash, e = HashPassword(in.Password)
		if e != nil {
			return e
		}
	}
	return s.identityTx(ctx, func(tx bun.Tx) error {
		var platform bool
		if e := tx.QueryRowContext(ctx, "SELECT platform_admin FROM users WHERE id=?", id).Scan(&platform); errors.Is(e, sql.ErrNoRows) {
			return ErrIdentityNotFound
		} else if e != nil {
			return e
		}
		if in.Disabled != nil && *in.Disabled {
			var n int
			if platform {
				if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM users WHERE platform_admin AND NOT disabled AND id<>?", id).Scan(&n); e != nil {
					return e
				}
				if n == 0 {
					return ErrLastAdmin
				}
			}
			if e := tx.QueryRowContext(ctx, `SELECT count(*) FROM organization_members m WHERE m.user_id=? AND m.role='admin' AND NOT EXISTS (SELECT 1 FROM organization_members other JOIN users u ON u.id=other.user_id WHERE other.organization_id=m.organization_id AND other.role='admin' AND NOT u.disabled AND u.id<>?)`, id, id).Scan(&n); e != nil {
				return e
			}
			if n > 0 {
				return ErrLastAdmin
			}
		}
		if _, e := tx.ExecContext(ctx, "UPDATE users SET disabled=COALESCE(?, disabled), password_hash=CASE WHEN ?='' THEN password_hash ELSE ? END, auth_version=auth_version+1 WHERE id=?", in.Disabled, hash, hash, id); e != nil {
			return e
		}
		action := "user.password_reset"
		if in.Disabled != nil {
			if *in.Disabled {
				action = "user.disable"
			} else {
				action = "user.enable"
			}
		}
		return identityAudit(ctx, tx, s.OrganizationID, actor, action, id)
	})
}
func (s *Store) ChangePassword(ctx context.Context, id, current, password string) error {
	hash, e := HashPassword(password)
	if e != nil {
		return e
	}
	return s.identityTx(ctx, func(tx bun.Tx) error {
		var stored, actor string
		if e := tx.QueryRowContext(ctx, "SELECT password_hash,username FROM users WHERE id=?", id).Scan(&stored, &actor); e != nil {
			return e
		}
		if bcrypt.CompareHashAndPassword([]byte(stored), []byte(current)) != nil {
			return ErrIdentityNotFound
		}
		if _, e := tx.ExecContext(ctx, "UPDATE users SET password_hash=?,auth_version=auth_version+1 WHERE id=?", hash, id); e != nil {
			return e
		}
		return identityAudit(ctx, tx, s.OrganizationID, actor, "user.password", id)
	})
}

// Changes to deployment authority are visible in every organization's audit log.
func administrationAudit(ctx context.Context, tx bun.Tx, actor, action, target string) error {
	var ids []string
	if e := tx.NewSelect().Table("organizations").Column("id").Scan(ctx, &ids); e != nil {
		return e
	}
	for _, id := range ids {
		if e := identityAudit(ctx, tx, id, actor, action, target); e != nil {
			return e
		}
	}
	return nil
}

func (s *Store) ChangeAdministration(ctx context.Context, actorID, targetID string, in domain.AdministrationRequest) error {
	if !in.Confirm || (in.Action != "grant" && in.Action != "revoke" && in.Action != "transfer") || (in.Action == "transfer" && actorID == targetID) {
		return ErrIdentityInvalid
	}
	return s.identityTx(ctx, func(tx bun.Tx) error {
		var actor, hash string
		var active bool
		if e := tx.QueryRowContext(ctx, "SELECT username, password_hash, platform_admin AND NOT disabled FROM users WHERE id=?", actorID).Scan(&actor, &hash, &active); e != nil {
			return e
		}
		// Recheck authority inside the write lock; a concurrent transfer may have revoked it.
		if !active || bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.CurrentPassword)) != nil {
			return ErrAdministrationDenied
		}
		var disabled, platform bool
		if e := tx.QueryRowContext(ctx, "SELECT disabled, platform_admin FROM users WHERE id=?", targetID).Scan(&disabled, &platform); errors.Is(e, sql.ErrNoRows) {
			return ErrIdentityNotFound
		} else if e != nil {
			return e
		}
		if in.Action != "revoke" && disabled {
			return ErrIdentityInvalid
		}
		if in.Action == "revoke" && platform && !disabled {
			var n int
			if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM users WHERE platform_admin AND NOT disabled AND id<>?", targetID).Scan(&n); e != nil {
				return e
			}
			if n == 0 {
				return ErrLastAdmin
			}
		}
		if _, e := tx.ExecContext(ctx, "UPDATE users SET platform_admin=?, auth_version=auth_version+1 WHERE id=?", in.Action != "revoke", targetID); e != nil {
			return e
		}
		if in.Action == "transfer" {
			if _, e := tx.ExecContext(ctx, "UPDATE users SET platform_admin=false, auth_version=auth_version+1 WHERE id=?", actorID); e != nil {
				return e
			}
		}
		return administrationAudit(ctx, tx, actor, "administration."+in.Action, targetID)
	})
}

// RecoverAdministrator is only called by the local operator CLI, never a public API.
// It cannot create accounts or promote ordinary members.
func (s *Store) RecoverAdministrator(ctx context.Context, username, password string) error {
	if !ValidUsername(username) {
		return ErrIdentityInvalid
	}
	hash, e := HashPassword(password)
	if e != nil {
		return e
	}
	return s.identityTx(ctx, func(tx bun.Tx) error {
		var id string
		if e := tx.QueryRowContext(ctx, "SELECT id FROM users WHERE username=? AND platform_admin", username).Scan(&id); errors.Is(e, sql.ErrNoRows) {
			return ErrIdentityNotFound
		} else if e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, "UPDATE users SET disabled=false, password_hash=?, auth_version=auth_version+1 WHERE id=?", hash, id); e != nil {
			return e
		}
		return administrationAudit(ctx, tx, "operator-cli", "administration.recover", id)
	})
}
