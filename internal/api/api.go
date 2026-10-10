package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"reflect"
	"regexp"
	"strings"
	"time"

	z "github.com/Oudwins/zog"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/nanaaikinson/chandlery/validator"
	"github.com/nanaaikinson/spool/internal/asynqadapter"
	"github.com/nanaaikinson/spool/internal/config"
	"github.com/nanaaikinson/spool/internal/domain"
	"github.com/nanaaikinson/spool/internal/events"
	"github.com/nanaaikinson/spool/internal/metrics"
	"github.com/nanaaikinson/spool/internal/store"
	"github.com/prometheus/client_golang/prometheus"
)

type API struct {
	Config                 config.Config
	Source                 asynqadapter.Source
	Metrics                metrics.Provider
	Store                  *store.Store
	Events                 *events.Broker
	Log                    *slog.Logger
	Requests               *prometheus.HistogramVec
	logins                 loginLimiter
	administrationAttempts loginLimiter
}

// Handler panics if the OpenAPI document cannot be built, so a broken contract stops startup.
func (a *API) Handler(scrape http.Handler) http.Handler {
	spec, e := OpenAPI()
	if e != nil {
		panic("api: build OpenAPI document: " + e.Error())
	}
	r := chi.NewRouter()
	r.Use(middleware.RequestID, a.observe, a.recover, a.limitMiddleware())
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		a.json(w, domain.OK{OK: true})
	})
	r.Get("/ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		if !a.Config.MultiOrg {
			if _, e := a.Source.Queues(ctx); e != nil {
				a.fail(w, r, 503, "NOT_READY", "Cannot reach Redis. Check REDIS_URL and that Redis is running.", e)
				return
			}
		}
		if a.Store != nil {
			if e := a.Store.Ping(ctx); e != nil {
				a.fail(w, r, 503, "NOT_READY", "Cannot reach PostgreSQL. Check DATABASE_URL and that PostgreSQL is running.", e)
				return
			}
		}
		a.json(w, domain.OK{OK: true})
	})
	// Without a token, keep this endpoint private at ingress.
	r.Handle("/metrics", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.Config.MultiOrg && a.Config.MetricsToken == "" {
			a.fail(w, r, 503, "METRICS_TOKEN_REQUIRED", "Configure a separate scrape token for organization metrics.", nil)
			return
		}
		if a.Config.MetricsToken != "" && !secureEqual(r.Header.Get("Authorization"), "Bearer "+a.Config.MetricsToken) {
			w.Header().Set("WWW-Authenticate", `Bearer realm="spool-metrics"`)
			a.fail(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "A valid metrics scrape token is required.", nil)
			return
		}
		scrape.ServeHTTP(w, r)
	}))
	r.Get("/openapi.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(spec)
	})
	for _, ep := range Endpoints() {
		r.Method(ep.Method, "/api/v1"+ep.Path, a.route(ep))
	}
	r.NotFound(a.static)
	return r
}

// params are an endpoint's path identifiers and integer query parameters, already checked against the contract.
type params struct {
	queue, id string
	ints      map[string]int
}

// int returns the named integer query parameter, or fallback when it was not sent.
func (p params) int(name string, fallback int) int {
	if v, ok := p.ints[name]; ok {
		return v
	}
	return fallback
}

var identifier = regexp.MustCompile(`^[^\x00-\x1f\x7f/{}]{1,200}$`)

func (a *API) route(ep Endpoint) http.Handler {
	h := http.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := params{queue: chi.URLParam(r, "queue"), id: chi.URLParam(r, "id")}
		if (p.queue != "" && !identifier.MatchString(p.queue)) || (p.id != "" && !identifier.MatchString(p.id)) {
			a.fail(w, r, 422, "INVALID_IDENTIFIER", "The queue name or task ID is too long or contains unsupported characters.", nil)
			return
		}
		ints, f := parseQuery(ep.Parameters, r.URL.Query())
		if f != nil {
			a.invalid(w, f.Reasons[0], []domain.FieldError{*f})
			return
		}
		p.ints = ints
		target := a
		if a.Config.MultiOrg && !ep.Public {
			c, _ := r.Context().Value(authKey{}).(claims)
			target = &API{Config: a.Config, Store: a.Store.Scoped(c.OrganizationID), Source: a.Source, Metrics: a.Metrics, Events: a.Events, Log: a.Log, Requests: a.Requests}
			if operational(ep.ID) {
				in, e := a.Store.Connection(r.Context(), c.OrganizationID, a.Config.DataKey)
				if e != nil {
					a.failure(w, r, e)
					return
				}
				cfg := a.Config
				cfg.RedisURL = in.RedisURL
				source := asynqadapter.New(cfg.Redis())
				source.Entries = target.Store
				defer source.Close()
				target.Source = source
				if in.PrometheusURL != "" {
					cfg.PrometheusURL = in.PrometheusURL
				}
				provider := metrics.New(cfg.PrometheusURL)
				provider.Job = cfg.MetricsJob
				provider.Organization = c.OrganizationID
				target.Metrics = provider
				target.Config = cfg
			}
		}
		ep.Handle(target, w, r, p)
	}))
	if !ep.Public {
		h = a.protect(h, ep)
	}
	return h
}

func (a *API) json(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if e := json.NewEncoder(w).Encode(v); e != nil {
		a.Log.Error("write response failed", "error", e)
	}
}

func (a *API) fail(w http.ResponseWriter, r *http.Request, status int, code, message string, cause error) {
	if cause != nil {
		a.Log.Error(
			"request failed",
			"request_id",
			middleware.GetReqID(r.Context()),
			"code",
			code,
			"error_type",
			fmt.Sprintf("%T", cause),
		)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	a.json(
		w,
		domain.Error{
			Code:    code,
			Message: message,
			Details: domain.ErrorDetails{Fields: []domain.FieldError{}},
		},
	)
}

// invalid writes a 422 VALIDATION_ERROR naming the offending fields.
func (a *API) invalid(w http.ResponseWriter, message string, fields []domain.FieldError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(422)
	a.json(
		w,
		domain.Error{
			Code:    "VALIDATION_ERROR",
			Message: message,
			Details: domain.ErrorDetails{Fields: fields},
		},
	)
}

var errAuditOutcome = errors.New("audit outcome unknown")

func (a *API) failure(w http.ResponseWriter, r *http.Request, e error) {
	switch {
	case errors.Is(e, store.ErrIdentityInvalid):
		a.fail(w, r, 422, "VALIDATION_ERROR", "Use a valid name, username, role and connection URL. New passwords must be 12–72 bytes.", nil)
	case errors.Is(e, store.ErrLastAdmin):
		a.fail(w, r, 409, "LAST_ADMIN", "Keep at least one active administrator for every organization and the deployment.", nil)
	case errors.Is(e, store.ErrIdentityConflict):
		a.fail(w, r, 409, "IDENTITY_CONFLICT", "Setup is complete, this membership already exists, or this username belongs to an existing user. Leave the password empty when adding an existing user.", nil)
	case errors.Is(e, store.ErrIdentityNotFound):
		a.fail(w, r, 404, "USER_NOT_FOUND", "The user was not found or the current password is incorrect.", nil)
	case errors.Is(e, errAuditOutcome):
		a.fail(
			w,
			r,
			500,
			"AUDIT_OUTCOME_UNKNOWN",
			"The action may have run, but its result was not recorded in the audit log. Check the current state before trying again.",
			e,
		)
	case errors.Is(e, asynqadapter.ErrNotFound):
		a.fail(w, r, 404, "NOT_FOUND", "The queue or task no longer exists.", nil)
	case errors.Is(e, asynqadapter.ErrConflict):
		a.fail(
			w,
			r,
			409,
			"STATE_CONFLICT",
			"The task has changed state or does not support this action. Refresh and try again.",
			nil,
		)
	case errors.Is(e, asynqadapter.ErrCursor):
		a.fail(
			w,
			r,
			422,
			"INVALID_CURSOR",
			"This page no longer matches the current filters. Go back to the first page.",
			nil,
		)
	case errors.Is(e, store.ErrUnavailable):
		a.fail(
			w,
			r,
			503,
			"AUDIT_UNAVAILABLE",
			"Changes are disabled because the audit log is unavailable. Set DATABASE_URL to a reachable PostgreSQL database.",
			e,
		)
	case errors.Is(e, metrics.ErrUnavailable):
		a.fail(
			w,
			r,
			503,
			"METRICS_UNAVAILABLE",
			"Historical metrics are unavailable. Set PROMETHEUS_URL and check that Prometheus is reachable.",
			e,
		)
	default:
		a.fail(
			w,
			r,
			503,
			"DEPENDENCY_UNAVAILABLE",
			"The request failed. Check that Redis and PostgreSQL are reachable, then try again.",
			e,
		)
	}
}

func (a *API) decode(w http.ResponseWriter, r *http.Request, out any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		a.fail(w, r, 400, "INVALID_REQUEST", "Send the request body as JSON.", nil)
		return false
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512*1024))
	d.DisallowUnknownFields()
	if d.Decode(out) != nil || d.Decode(&struct{}{}) != io.EOF {
		a.fail(w, r, 400, "INVALID_REQUEST", "The request body is malformed, has unknown fields, or is larger than 512 KB.", nil)
		return false
	}
	return true
}

func (a *API) validate(w http.ResponseWriter, r *http.Request, schema *z.StructSchema, in any) bool {
	issues := schema.Validate(in)
	if len(issues) == 0 {
		return true
	}
	fields := []domain.FieldError{}
	for _, f := range validator.SanitizeIssues(issues) {
		fields = append(fields, domain.FieldError{Field: validationField(in, f.Field), Reasons: f.Reasons})
	}
	a.invalid(w, "Check the highlighted fields.", fields)
	return false
}

func validationField(in any, name string) string {
	t := reflect.TypeOf(in)
	if t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t.Kind() == reflect.Struct {
		if field, ok := t.FieldByName(name); ok {
			if tag := strings.Split(field.Tag.Get("json"), ",")[0]; tag != "" {
				return tag
			}
		}
	}
	return strings.ToLower(regexp.MustCompile(`([a-z0-9])([A-Z])`).ReplaceAllString(name, `${1}_${2}`))
}

func (a *API) confirmed(w http.ResponseWriter, r *http.Request) bool {
	var in domain.ActionRequest
	if !a.decode(w, r, &in) {
		return false
	}
	if !in.Confirm {
		a.fail(w, r, 422, "CONFIRMATION_REQUIRED", "Confirm the action before continuing.", nil)
		return false
	}
	return true
}

func (a *API) audited(r *http.Request, action, q, id string, run func() error) error {
	auditID, e := a.Store.Begin(r.Context(), actor(r), action, q, id)
	if e != nil {
		return e
	}
	e = run()
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
	defer cancel()
	if finishErr := a.Store.Finish(ctx, auditID, e == nil); finishErr != nil {
		a.Log.Error("audit finalization failed", "audit_id", auditID)
		return fmt.Errorf("%w: %v", errAuditOutcome, finishErr)
	}
	if e == nil {
		event := "changed"
		if a.Config.MultiOrg {
			event += ":" + a.Store.OrganizationID
		}
		a.Events.Publish(event)
	}
	return e
}

func operational(id string) bool {
	switch id {
	case "logout", "listOrganizations", "switchOrganization", "createOrganization", "renameOrganization", "updateOrganizationConnection", "listMembers", "addMember", "changeMember", "removeMember", "listUsers", "updateUser", "changeAdministration", "changePassword", "listAudit", "listViews", "saveView", "deleteView", "events":
		return false
	}
	return true
}
