package metrics

import (
	"context"
	"encoding/json"
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
