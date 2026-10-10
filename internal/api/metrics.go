package api

import (
	"net/http"
	"time"

	z "github.com/Oudwins/zog"
	"github.com/nanaaikinson/spool/internal/domain"
)

func (a *API) metricsHealth(w http.ResponseWriter, r *http.Request, _ params) {
	a.json(w, a.Metrics.Health(r.Context()))
}

func (a *API) queryMetric(w http.ResponseWriter, r *http.Request, p params) {
	a.metric(w, r, p, false)
}

func (a *API) queryMetricRange(w http.ResponseWriter, r *http.Request, p params) {
	a.metric(w, r, p, true)
}

// metric checks the rules the contract can't express; metric and step are already validated.
func (a *API) metric(w http.ResponseWriter, r *http.Request, p params, ranged bool) {
	v := r.URL.Query()
	name, q := v.Get("metric"), v.Get("queue")
	if !a.validate(w, r, z.Struct(z.Shape{"Queue": z.String().Max(200)}), &struct{ Queue string }{q}) {
		return
	}
	var out domain.MetricResult
	var e error
	if ranged {
		start, se := time.Parse(time.RFC3339, v.Get("start"))
		end, ee := time.Parse(time.RFC3339, v.Get("end"))
		step := p.int("step", 60)
		if se != nil || ee != nil || !end.After(start) || end.Sub(start) > 7*24*time.Hour ||
			end.Sub(start)/time.Duration(step)/time.Second > 1500 {
			a.fail(
				w,
				r,
				422,
				"INVALID_RANGE",
				"Choose RFC 3339 start and end times up to 7 days apart, with no more than 1,500 points.",
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
