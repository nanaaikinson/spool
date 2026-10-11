package api

import (
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func init() {
	// Icons and the web manifest aren't in Go's built-in MIME table, and the
	// container image has no system MIME database to fall back on.
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
	_ = mime.AddExtensionType(".ico", "image/x-icon")
}

func (a *API) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		ww.Header().Set("X-Request-ID", middleware.GetReqID(r.Context()))
		ww.Header().Set("X-Content-Type-Options", "nosniff")
		ww.Header().Set("Referrer-Policy", "same-origin")
		ww.Header().Set(
			"Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'",
		)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			ww.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(ww, r)
		route := chi.RouteContext(r.Context()).RoutePattern()
		if route == "" {
			route = "unmatched"
		}
		if a.Requests != nil {
			a.Requests.WithLabelValues(r.Method, route, strconv.Itoa(ww.Status())).Observe(time.Since(start).Seconds())
		}
		if r.URL.Path != "/api/v1/events" {
			a.Log.Info(
				"http request",
				"request_id", middleware.GetReqID(r.Context()),
				"method", r.Method,
				"route", route,
				"status", ww.Status(),
				"duration_ms", time.Since(start).Milliseconds(),
			)
		}
	})
}

func (a *API) recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				a.Log.Error("handler panic", "request_id", middleware.GetReqID(r.Context()))
				a.fail(w, r, 500, "INTERNAL_ERROR", "Something went wrong on the server. Try again, and check the server logs if it keeps happening.", nil)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (a *API) limitMiddleware() func(http.Handler) http.Handler {
	slots := make(chan struct{}, 100)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			select {
			case slots <- struct{}{}:
				defer func() {
					<-slots
				}()
				next.ServeHTTP(w, r)
			default:
				a.fail(w, r, 429, "RATE_LIMITED", "Spool is handling too many requests. Try again in a moment.", nil)
			}
		})
	}
}

func (a *API) static(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") || r.Method != "GET" {
		a.fail(w, r, 404, "NOT_FOUND", "No route matches this path.", nil)
		return
	}
	path := filepath.Join(a.Config.StaticDir, filepath.Clean("/"+r.URL.Path))
	if info, e := os.Stat(path); e == nil && !info.IsDir() {
		http.ServeFile(w, r, path)
		return
	}
	index := filepath.Join(a.Config.StaticDir, "index.html")
	if _, e := os.Stat(index); e != nil {
		a.fail(w, r, 503, "UI_NOT_BUILT", "The web UI has not been built. Run make build, or use the Vite dev server with make web.", nil)
		return
	}
	http.ServeFile(w, r, index)
}

// events streams server-sent query invalidations until the client leaves or its session lapses.
func (a *API) events(w http.ResponseWriter, r *http.Request, _ params) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		a.fail(w, r, 500, "STREAM_UNAVAILABLE", "Live updates are not supported on this connection.", nil)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	ch, unsubscribe := a.Events.Subscribe()
	defer unsubscribe()
	if _, e := fmt.Fprint(w, "event: connected\ndata: {}\n\n"); e != nil {
		return
	}
	flusher.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case ev := <-ch:
			fresh, ok := a.identity(r)
			if !ok {
				return
			}
			if a.Config.MultiOrg {
				original, _ := r.Context().Value(authKey{}).(claims)
				if fresh.OrganizationID != original.OrganizationID {
					return
				}
			}
			if a.Config.MultiOrg && strings.HasPrefix(ev, "changed:") {
				c, _ := r.Context().Value(authKey{}).(claims)
				if ev != "changed:"+c.OrganizationID {
					continue
				}
				ev = "changed"
			}
			if _, e := fmt.Fprintf(w, "event: %s\ndata: {}\n\n", ev); e != nil {
				return
			}
			flusher.Flush()
		}
	}
}
