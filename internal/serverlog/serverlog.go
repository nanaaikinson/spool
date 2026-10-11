// Package serverlog keeps Spool's own log records for the console. Every
// record goes to the wrapped handler and is also queued and written to the
// database in the background. HTTP access lines use a separate logger and are
// not kept.
package serverlog

import (
	"context"
	"fmt"
	"log/slog"
	"runtime"
	"sync"
	"time"

	"github.com/nanaaikinson/spool/internal/domain"
	"github.com/prometheus/client_golang/prometheus"
)

// Writer persists recorded entries; the store implements it.
type Writer interface {
	RecordServerLogs(ctx context.Context, entries []domain.ServerLog) error
}

// Recorder buffers entries until a Writer is attached, so warnings logged
// before the database opens are kept too.
type Recorder struct {
	next    slog.Handler
	entries chan domain.ServerLog
	events  *prometheus.CounterVec
	done    chan struct{}
	once    sync.Once
	started bool
}

// New wraps next. At most queue entries wait for the database; further ones
// are dropped rather than blocking the caller.
func New(next slog.Handler, queue int) *Recorder {
	return &Recorder{
		next:    next,
		entries: make(chan domain.ServerLog, queue),
		events: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "spool_log_events_total",
				Help: "Log records written by Spool, by level.",
			},
			[]string{"level"},
		),
		done: make(chan struct{}),
	}
}

// Collector exposes the log event counter for registration.
func (r *Recorder) Collector() prometheus.Collector { return r.events }

// Handler returns the slog handler to build the logger from.
func (r *Recorder) Handler() slog.Handler { return &handler{r: r, next: r.next} }

// Attach starts writing queued entries to w. Call it once.
func (r *Recorder) Attach(w Writer) {
	r.started = true
	go r.run(w)
}

// Close stops accepting entries and waits briefly for queued ones to be written.
func (r *Recorder) Close() {
	r.once.Do(func() { close(r.entries) })
	if !r.started {
		return
	}
	select {
	case <-r.done:
	case <-time.After(3 * time.Second):
	}
}

func (r *Recorder) run(w Writer) {
	defer close(r.done)
	for first := range r.entries {
		batch := []domain.ServerLog{first}
	drain:
		for len(batch) < 100 {
			select {
			case e, ok := <-r.entries:
				if !ok {
					break drain
				}
				batch = append(batch, e)
			default:
				break drain
			}
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if e := w.RecordServerLogs(ctx, batch); e != nil {
			// Report through the wrapped handler only, so a failing database
			// cannot feed its own errors back into the queue.
			rec := slog.NewRecord(time.Now(), slog.LevelError, "server log write failed", 0)
			rec.AddAttrs(slog.Int("dropped", len(batch)), slog.String("error_type", fmt.Sprintf("%T", e)))
			_ = r.next.Handle(ctx, rec)
		}
		cancel()
	}
}

func (r *Recorder) record(e domain.ServerLog) {
	defer func() { _ = recover() }() // the queue is closed during shutdown
	select {
	case r.entries <- e:
	default:
	}
}

type handler struct {
	r      *Recorder
	next   slog.Handler
	attrs  []slog.Attr
	groups string
}

func (h *handler) Enabled(ctx context.Context, l slog.Level) bool { return h.next.Enabled(ctx, l) }

func (h *handler) Handle(ctx context.Context, rec slog.Record) error {
	h.r.events.WithLabelValues(rec.Level.String()).Inc()
	h.r.record(h.entry(rec))
	return h.next.Handle(ctx, rec)
}

func (h *handler) WithAttrs(as []slog.Attr) slog.Handler {
	c := *h
	c.next = h.next.WithAttrs(as)
	c.attrs = append(append([]slog.Attr{}, h.attrs...), prefixed(h.groups, as)...)
	return &c
}

func (h *handler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	c := *h
	c.next = h.next.WithGroup(name)
	c.groups = h.groups + name + "."
	return &c
}

func (h *handler) entry(rec slog.Record) domain.ServerLog {
	e := domain.ServerLog{
		Time:    rec.Time.UTC(),
		Level:   rec.Level.String(),
		Message: rec.Message,
		Attrs:   []domain.LogAttr{},
	}
	if rec.PC != 0 {
		f, _ := runtime.CallersFrames([]uintptr{rec.PC}).Next()
		e.Caller = fmt.Sprintf("%s:%d", f.File, f.Line)
	}
	add := func(a slog.Attr) {
		if a.Equal(slog.Attr{}) {
			return
		}
		e.Attrs = append(e.Attrs, domain.LogAttr{Key: a.Key, Value: a.Value.Resolve().String()})
	}
	for _, a := range h.attrs {
		add(a)
	}
	rec.Attrs(func(a slog.Attr) bool {
		for _, p := range prefixed(h.groups, []slog.Attr{a}) {
			add(p)
		}
		return true
	})
	return e
}

// prefixed flattens groups into dotted keys.
func prefixed(prefix string, as []slog.Attr) []slog.Attr {
	out := make([]slog.Attr, 0, len(as))
	for _, a := range as {
		v := a.Value.Resolve()
		if v.Kind() == slog.KindGroup {
			p := prefix
			if a.Key != "" {
				p += a.Key + "."
			}
			out = append(out, prefixed(p, v.Group())...)
			continue
		}
		out = append(out, slog.Attr{Key: prefix + a.Key, Value: v})
	}
	return out
}
