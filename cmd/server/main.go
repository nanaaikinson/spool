package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hibiken/asynq"
	native "github.com/hibiken/asynq/x/metrics"
	"github.com/nanaaikinson/spool/internal/api"
	"github.com/nanaaikinson/spool/internal/asynqadapter"
	"github.com/nanaaikinson/spool/internal/config"
	"github.com/nanaaikinson/spool/internal/events"
	"github.com/nanaaikinson/spool/internal/metrics"
	"github.com/nanaaikinson/spool/internal/store"
	"github.com/nanaaikinson/spool/internal/version"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{AddSource: true, ReplaceAttr: caller}))
	if e := run(log); e != nil {
		log.Error("startup failed", "reason", e.Error())
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	c, e := config.Load()
	if e != nil {
		return e
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	source := asynqadapter.New(c.Redis())
	defer source.Close()
	checkRedis(ctx, log, c, source)
	startup, cancel := context.WithTimeout(ctx, 10*time.Second)
	db, e := store.Open(startup, c.DatabasePath)
	cancel()
	if e != nil {
		return fmt.Errorf("could not open the database or apply migrations; check that DATABASE_PATH is writable: %w", e)
	}
	if db != nil {
		defer db.DB.Close()
		source.Entries = db
	}
	broker := events.New()
	go broker.Run(ctx)
	registry := prometheus.NewRegistry()
	registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)
	inspector := asynq.NewInspector(c.Redis())
	defer inspector.Close()
	registry.MustRegister(native.NewQueueMetricsCollector(inspector))
	requests := prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "spool_http_request_duration_seconds",
			Help:    "HTTP request duration by route, method and status.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "route", "status"},
	)
	registry.MustRegister(requests)
	provider := metrics.New(c.PrometheusURL)
	provider.Job = c.MetricsJob
	app := &api.API{
		Config:   c,
		Source:   source,
		Metrics:  provider,
		Store:    db,
		Events:   broker,
		Log:      log,
		Requests: requests,
	}
	server := &http.Server{
		Addr:              c.Addr,
		Handler:           app.Handler(promhttp.HandlerFor(registry, promhttp.HandlerOpts{})),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    32 * 1024,
	}
	errs := make(chan error, 1)
	go func() {
		log.Info(
			"server listening",
			"address", c.Addr,
			"environment", c.Environment,
			"read_only", c.ReadOnly,
			"version", version.Version,
		)
		errs <- server.ListenAndServe()
	}()
	select {
	case e := <-errs:
		if !errors.Is(e, http.ErrServerClosed) {
			return e
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
	return nil
}

// caller replaces slog's source group with "caller": "/full/path/file.go:line".
func caller(groups []string, a slog.Attr) slog.Attr {
	if s, ok := a.Value.Any().(*slog.Source); ok && a.Key == slog.SourceKey && len(groups) == 0 {
		return slog.String("caller", fmt.Sprintf("%s:%d", s.File, s.Line))
	}
	return a
}

// checkRedis reports early whether Spool can see the Asynq data. It never stops
// startup: Redis may come up later, and /ready reports it until then.
func checkRedis(ctx context.Context, log *slog.Logger, c config.Config, source *asynqadapter.Adapter) {
	check, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	queues, e := source.Queues(check)
	switch {
	case e != nil:
		log.Warn("cannot reach Redis yet; check REDIS_URL and network access", "redis", c.RedisTarget())
	case len(queues) == 0:
		log.Warn(
			"connected to Redis but found no Asynq queues; check that REDIS_URL uses the same database number as your workers",
			"redis", c.RedisTarget(),
		)
	default:
		log.Info("connected to Redis", "redis", c.RedisTarget(), "queues", len(queues))
	}
	if c.ReadOnlyReason == "no_database" {
		log.Warn("DATABASE_PATH is not set; running read-only without the audit log, saved views or schedule links")
	}
}
