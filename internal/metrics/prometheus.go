package metrics

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/nanaaikinson/spool/internal/domain"
)

var ErrUnavailable = errors.New("metrics unavailable")

type Provider interface {
	Health(context.Context) domain.MetricHealth
	Query(context.Context, string, string) (domain.MetricResult, error)
	QueryRange(context.Context, string, string, time.Time, time.Time, time.Duration) (domain.MetricResult, error)
}

type Prometheus struct {
	URL    string
	Job    string
	Client *http.Client
}

func New(address string) *Prometheus {
	return &Prometheus{URL: address, Job: "spool", Client: &http.Client{Timeout: 10 * time.Second}}
}

var expressions = map[string]struct {
	query string
	unit  string
}{
	"depth":     {"asynq_queue_size", "tasks"},
	"pending":   {`asynq_tasks_enqueued_total{state="pending"}`, "tasks"},
	"active":    {`asynq_tasks_enqueued_total{state="active"}`, "tasks"},
	"retry":     {`asynq_tasks_enqueued_total{state="retry"}`, "tasks"},
	"archived":  {`asynq_tasks_enqueued_total{state="archived"}`, "tasks"},
	"latency":   {"asynq_queue_latency_seconds", "seconds"},
	"processed": {"rate(asynq_tasks_processed_total[2m])", "attempts/s"},
	"failed":    {"rate(asynq_tasks_failed_total[2m])", "failures/s"},
}

func (p *Prometheus) Health(ctx context.Context) domain.MetricHealth {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	h := domain.MetricHealth{Configured: p.URL != "", ScrapeStatus: "unconfigured", Message: "Historical charts are disabled. Ask the operator to configure metrics collection."}
	if p.URL == "" {
		return h
	}
	// A successful HTTP response alone is insufficient: verify the Prometheus envelope.
	b, err := p.request(ctx, "/api/v1/query", url.Values{"query": {"up"}})
	_, decoded := decode(b, "up", "")
	if err != nil || decoded != nil {
		h.ScrapeStatus, h.Message = "unavailable", "Cannot reach Prometheus. Ask the operator to check metrics availability."
		return h
	}
	h.Available = true
	h.ScrapeStatus, h.Message = "unknown", "Prometheus is reachable, but Spool scrape health could not be verified."
	b, err = p.request(ctx, "/api/v1/targets", url.Values{"state": {"active"}})
	var targets struct {
		Status string `json:"status"`
		Data   struct {
			Active []struct {
				Labels map[string]string `json:"labels"`
				Health string            `json:"health"`
			} `json:"activeTargets"`
		} `json:"data"`
	}
	if err != nil || json.Unmarshal(b, &targets) != nil || targets.Status != "success" {
		return h
	}
	matched, pending, down := 0, false, false
	for _, target := range targets.Data.Active {
		if target.Labels["job"] != p.Job {
			continue
		}
		matched++
		switch target.Health {
		case "up":
		case "unknown":
			pending = true
		case "down":
			down = true
		default:
			return h
		}
	}
	switch {
	case matched == 0:
		h.ScrapeStatus, h.Message = "missing", "Prometheus is reachable, but no scrape target matches this instance's metrics job. Ask the operator to check the scrape configuration."
	case down:
		h.ScrapeStatus, h.Message = "down", "Prometheus is reachable, but a Spool scrape is failing. Ask the operator to check connectivity and scrape authentication."
	case pending:
		h.ScrapeStatus, h.Message = "pending", "Prometheus has a Spool target and is waiting for its first successful scrape."
	default:
		h.ScrapeStatus, h.Message = "up", "Prometheus is collecting Spool metrics."
		// Rate charts need two successful samples. Only announce warm-up when
		// Prometheus confirms a healthy target and fewer than two recent successes.
		query := "min(sum_over_time(up{job=" + strconv.Quote(p.Job) + "}[2m]))"
		b, err = p.request(ctx, "/api/v1/query", url.Values{"query": {query}})
		successes, decoded := decode(b, "scrapes", "")
		if err == nil && decoded == nil && len(successes.Data) == 1 && len(successes.Data[0].Points) == 1 {
			h.WarmingUp = successes.Data[0].Points[0].Value < 2
			if h.WarmingUp {
				h.Message = "Collecting your first samples. Rate charts need at least two successful scrapes."
			}
		}
	}
	return h
}

func (p *Prometheus) request(ctx context.Context, path string, q url.Values) ([]byte, error) {
	if p.URL == "" {
		return nil, ErrUnavailable
	}
	u, e := url.Parse(p.URL)
	if e != nil {
		return nil, ErrUnavailable
	}
	u.Path = u.Path + path
	u.RawQuery = q.Encode()
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if e != nil {
		return nil, ErrUnavailable
	}
	res, e := p.Client.Do(req)
	if e != nil {
		return nil, ErrUnavailable
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, ErrUnavailable
	}
	b, e := io.ReadAll(io.LimitReader(res.Body, 8*1024*1024+1))
	if e != nil || len(b) > 8*1024*1024 {
		return nil, ErrUnavailable
	}
	return b, nil
}

func expression(metric, queue string) (string, string, error) {
	m, ok := expressions[metric]
	if !ok {
		return "", "", errors.New("unsupported metric")
	}
	expr := m.query
	if queue != "" {
		selector := "{queue=" + strconv.Quote(queue) + "}"
		switch metric {
		case "processed":
			expr = "rate(asynq_tasks_processed_total" + selector + "[2m])"
		case "failed":
			expr = "rate(asynq_tasks_failed_total" + selector + "[2m])"
		default:
			if strings.Contains(expr, "{") {
				expr = strings.Replace(expr, "}", ",queue="+strconv.Quote(queue)+"}", 1)
			} else {
				expr += selector
			}
		}
	}
	return expr, m.unit, nil
}

type prometheusResponse struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string `json:"resultType"`
		Result     []struct {
			Metric map[string]string   `json:"metric"`
			Values [][]json.RawMessage `json:"values"`
			Value  []json.RawMessage   `json:"value"`
		} `json:"result"`
	} `json:"data"`
}

func decode(b []byte, metric, unit string) (domain.MetricResult, error) {
	out := domain.MetricResult{
		Metric: metric,
		Unit:   unit,
		Source: "native-asynq-prometheus",
		Data:   []domain.Series{},
	}
	var r prometheusResponse
	if json.Unmarshal(b, &r) != nil || r.Status != "success" || (r.Data.ResultType != "vector" && r.Data.ResultType != "matrix") {
		return out, ErrUnavailable
	}
	for _, s := range r.Data.Result {
		series := domain.Series{Queue: s.Metric["queue"], Points: []domain.Point{}}
		pairs := s.Values
		if len(s.Value) > 0 {
			pairs = [][]json.RawMessage{s.Value}
		}
		for _, pair := range pairs {
			if len(pair) != 2 {
				return out, ErrUnavailable
			}
			var ts float64
			var v string
			if json.Unmarshal(pair[0], &ts) != nil || json.Unmarshal(pair[1], &v) != nil {
				return out, ErrUnavailable
			}
			n, e := strconv.ParseFloat(v, 64)
			if e != nil || math.IsNaN(n) || math.IsInf(n, 0) {
				continue
			}
			series.Points = append(series.Points, domain.Point{Time: time.UnixMilli(int64(ts * 1000)).UTC(), Value: n})
		}
		out.Data = append(out.Data, series)
	}
	return out, nil
}

func (p *Prometheus) Query(ctx context.Context, metric, queue string) (domain.MetricResult, error) {
	expr, unit, e := expression(metric, queue)
	if e != nil {
		return domain.MetricResult{}, e
	}
	b, e := p.request(ctx, "/api/v1/query", url.Values{"query": {expr}})
	if e != nil {
		return domain.MetricResult{}, e
	}
	return decode(b, metric, unit)
}

func (p *Prometheus) QueryRange(
	ctx context.Context,
	metric, queue string,
	start, end time.Time,
	step time.Duration,
) (domain.MetricResult, error) {
	if !end.After(start) || end.Sub(start) > 7*24*time.Hour || step < 15*time.Second || end.Sub(start)/step > 1500 {
		return domain.MetricResult{}, fmt.Errorf("invalid metrics range")
	}
	expr, unit, e := expression(metric, queue)
	if e != nil {
		return domain.MetricResult{}, e
	}
	b, e := p.request(
		ctx,
		"/api/v1/query_range",
		url.Values{
			"query": {expr},
			"start": {strconv.FormatInt(start.Unix(), 10)},
			"end":   {strconv.FormatInt(end.Unix(), 10)},
			"step":  {strconv.FormatFloat(step.Seconds(), 'f', 0, 64)},
		},
	)
	if e != nil {
		return domain.MetricResult{}, e
	}
	return decode(b, metric, unit)
}
