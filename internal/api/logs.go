package api

import (
	"net/http"
	"time"

	z "github.com/Oudwins/zog"
	"github.com/nanaaikinson/spool/internal/store"
)

// canViewLogs limits server logs to the administrator account, even in
// read-only mode: error details can name internal hosts.
func (a *API) canViewLogs(r *http.Request) bool {
	return !a.authRequired() || actor(r) == a.Config.AdminUser
}

// logQuery reads the shared search and time range, writing the error response
// when they are invalid. The range defaults to the last hour.
func (a *API) logQuery(w http.ResponseWriter, r *http.Request) (store.LogQuery, bool) {
	if !a.canViewLogs(r) {
		a.fail(w, r, 403, "FORBIDDEN", "Only the administrator account can view server logs.", nil)
		return store.LogQuery{}, false
	}
	v := r.URL.Query()
	q := store.LogQuery{Search: v.Get("q"), End: time.Now()}
	if !a.validate(w, r, z.Struct(z.Shape{"Search": z.String().Max(500)}), &struct{ Search string }{q.Search}) {
		return q, false
	}
	var se, ee error
	if s := v.Get("end"); s != "" {
		q.End, ee = time.Parse(time.RFC3339, s)
	}
	q.Start = q.End.Add(-time.Hour)
	if s := v.Get("start"); s != "" {
		q.Start, se = time.Parse(time.RFC3339, s)
	}
	if se != nil || ee != nil || !q.End.After(q.Start) || q.End.Sub(q.Start) > 31*24*time.Hour {
		a.fail(w, r, 422, "INVALID_RANGE", "Choose RFC 3339 start and end times up to 31 days apart.", nil)
		return q, false
	}
	return q, true
}

func (a *API) listServerLogs(w http.ResponseWriter, r *http.Request, p params) {
	q, ok := a.logQuery(w, r)
	if !ok {
		return
	}
	limit := p.int("limit", 200)
	if around := p.int("around", 0); around > 0 {
		v, e := a.Store.LogsAround(r.Context(), int64(around), limit/2)
		if e != nil {
			a.failure(w, r, e)
			return
		}
		a.json(w, v)
		return
	}
	v, e := a.Store.ServerLogs(r.Context(), q, int64(p.int("before", 0)), limit)
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, v)
}

// logSteps are the histogram bucket widths, smallest first.
var logSteps = []time.Duration{
	time.Second, 5 * time.Second, 10 * time.Second, 15 * time.Second, 30 * time.Second,
	time.Minute, 2 * time.Minute, 5 * time.Minute, 10 * time.Minute, 15 * time.Minute, 30 * time.Minute,
	time.Hour, 2 * time.Hour, 3 * time.Hour, 6 * time.Hour, 12 * time.Hour, 24 * time.Hour,
}

// logStep picks the smallest bucket width giving at most 90 buckets.
func logStep(span time.Duration) time.Duration {
	for _, s := range logSteps {
		if span/s <= 90 {
			return s
		}
	}
	return logSteps[len(logSteps)-1]
}

func (a *API) logHistogram(w http.ResponseWriter, r *http.Request, _ params) {
	q, ok := a.logQuery(w, r)
	if !ok {
		return
	}
	v, e := a.Store.LogHistogram(r.Context(), q, logStep(q.End.Sub(q.Start)))
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, v)
}
