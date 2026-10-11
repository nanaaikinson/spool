package api

import (
	"context"
	"net/http"
	"time"

	"github.com/nanaaikinson/spool/internal/domain"
)

// Diagnostics are authenticated and return fixed messages, never connection
// strings, upstream errors, certificates, credentials or target labels.
func (a *API) deploymentStatus(w http.ResponseWriter, r *http.Request, _ params) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	out := domain.DeploymentStatus{
		CheckedAt: time.Now().UTC(),
		Redis:     domain.ConnectionHealth{Configured: true, Message: "Cannot reach the Asynq Redis connection. Ask the operator to check credentials and network access."},
		Database:  domain.ConnectionHealth{Configured: a.Config.DatabasePath != "" || a.Store != nil, Message: "Cannot use the database. Ask the operator to check the database volume."},
		Metrics:   domain.MetricHealth{Configured: a.Config.PrometheusURL != "", ScrapeStatus: "unavailable", Message: "The metrics check did not finish. Retry or ask the operator to check metrics availability."},
	}
	type redisResult struct {
		health domain.ConnectionHealth
		count  int
	}
	redis := make(chan redisResult, 1)
	database := make(chan domain.ConnectionHealth, 1)
	metrics := make(chan domain.MetricHealth, 1)
	initialRedis := out.Redis
	go func() {
		result := redisResult{health: initialRedis}
		queues, err := a.Source.Queues(ctx)
		result.health.Available = err == nil
		if err == nil {
			result.count = len(queues)
			result.health.Message = "Connected to the Asynq Redis connection."
			if len(queues) == 0 {
				result.health.Message = "Connected, but no Asynq queues were found. Confirm the database matches your workers; a new environment may be empty."
			}
		}
		redis <- result
	}()
	// Copy initial values before checks start; late Inspector calls can finish
	// after the HTTP deadline without mutating the response or blocking a send.
	initialDatabase := out.Database
	go func() {
		health := initialDatabase
		if !health.Configured {
			health.Message = "No database is configured. Changes, saved views and the audit log are unavailable."
		} else {
			health.Available = a.Store != nil && a.Store.Ping(ctx) == nil
			if health.Available {
				health.Message = "Open. Audit entries, saved views and schedule links are saved to the database file."
			}
		}
		database <- health
	}()
	go func() { metrics <- a.Metrics.Health(ctx) }()
	for remaining := 3; remaining > 0; remaining-- {
		select {
		case result := <-redis:
			out.Redis, out.QueueCount = result.health, result.count
		case result := <-database:
			out.Database = result
		case result := <-metrics:
			out.Metrics = result
		case <-ctx.Done():
			a.json(w, out)
			return
		}
	}
	a.json(w, out)
}
