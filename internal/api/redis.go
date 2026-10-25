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
