package metrics

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPrometheusQueries(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("query")
		if strings.Contains(query, "queue_processed") || !strings.Contains(query, "asynq_tasks_processed_total") {
			t.Errorf("wrong upstream metric %s", query)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"success","data":{"resultType":"matrix","result":[{"metric":{"queue":"critical"},"values":[[1700000000,"2.5"],[1700000060,"NaN"]]}]}}`))
	}))
	defer server.Close()
	p := New(server.URL)
	out, e := p.QueryRange(
		context.Background(),
		"processed",
		"critical",
		time.Now().Add(-time.Hour),
		time.Now(),
		time.Minute,
	)
	if e != nil || len(out.Data) != 1 || len(out.Data[0].Points) != 1 || out.Data[0].Points[0].Value != 2.5 {
		t.Fatalf("range %+v %v", out, e)
	}
	if _, e = json.Marshal(out); e != nil {
		t.Fatal("non-finite metric escaped", e)
	}
	if _, e = p.Query(context.Background(), "arbitrary_promql", ""); e == nil {
		t.Fatal("arbitrary query accepted")
	}
	expr, _, e := expression("retry", `a"b`)
	if e != nil || expr != `asynq_tasks_enqueued_total{state="retry",queue="a\"b"}` {
		t.Fatal("label escaping", expr, e)
	}
}

func TestUnavailableAndBounds(t *testing.T) {
	p := New("")
	if p.Health(context.Background()).Configured {
		t.Fatal("unconfigured health")
	}
	if _, e := p.QueryRange(
		context.Background(),
		"depth",
		"",
		time.Now().Add(-8*24*time.Hour),
		time.Now(),
		time.Minute,
	); e == nil {
		t.Fatal("unbounded range accepted")
	}
}

func TestScrapeHealth(t *testing.T) {
	for _, tc := range []struct {
		name, targets, envelope, count, want string
		warm                                 bool
	}{
		{"unrelated healthy target", `[{"labels":{"job":"other"},"health":"up"}]`, "success", "5", "missing", false},
		{"first scrape pending", `[{"labels":{"job":"spool"},"health":"unknown"}]`, "success", "0", "pending", false},
		{"scrape fails", `[{"labels":{"job":"spool"},"health":"down","lastError":"private-password"}]`, "success", "0", "down", false},
		{"first successful sample", `[{"labels":{"job":"spool"},"health":"up"}]`, "success", "1", "up", true},
		{"enough samples", `[{"labels":{"job":"spool"},"health":"up"}]`, "success", "2", "up", false},
		{"one failing among multiple", `[{"labels":{"job":"spool"},"health":"up"},{"labels":{"job":"spool"},"health":"down"}]`, "success", "2", "down", false},
		{"invalid envelope", `[]`, "error", "0", "unavailable", false},
		{"missing targets API", `not-json`, "success", "2", "unknown", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/v1/targets" {
					fmt.Fprintf(w, `{"status":"success","data":{"activeTargets":%s}}`, tc.targets)
					return
				}
				if strings.HasPrefix(r.URL.Query().Get("query"), "min(sum_over_time") {
					fmt.Fprintf(w, `{"status":"success","data":{"resultType":"vector","result":[{"metric":{},"value":[1700000000,"%s"]}]}}`, tc.count)
				} else {
					fmt.Fprintf(w, `{"status":%q,"data":{"resultType":"vector","result":[]}}`, tc.envelope)
				}
			}))
			defer server.Close()
			h := New(server.URL).Health(context.Background())
			if h.ScrapeStatus != tc.want || h.WarmingUp != tc.warm || h.Available != (tc.want != "unavailable") {
				t.Fatalf("health: %+v", h)
			}
			if strings.Contains(h.Message, "private-password") {
				t.Fatal("upstream secret leaked")
			}
		})
	}
}
