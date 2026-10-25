package api

import (
	"context"
	"net/http"
	"time"
)

// The response is a fixed selection of INFO fields; upstream errors are logged,
// never returned.
func (a *API) redisInfo(w http.ResponseWriter, r *http.Request, _ params) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	info, e := a.Source.Redis(ctx)
	if e != nil {
		a.fail(w, r, 503, "REDIS_UNAVAILABLE", "Cannot read Redis server information. Check REDIS_URL, that Redis is running, and that the user may run INFO.", e)
		return
	}
	a.json(w, info)
}

// Cluster topology and the raw INFO output name hosts, ports and paths, so only
// the administrator account may read them.
func (a *API) redisCluster(w http.ResponseWriter, r *http.Request, _ params) {
	if !a.canViewLogs(r) {
		a.fail(w, r, 403, "FORBIDDEN", "Only the administrator account can view Redis cluster details.", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	v, e := a.Source.RedisCluster(ctx)
	if e != nil {
		a.fail(w, r, 503, "REDIS_UNAVAILABLE", "Cannot read Redis cluster details. Check REDIS_URL and that Redis is running.", e)
		return
	}
	a.json(w, v)
}

func (a *API) redisRaw(w http.ResponseWriter, r *http.Request, _ params) {
	if !a.canViewLogs(r) {
		a.fail(w, r, 403, "FORBIDDEN", "Only the administrator account can view the raw Redis INFO output.", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	v, e := a.Source.RedisRaw(ctx)
	if e != nil {
		a.fail(w, r, 503, "REDIS_UNAVAILABLE", "Cannot read Redis server information. Check REDIS_URL, that Redis is running, and that the user may run INFO.", e)
		return
	}
	a.json(w, v)
}
