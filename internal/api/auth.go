package api

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/nanaaikinson/spool/internal/domain"
	"github.com/nanaaikinson/spool/internal/store"
	"github.com/nanaaikinson/spool/internal/version"
)

type claims struct {
	UserID         string               `json:"user_id,omitempty"`
	OrganizationID string               `json:"organization_id,omitempty"`
	AuthVersion    int                  `json:"auth_version,omitempty"`
	PlatformAdmin  bool                 `json:"-"`
	Organization   *domain.Organization `json:"-"`
	Actor          string               `json:"actor"`
	Role           string               `json:"role"`
	Expires        int64                `json:"exp"`
}

type authKey struct{}

func (a *API) authRequired() bool {
	return a.Config.MultiOrg || a.Config.AdminUser != "" || a.Config.ViewerUser != ""
}

func (a *API) identity(r *http.Request) (claims, bool) {
	if !a.authRequired() {
		role := "admin"
		if a.Config.ReadOnly {
			role = "viewer"
		}
		return claims{Actor: "local", Role: role}, true
	}
	cookie, e := r.Cookie("spool_session")
	if e != nil {
		return claims{}, false
	}
	parts := strings.Split(cookie.Value, ".")
	if len(parts) != 2 {
		return claims{}, false
	}
	sig, e := base64.RawURLEncoding.DecodeString(parts[1])
	if e != nil {
		return claims{}, false
	}
	mac := hmac.New(sha256.New, []byte(a.Config.SessionKey))
	mac.Write([]byte(parts[0]))
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return claims{}, false
	}
	raw, e := base64.RawURLEncoding.DecodeString(parts[0])
	var c claims
	if e != nil || json.Unmarshal(raw, &c) != nil || c.Expires <= time.Now().Unix() {
		return claims{}, false
	}
	if a.Config.MultiOrg {
		if a.Store == nil || c.UserID == "" {
			return claims{}, false
		}
		u, e := a.Store.Account(r.Context(), c.UserID)
		if e != nil || u.Disabled || u.AuthVersion != c.AuthVersion {
			return claims{}, false
		}
		c.Actor, c.PlatformAdmin, c.Role = u.Username, u.PlatformAdmin, ""
		explicit := r.Header.Get("X-Spool-Organization")
		if r.URL.Path == "/api/v1/events" && r.URL.Query().Get("organization") != "" {
			explicit = r.URL.Query().Get("organization")
		}
		if explicit != "" {
			c.OrganizationID = explicit
		}
		if c.OrganizationID != "" {
			org, e := a.Store.Organization(r.Context(), c.OrganizationID, c.UserID, c.PlatformAdmin)
			if e != nil {
				if explicit != "" {
					return claims{}, false
				}
				c.OrganizationID = ""
			} else {
				c.Organization, c.Role = &org, org.Role
			}
		}
		if a.Config.ReadOnly {
			c.Role = "viewer"
		}
		return c, true
	}
	if (c.Role == "admin" && c.Actor != a.Config.AdminUser) ||
		(c.Role == "viewer" && c.Actor != a.Config.ViewerUser) ||
		(c.Role != "admin" && c.Role != "viewer") {
		return claims{}, false
	}
	if a.Config.ReadOnly {
		c.Role = "viewer"
	}
	return c, true
}

func (a *API) protect(next http.Handler, ep Endpoint) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, ok := a.identity(r)
		if !ok {
			a.fail(w, r, http.StatusUnauthorized, "AUTH_REQUIRED", "Sign in to continue.", nil)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			if !a.csrf(r) {
				a.fail(w, r, 403, "CSRF_REJECTED", "This request did not come from the Spool console. Reload the page and try again.", nil)
				return
			}
			if !a.Config.MultiOrg && c.Role != "admin" && r.URL.Path != "/api/v1/session" {
				a.fail(w, r, 403, "READ_ONLY", "Your account can view data but cannot make changes.", nil)
				return
			}
		}
		if a.Config.MultiOrg && !allowed(ep.ID, r.Method, c, a.Config.ReadOnly) {
			a.fail(w, r, 403, "FORBIDDEN", "Your role does not allow this action in this organization.", nil)
			return
		}
		if ep.ID == "changeAdministration" && !a.administrationAttempts.allow(r) {
			a.fail(w, r, 429, "RATE_LIMITED", "Too many administrator verification attempts. Try again in a minute.", nil)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), authKey{}, c)))
	})
}

func (a *API) csrf(r *http.Request) bool {
	if r.Header.Get("X-Spool-Action") != "confirmed" {
		return false
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, e := url.Parse(origin)
	return e == nil && u.Host == r.Host && (u.Scheme == "http" || u.Scheme == "https")
}

func actor(r *http.Request) string {
	c, _ := r.Context().Value(authKey{}).(claims)
	return c.Actor
}

func (a *API) session(r *http.Request) domain.Session {
	c, ok := a.identity(r)
	setup := false
	if a.Config.MultiOrg && a.Store != nil {
		setup, _ = a.Store.NeedsSetup(r.Context())
	}
	return domain.Session{
		SetupRequired:  setup,
		Managed:        a.Config.MultiOrg,
		PlatformAdmin:  c.PlatformAdmin,
		Organization:   c.Organization,
		Authenticated:  ok,
		AuthRequired:   a.authRequired(),
		Actor:          c.Actor,
		Role:           c.Role,
		Environment:    a.Config.Environment,
		InstanceName:   a.Config.InstanceName,
		DeploymentMode: a.Config.DeploymentMode,
		SupportURL:     a.Config.SupportURL,
		Version:        version.Version,
		ReadOnly:       a.Config.ReadOnly,
		ReadOnlyReason: a.Config.ReadOnlyReason,
	}
}

func secureEqual(a, b string) bool {
	x := sha256.Sum256([]byte(a))
	y := sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(x[:], y[:]) == 1
}

type loginAttempt struct {
	at    time.Time
	count int
}

type loginLimiter struct {
	mu       sync.Mutex
	attempts map[string]loginAttempt
}

func (l *loginLimiter) allow(r *http.Request) bool {
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.attempts == nil {
		l.attempts = map[string]loginAttempt{}
	}
	now := time.Now()
	for k, v := range l.attempts {
		if now.Sub(v.at) > time.Minute {
			delete(l.attempts, k)
		}
	}
	v := l.attempts[ip]
	if v.count >= 10 || len(l.attempts) >= 4096 {
		return false
	}
	if v.count == 0 {
		v.at = now
	}
	v.count++
	l.attempts[ip] = v
	return true
}

func (a *API) getSession(w http.ResponseWriter, r *http.Request, _ params) {
	a.json(w, a.session(r))
}

func (a *API) logout(w http.ResponseWriter, r *http.Request, _ params) {
	if !a.confirmed(w, r) {
		return
	}
	http.SetCookie(
		w,
		&http.Cookie{
			Name:     "spool_session",
			Path:     "/",
			MaxAge:   -1,
			HttpOnly: true,
			Secure:   a.Config.SecureCookie,
			SameSite: http.SameSiteStrictMode,
		},
	)
	a.json(w, domain.OK{OK: true})
}

func (a *API) login(w http.ResponseWriter, r *http.Request, _ params) {
	if !a.logins.allow(r) {
		a.fail(w, r, 429, "RATE_LIMITED", "Too many sign-in attempts. Try again in a minute.", nil)
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		u, e := url.Parse(origin)
		if e != nil || u.Host != r.Host {
			a.fail(w, r, 403, "CSRF_REJECTED", "Sign in from the Spool console. Reload the page and try again.", nil)
			return
		}
	}
	var in domain.LoginRequest
	if !a.decode(w, r, &in) {
		return
	}
	if a.Config.MultiOrg {
		if a.Store == nil {
			a.failure(w, r, store.ErrUnavailable)
			return
		}
		u, e := a.Store.Authenticate(r.Context(), in.Username, in.Password)
		if e != nil {
			a.fail(w, r, 401, "INVALID_CREDENTIALS", "Username or password is incorrect.", nil)
			return
		}
		orgs, e := a.Store.Organizations(r.Context(), u.ID, u.PlatformAdmin)
		if e != nil {
			a.failure(w, r, e)
			return
		}
		c := claims{UserID: u.ID, Actor: u.Username, AuthVersion: u.AuthVersion, Expires: time.Now().Add(12 * time.Hour).Unix()}
		if len(orgs) > 0 {
			c.OrganizationID = orgs[0].ID
		}
		a.writeSession(w, r, c)
		return
	}
	role := ""
	if a.Config.AdminUser != "" && secureEqual(in.Username, a.Config.AdminUser) && secureEqual(in.Password, a.Config.AdminPassword) {
		role = "admin"
	}
	if a.Config.ViewerUser != "" && secureEqual(in.Username, a.Config.ViewerUser) && secureEqual(in.Password, a.Config.ViewerPassword) {
		role = "viewer"
	}
	if role == "" {
		a.fail(w, r, 401, "INVALID_CREDENTIALS", "Username or password is incorrect.", nil)
		return
	}
	c := claims{Actor: in.Username, Role: role, Expires: time.Now().Add(12 * time.Hour).Unix()}
	a.writeSession(w, r, c)
}

func (a *API) writeSession(w http.ResponseWriter, r *http.Request, c claims) {
	raw, _ := json.Marshal(c)
	payload := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte(a.Config.SessionKey))
	mac.Write([]byte(payload))
	cookie := &http.Cookie{Name: "spool_session", Value: payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), Path: "/", HttpOnly: true, Secure: a.Config.SecureCookie, SameSite: http.SameSiteStrictMode, MaxAge: int(c.Expires - time.Now().Unix())}
	http.SetCookie(w, cookie)
	// Reuse identity validation to produce the complete public session contract.
	req := r.Clone(r.Context())
	req.Header = req.Header.Clone()
	req.Header.Del("Cookie")
	req.Header.Del("X-Spool-Organization")
	req.AddCookie(cookie)
	a.json(w, a.session(req))
}

func allowed(id, method string, c claims, readOnly bool) bool {
	if id == "logout" || id == "switchOrganization" || id == "changePassword" {
		return true
	}
	if method != "GET" && readOnly {
		return false
	}
	switch id {
	case "listOrganizations":
		return true
	case "updateOrganizationConnection":
		return c.PlatformAdmin && c.OrganizationID != ""
	case "createOrganization", "listUsers", "updateUser", "changeAdministration":
		return c.PlatformAdmin
	case "listMembers", "addMember", "changeMember", "removeMember", "renameOrganization":
		return c.OrganizationID != "" && c.Role == "admin"
	}
	if c.OrganizationID == "" {
		return false
	}
	if method == "GET" || method == "HEAD" {
		return true
	}
	switch id {
	case "pauseQueue", "resumeQueue", "retryTask", "archiveTask", "deleteTask", "cancelTask", "cloneTask", "bulkAction", "saveView", "deleteView":
		return c.Role == "admin" || c.Role == "operator"
	}
	return false
}
