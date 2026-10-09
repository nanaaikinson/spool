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
)

type claims struct {
	Actor   string `json:"actor"`
	Role    string `json:"role"`
	Expires int64  `json:"exp"`
}

type authKey struct{}

func (a *API) authRequired() bool {
	return a.Config.AdminUser != "" || a.Config.ViewerUser != ""
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

func (a *API) protect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, ok := a.identity(r)
		if !ok {
			a.fail(w, r, http.StatusUnauthorized, "AUTH_REQUIRED", "Sign in to continue.", nil)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			if !a.csrf(r) {
				a.fail(w, r, 403, "CSRF_REJECTED", "The action must originate from this console.", nil)
				return
			}
			if c.Role != "admin" && r.URL.Path != "/api/v1/session" {
				a.fail(w, r, 403, "READ_ONLY", "Your account can view data but cannot make changes.", nil)
				return
			}
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
	return domain.Session{
		Authenticated: ok,
		AuthRequired:  a.authRequired(),
		Actor:         c.Actor,
		Role:          c.Role,
		Environment:   a.Config.Environment,
		Version:       "0.1.0",
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

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	if !a.logins.allow(r) {
		a.fail(w, r, 429, "RATE_LIMITED", "Too many sign-in attempts. Try again in a minute.", nil)
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		u, e := url.Parse(origin)
		if e != nil || u.Host != r.Host {
			a.fail(w, r, 403, "CSRF_REJECTED", "Sign in from this console.", nil)
			return
		}
	}
	var in domain.LoginRequest
	if !a.decode(w, r, &in) {
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
	raw, _ := json.Marshal(c)
	payload := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte(a.Config.SessionKey))
	mac.Write([]byte(payload))
	http.SetCookie(
		w,
		&http.Cookie{
			Name:     "spool_session",
			Value:    payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)),
			Path:     "/",
			HttpOnly: true,
			Secure:   a.Config.SecureCookie,
			SameSite: http.SameSiteStrictMode,
			MaxAge:   43200,
		},
	)
	if a.Config.ReadOnly {
		role = "viewer"
	}
	a.json(
		w,
		domain.Session{
			Authenticated: true,
			AuthRequired:  true,
			Actor:         in.Username,
			Role:          role,
			Environment:   a.Config.Environment,
			Version:       "0.1.0",
		},
	)
}
