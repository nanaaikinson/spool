package api

import (
	"net/http"
	"time"

	"github.com/nanaaikinson/spool/internal/domain"
)

func (a *API) listQueues(w http.ResponseWriter, r *http.Request, _ params) {
	qs, e := a.Source.Queues(r.Context())
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, domain.QueueList{Data: qs})
}

func (a *API) getQueue(w http.ResponseWriter, r *http.Request, p params) {
	v, e := a.Source.Queue(r.Context(), p.queue)
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, v)
}

func (a *API) getOverview(w http.ResponseWriter, r *http.Request, _ params) {
	qs, e := a.Source.Queues(r.Context())
	if e != nil {
		a.failure(w, r, e)
		return
	}
	ss, e := a.Source.Servers(r.Context())
	if e != nil {
		a.failure(w, r, e)
		return
	}
	o := domain.Overview{Queues: qs, Servers: len(ss), ObservedAt: time.Now()}
	for _, s := range ss {
		o.Concurrency += s.Concurrency
		o.ActiveWorkers += len(s.Workers)
	}
	a.json(w, o)
}

func (a *API) pauseQueue(w http.ResponseWriter, r *http.Request, p params) {
	a.queueAction(w, r, p.queue, "pause")
}

func (a *API) resumeQueue(w http.ResponseWriter, r *http.Request, p params) {
	a.queueAction(w, r, p.queue, "resume")
}

func (a *API) deleteQueue(w http.ResponseWriter, r *http.Request, p params) {
	a.queueAction(w, r, p.queue, "delete")
}

func (a *API) queueAction(w http.ResponseWriter, r *http.Request, q, action string) {
	if !a.confirmed(w, r) {
		return
	}
	e := a.audited(r, action, q, "", func() error {
		return a.Source.QueueAction(r.Context(), q, action)
	})
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, domain.OK{OK: true})
}

func (a *API) listErrorGroups(w http.ResponseWriter, r *http.Request, p params) {
	queue := r.URL.Query().Get("queue")
	if len(queue) > 200 {
		a.fail(w, r, 422, "VALIDATION_ERROR", "Queue name must be 200 characters or fewer.", nil)
		return
	}
	v, e := a.Source.ErrorGroups(r.Context(), queue, p.int("limit", 500))
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, v)
}

func (a *API) listServers(w http.ResponseWriter, r *http.Request, _ params) {
	v, e := a.Source.Servers(r.Context())
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, domain.ServerList{Data: v})
}

func (a *API) listSchedulers(w http.ResponseWriter, r *http.Request, _ params) {
	v, e := a.Source.Schedulers(r.Context())
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, domain.SchedulerList{Data: v})
}

func (a *API) listSchedulerEvents(w http.ResponseWriter, r *http.Request, p params) {
	v, e := a.Source.SchedulerEvents(r.Context(), p.id, p.int("limit", 30))
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, domain.SchedulerEventList{Data: v})
}
