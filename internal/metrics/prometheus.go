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
	Client *http.Client
}

func New(address string) *Prometheus {
	return &Prometheus{address, &http.Client{Timeout: 10 * time.Second}}
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
	h := domain.MetricHealth{
		Configured: p.URL != "",
		Message:    "Configure PROMETHEUS_URL to enable historical charts.",
	}
	if p.URL == "" {
		return h
	}
	_, e := p.request(ctx, "/api/v1/query", url.Values{"query": {"up"}})
	h.Available = e == nil
	if h.Available {
		h.Message = "Prometheus is available."
	} else {
		h.Message = "Prometheus could not be reached. Check the server connection."
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
	if json.Unmarshal(b, &r) != nil || r.Status != "success" {
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
