package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
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
	Config   config.Config
	Source   asynqadapter.Source
	Metrics  metrics.Provider
	Store    *store.Store
	Events   *events.Broker
	Log      *slog.Logger
	Requests *prometheus.HistogramVec
	logins   loginLimiter
}

func (a *API) Handler(scrape http.Handler) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, a.observe, a.recover, a.limitMiddleware())
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		a.json(w, domain.OK{OK: true})
	})
	r.Get("/ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		if _, e := a.Source.Queues(ctx); e != nil {
			a.fail(w, r, 503, "NOT_READY", "Cannot reach Redis. Check REDIS_URL and that Redis is running.", e)
			return
		}
		if a.Store != nil {
			if e := a.Store.Ping(ctx); e != nil {
				a.fail(w, r, 503, "NOT_READY", "Cannot reach PostgreSQL. Check DATABASE_URL and that PostgreSQL is running.", e)
				return
			}
		}
		a.json(w, domain.OK{OK: true})
	})
	// The scrape endpoint is unauthenticated; expose it only to the monitoring network, never on public ingress.
	r.Handle("/metrics", scrape)
	spec, _ := OpenAPI()
	r.Get("/openapi.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(spec)
	})
	for _, ep := range Endpoints() {
		ep := ep
		handler := http.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			a.dispatch(ep.ID, w, r)
		}))
		if !ep.Public {
			handler = a.protect(handler)
		}
		r.Method(ep.Method, "/api/v1"+ep.Path, handler)
	}
	r.NotFound(a.static)
	return r
}

func (a *API) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		ww.Header().Set("X-Request-ID", middleware.GetReqID(r.Context()))
		ww.Header().Set("X-Content-Type-Options", "nosniff")
		ww.Header().Set("Referrer-Policy", "same-origin")
		ww.Header().Set(
			"Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'",
		)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			ww.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(ww, r)
		route := chi.RouteContext(r.Context()).RoutePattern()
		if route == "" {
			route = "unmatched"
		}
		if a.Requests != nil {
			a.Requests.WithLabelValues(r.Method, route, strconv.Itoa(ww.Status())).Observe(time.Since(start).Seconds())
		}
		if r.URL.Path != "/api/v1/events" {
			a.Log.Info(
				"http request",
				"request_id", middleware.GetReqID(r.Context()),
				"method", r.Method,
				"route", route,
				"status", ww.Status(),
				"duration_ms", time.Since(start).Milliseconds(),
			)
		}
	})
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

var errAuditOutcome = errors.New("audit outcome unknown")

func (a *API) failure(w http.ResponseWriter, r *http.Request, e error) {
	switch {
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
	w.WriteHeader(422)
	a.json(
		w,
		domain.Error{
			Code:    "VALIDATION_ERROR",
			Message: "Check the highlighted fields.",
			Details: domain.ErrorDetails{Fields: fields},
		},
	)
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

var identifier = regexp.MustCompile(`^[^\x00-\x1f\x7f/{}]{1,200}$`)

func (a *API) targets(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	q, id := chi.URLParam(r, "queue"), chi.URLParam(r, "id")
	if (q != "" && !identifier.MatchString(q)) || (id != "" && !identifier.MatchString(id)) {
		a.fail(w, r, 422, "INVALID_IDENTIFIER", "The queue name or task ID is too long or contains unsupported characters.", nil)
		return "", "", false
	}
	return q, id, true
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
		a.Events.Publish("changed")
	}
	return e
}

func (a *API) dispatch(id string, w http.ResponseWriter, r *http.Request) {
	q, taskID, ok := a.targets(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	switch id {
	case "getSession":
		a.json(w, a.session(r))
	case "login":
		a.login(w, r)
	case "logout":
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
	case "listQueues":
		qs, e := a.Source.Queues(ctx)
		if e != nil {
			a.failure(w, r, e)
			return
		}
		a.json(w, domain.QueueList{Data: qs})
	case "getQueue":
		v, e := a.Source.Queue(ctx, q)
		if e != nil {
			a.failure(w, r, e)
			return
		}
		a.json(w, v)
	case "getOverview":
		qs, e := a.Source.Queues(ctx)
		if e != nil {
			a.failure(w, r, e)
			return
		}
		ss, e := a.Source.Servers(ctx)
		if e != nil {
			a.failure(w, r, e)
			return
		}
		o := domain.Overview{Queues: qs, Servers: len(ss), ObservedAt: time.Now()}
		for _, s := range ss {
			o.Concurrency += s.Concurrency
			o.ActiveWorkers += len(s.Workers)
		}
		a.json(w, o)
	case "listTasks":
		f, ok := a.taskFilter(w, r)
		if !ok {
			return
		}
		v, e := a.Source.Tasks(ctx, f)
		if e != nil {
			a.failure(w, r, e)
			return
		}
		a.json(w, v)
	case "getTask":
		v, e := a.Source.Task(ctx, q, taskID)
		if e != nil {
			a.failure(w, r, e)
			return
		}
		a.json(w, v)
	case "listErrorGroups":
		limit := 500
		if raw := r.URL.Query().Get("limit"); raw != "" {
			n, e := strconv.Atoi(raw)
			if e != nil || n < 50 || n > 1000 {
				a.fail(w, r, 422, "VALIDATION_ERROR", "Sample size must be between 50 and 1,000 tasks.", nil)
				return
			}
			limit = n
		}
		queue := r.URL.Query().Get("queue")
		if len(queue) > 200 {
			a.fail(w, r, 422, "VALIDATION_ERROR", "Queue name must be 200 characters or fewer.", nil)
			return
		}
		v, e := a.Source.ErrorGroups(ctx, queue, limit)
		if e != nil {
			a.failure(w, r, e)
			return
		}
		a.json(w, v)
	case "listServers":
		v, e := a.Source.Servers(ctx)
		if e != nil {
			a.failure(w, r, e)
			return
		}
		a.json(w, domain.ServerList{Data: v})
	case "listSchedulers":
		v, e := a.Source.Schedulers(ctx)
		if e != nil {
			a.failure(w, r, e)
			return
		}
		a.json(w, domain.SchedulerList{Data: v})
	case "pauseQueue", "resumeQueue":
		if !a.confirmed(w, r) {
			return
		}
		action := "pause"
		if id == "resumeQueue" {
			action = "resume"
		}
		e := a.audited(r, action, q, "", func() error {
			return a.Source.QueueAction(ctx, q, action)
		})
		if e != nil {
			a.failure(w, r, e)
			return
		}
		a.json(w, domain.OK{OK: true})
	case "retryTask", "archiveTask", "deleteTask", "cancelTask":
		if !a.confirmed(w, r) {
			return
		}
		action := strings.TrimSuffix(id, "Task")
		e := a.audited(r, action, q, taskID, func() error {
			return a.Source.TaskAction(ctx, q, taskID, action)
		})
		if e != nil {
			a.failure(w, r, e)
			return
		}
		a.json(w, domain.OK{OK: true})
	case "cloneTask":
		a.clone(w, r, q, taskID)
	case "bulkAction":
		a.bulk(w, r)
	case "metricsHealth":
		a.json(w, a.Metrics.Health(ctx))
	case "queryMetric", "queryMetricRange":
		a.metric(w, r, id == "queryMetricRange")
	case "listAudit":
		page, limit := 1, 25
		for key, target := range map[string]*int{"page": &page, "limit": &limit} {
			if raw := r.URL.Query().Get(key); raw != "" {
				n, e := strconv.Atoi(raw)
				if e != nil || n < 1 {
					a.fail(w, r, 422, "VALIDATION_ERROR", "Page and page size must be whole numbers of 1 or more.", nil)
					return
				}
				*target = n
			}
		}
		if limit > 100 {
			a.fail(w, r, 422, "VALIDATION_ERROR", "Page size must be 100 or fewer.", nil)
			return
		}
		v, e := a.Store.Audits(ctx, page, limit)
		if e != nil {
			a.failure(w, r, e)
			return
		}
		a.json(w, v)
	case "listViews":
		v, e := a.Store.Views(ctx, actor(r))
		if e != nil {
			a.failure(w, r, e)
			return
		}
		a.json(w, domain.ViewList{Data: v})
	case "saveView":
		var in domain.ViewRequest
		if !a.decode(w, r, &in) {
			return
		}
		if !a.validate(
			w,
			r,
			z.Struct(z.Shape{"Name": z.String().Required().Min(1).Max(80), "Path": z.String().Required().Max(2048)}),
			&in,
		) {
			return
		}
		if !validView(in.Path) {
			a.fail(w, r, 422, "INVALID_VIEW", "Saved views can only point to the Queues, All tasks, Scheduled, or Failed page.", nil)
			return
		}
		v, e := a.Store.SaveView(ctx, actor(r), in)
		if e != nil {
			a.failure(w, r, e)
			return
		}
		a.json(w, v)
	case "deleteView":
		if !a.confirmed(w, r) {
			return
		}
		e := a.Store.DeleteView(ctx, actor(r), taskID)
		if e != nil {
			a.failure(w, r, e)
			return
		}
		a.json(w, domain.OK{OK: true})
	case "events":
		a.sse(w, r)
	}
}

func validView(path string) bool {
	base := strings.Split(path, "?")[0]
	return base == "/tasks" || base == "/queues" || base == "/failures" || base == "/scheduled"
}

func (a *API) taskFilter(w http.ResponseWriter, r *http.Request) (domain.TaskFilter, bool) {
	v := r.URL.Query()
	f := domain.TaskFilter{
		Queue:  v.Get("queue"),
		State:  v.Get("state"),
		Group:  v.Get("group"),
		Type:   v.Get("type"),
		ID:     v.Get("id"),
		Cursor: v.Get("cursor"),
		Limit:  50,
	}
	for key, target := range map[string]*int{"limit": &f.Limit, "min_retry": &f.MinRetry} {
		if raw := v.Get(key); raw != "" {
			n, e := strconv.Atoi(raw)
			if e != nil {
				a.fail(w, r, 422, "VALIDATION_ERROR", "Limit and minimum retry count must be whole numbers.", nil)
				return f, false
			}
			*target = n
		}
	}
	schema := z.Struct(z.Shape{
		"Limit":    z.Int().GTE(1).LTE(100).Required(),
		"MinRetry": z.Int().GTE(0).LTE(100000),
		"State":    z.String().OneOf(append(append([]string{}, domain.States...), "failed")),
		"Queue":    z.String().Max(200),
		"ID":       z.String().Max(200),
		"Type":     z.String().Max(200),
		"Group":    z.String().Max(200),
		"Cursor":   z.String().Max(2048),
	})
	if !a.validate(w, r, schema, &f) {
		return f, false
	}
	if (f.Queue != "" && !identifier.MatchString(f.Queue)) || (f.ID != "" && !identifier.MatchString(f.ID)) {
		a.fail(w, r, 422, "INVALID_IDENTIFIER", "The queue or task ID filter is too long or contains unsupported characters.", nil)
		return f, false
	}
	if f.State == "aggregating" && f.Group == "" {
		a.fail(w, r, 422, "GROUP_REQUIRED", "Choose a group to view aggregating tasks.", nil)
		return f, false
	}
	if raw := v.Get("failed_after"); raw != "" {
		t, e := time.Parse(time.RFC3339, raw)
		if e != nil {
			a.fail(w, r, 422, "VALIDATION_ERROR", "Failed-after time must be an RFC 3339 timestamp, such as 2026-01-02T15:04:05Z.", nil)
			return f, false
		}
		f.FailedAfter = &t
	}
	return f, true
}

func (a *API) clone(w http.ResponseWriter, r *http.Request, q, id string) {
	var in domain.CloneRequest
	if !a.decode(w, r, &in) {
		return
	}
	if !in.Confirm {
		a.fail(w, r, 422, "CONFIRMATION_REQUIRED", "Confirm before creating the task.", nil)
		return
	}
	if !a.validate(
		w,
		r,
		z.Struct(z.Shape{
			"Queue":    z.String().Required().Match(identifier),
			"Type":     z.String().Required().Max(200),
			"Payload":  z.String().Max(asynqadapter.MaxPayload),
			"MaxRetry": z.Int().GTE(0).LTE(100),
		}),
		&in,
	) {
		return
	}
	var t domain.Task
	e := a.audited(
		r,
		"clone",
		q,
		id,
		func() error {
			var e error
			t, e = a.Source.Clone(r.Context(), q, id, in)
			return e
		},
	)
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, t)
}

func (a *API) bulk(w http.ResponseWriter, r *http.Request) {
	var in domain.BulkRequest
	if !a.decode(w, r, &in) {
		return
	}
	if !in.Confirm || len(in.Tasks) < 1 || len(in.Tasks) > 50 ||
		(in.Action != "retry" && in.Action != "archive" && in.Action != "delete") {
		a.fail(w, r, 422, "VALIDATION_ERROR", "Select 1–50 tasks, choose retry, archive, or delete, and confirm.", nil)
		return
	}
	seen := map[string]bool{}
	for _, t := range in.Tasks {
		k := t.Queue + "/" + t.ID
		if !identifier.MatchString(t.Queue) || !identifier.MatchString(t.ID) || seen[k] {
			a.fail(w, r, 422, "VALIDATION_ERROR", "The selection includes an invalid or duplicate task.", nil)
			return
		}
		seen[k] = true
	}
	out := domain.BulkResult{Data: []domain.ActionResult{}}
	for _, t := range in.Tasks {
		if r.Context().Err() != nil {
			break
		}
		e := a.audited(
			r,
			in.Action,
			t.Queue,
			t.ID,
			func() error {
				return a.Source.TaskAction(r.Context(), t.Queue, t.ID, in.Action)
			},
		)
		result := domain.ActionResult{Queue: t.Queue, ID: t.ID, Success: e == nil}
		if e != nil {
			result.Code = "ACTION_FAILED"
			result.Message = "Action failed. Check the task's current state and the audit log."
		}
		out.Data = append(out.Data, result)
	}
	a.json(w, out)
}

func (a *API) metric(w http.ResponseWriter, r *http.Request, ranged bool) {
	v := r.URL.Query()
	name, q := v.Get("metric"), v.Get("queue")
	if !a.validate(
		w,
		r,
		z.Struct(z.Shape{
			"Metric": z.String().Required().OneOf([]string{"depth", "pending", "active", "retry", "archived", "latency", "processed", "failed"}),
			"Queue":  z.String().Max(200),
		}),
		&struct {
			Metric string
			Queue  string
		}{name, q},
	) {
		return
	}
	var out domain.MetricResult
	var e error
	if ranged {
		start, se := time.Parse(time.RFC3339, v.Get("start"))
		end, ee := time.Parse(time.RFC3339, v.Get("end"))
		step := 60
		if raw := v.Get("step"); raw != "" {
			step, e = strconv.Atoi(raw)
		}
		if se != nil || ee != nil || e != nil || step < 15 || step > 3600 ||
			!end.After(start) || end.Sub(start) > 7*24*time.Hour ||
			end.Sub(start)/time.Duration(step)/time.Second > 1500 {
			a.fail(
				w,
				r,
				422,
				"INVALID_RANGE",
				"Choose a range of up to 7 days, a step of 15–3,600 seconds, and no more than 1,500 points.",
				nil,
			)
			return
		}
		out, e = a.Metrics.QueryRange(r.Context(), name, q, start, end, time.Duration(step)*time.Second)
	} else {
		out, e = a.Metrics.Query(r.Context(), name, q)
	}
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, out)
}

func (a *API) sse(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		a.fail(w, r, 500, "STREAM_UNAVAILABLE", "Live updates are not supported on this connection.", nil)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	ch, unsubscribe := a.Events.Subscribe()
	defer unsubscribe()
	if _, e := fmt.Fprint(w, "event: connected\ndata: {}\n\n"); e != nil {
		return
	}
	flusher.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case ev := <-ch:
			if _, ok := a.identity(r); !ok {
				return
			}
			if _, e := fmt.Fprintf(w, "event: %s\ndata: {}\n\n", ev); e != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func init() {
	// Icons and the web manifest aren't in Go's built-in MIME table, and the
	// container image has no system MIME database to fall back on.
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
	_ = mime.AddExtensionType(".ico", "image/x-icon")
}

func (a *API) static(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") || r.Method != "GET" {
		a.fail(w, r, 404, "NOT_FOUND", "No route matches this path.", nil)
		return
	}
	path := filepath.Join(a.Config.StaticDir, filepath.Clean("/"+r.URL.Path))
	if info, e := os.Stat(path); e == nil && !info.IsDir() {
		http.ServeFile(w, r, path)
		return
	}
	index := filepath.Join(a.Config.StaticDir, "index.html")
	if _, e := os.Stat(index); e != nil {
		a.fail(w, r, 503, "UI_NOT_BUILT", "The web UI has not been built. Run make build, or use the Vite dev server with make web.", nil)
		return
	}
	http.ServeFile(w, r, index)
}

func (a *API) recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				a.Log.Error("handler panic", "request_id", middleware.GetReqID(r.Context()))
				a.fail(w, r, 500, "INTERNAL_ERROR", "Something went wrong on the server. Try again, and check the server logs if it keeps happening.", nil)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (a *API) limitMiddleware() func(http.Handler) http.Handler {
	slots := make(chan struct{}, 100)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			select {
			case slots <- struct{}{}:
				defer func() {
					<-slots
				}()
				next.ServeHTTP(w, r)
			default:
				a.fail(w, r, 429, "RATE_LIMITED", "Spool is handling too many requests. Try again in a moment.", nil)
			}
		})
	}
}
