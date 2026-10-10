package api

import (
	"net/http"
	"time"

	z "github.com/Oudwins/zog"
	"github.com/nanaaikinson/spool/internal/asynqadapter"
	"github.com/nanaaikinson/spool/internal/domain"
)

func (a *API) listTasks(w http.ResponseWriter, r *http.Request, p params) {
	f, ok := a.taskFilter(w, r, p)
	if !ok {
		return
	}
	v, e := a.Source.Tasks(r.Context(), f)
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, v)
}

// taskFilter checks the rules the contract can't express; limit, min_retry and state are already validated.
func (a *API) taskFilter(w http.ResponseWriter, r *http.Request, p params) (domain.TaskFilter, bool) {
	v := r.URL.Query()
	f := domain.TaskFilter{
		Queue:    v.Get("queue"),
		State:    v.Get("state"),
		Group:    v.Get("group"),
		Type:     v.Get("type"),
		ID:       v.Get("id"),
		Cursor:   v.Get("cursor"),
		Limit:    p.int("limit", 50),
		MinRetry: p.int("min_retry", 0),
	}
	schema := z.Struct(z.Shape{
		"Queue":  z.String().Max(200),
		"ID":     z.String().Max(200),
		"Type":   z.String().Max(200),
		"Group":  z.String().Max(200),
		"Cursor": z.String().Max(2048),
	})
	if !a.validate(w, r, schema, &f) {
		return f, false
	}
	if (f.Queue != "" && !identifier.MatchString(f.Queue)) || (f.ID != "" && !identifier.MatchString(f.ID)) {
		a.fail(w, r, 422, "INVALID_IDENTIFIER", "The queue or task ID filter is too long or contains unsupported characters.", nil)
		return f, false
	}
	if f.State == "aggregating" && f.Group == "" {
		a.fail(w, r, 422, "GROUP_REQUIRED", "Choose a group to view aggregating tasks.", nil)
		return f, false
	}
	if raw := v.Get("failed_after"); raw != "" {
		t, e := time.Parse(time.RFC3339, raw)
		if e != nil {
			a.fail(w, r, 422, "VALIDATION_ERROR", "Failed-after time must be an RFC 3339 timestamp, such as 2026-01-02T15:04:05Z.", nil)
			return f, false
		}
		f.FailedAfter = &t
	}
	return f, true
}

func (a *API) getTask(w http.ResponseWriter, r *http.Request, p params) {
	v, e := a.Source.Task(r.Context(), p.queue, p.id)
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, v)
}

func (a *API) retryTask(w http.ResponseWriter, r *http.Request, p params) {
	a.taskAction(w, r, p, "retry")
}

func (a *API) archiveTask(w http.ResponseWriter, r *http.Request, p params) {
	a.taskAction(w, r, p, "archive")
}

func (a *API) deleteTask(w http.ResponseWriter, r *http.Request, p params) {
	a.taskAction(w, r, p, "delete")
}

func (a *API) cancelTask(w http.ResponseWriter, r *http.Request, p params) {
	a.taskAction(w, r, p, "cancel")
}

func (a *API) taskAction(w http.ResponseWriter, r *http.Request, p params, action string) {
	if !a.confirmed(w, r) {
		return
	}
	e := a.audited(r, action, p.queue, p.id, func() error {
		return a.Source.TaskAction(r.Context(), p.queue, p.id, action)
	})
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, domain.OK{OK: true})
}

func (a *API) cloneTask(w http.ResponseWriter, r *http.Request, p params) {
	var in domain.CloneRequest
	if !a.decode(w, r, &in) {
		return
	}
	if !in.Confirm {
		a.fail(w, r, 422, "CONFIRMATION_REQUIRED", "Confirm before creating the task.", nil)
		return
	}
	if !a.validate(
		w,
		r,
		z.Struct(z.Shape{
			"Queue":    z.String().Required().Match(identifier),
			"Type":     z.String().Required().Max(200),
			"Payload":  z.String().Max(asynqadapter.MaxPayload),
			"MaxRetry": z.Int().GTE(0).LTE(100),
		}),
		&in,
	) {
		return
	}
	var t domain.Task
	e := a.audited(
		r,
		"clone",
		p.queue,
		p.id,
		func() error {
			var e error
			t, e = a.Source.Clone(r.Context(), p.queue, p.id, in)
			return e
		},
	)
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, t)
}

func (a *API) bulkAction(w http.ResponseWriter, r *http.Request, _ params) {
	var in domain.BulkRequest
	if !a.decode(w, r, &in) {
		return
	}
	if !in.Confirm || len(in.Tasks) < 1 || len(in.Tasks) > 50 ||
		(in.Action != "retry" && in.Action != "archive" && in.Action != "delete") {
		a.fail(w, r, 422, "VALIDATION_ERROR", "Select 1–50 tasks, choose retry, archive, or delete, and confirm.", nil)
		return
	}
	seen := map[string]bool{}
	for _, t := range in.Tasks {
		k := t.Queue + "/" + t.ID
		if !identifier.MatchString(t.Queue) || !identifier.MatchString(t.ID) || seen[k] {
			a.fail(w, r, 422, "VALIDATION_ERROR", "The selection includes an invalid or duplicate task.", nil)
			return
		}
		seen[k] = true
	}
	out := domain.BulkResult{Data: []domain.ActionResult{}}
	for _, t := range in.Tasks {
		if r.Context().Err() != nil {
			break
		}
		e := a.audited(
			r,
			in.Action,
			t.Queue,
			t.ID,
			func() error {
				return a.Source.TaskAction(r.Context(), t.Queue, t.ID, in.Action)
			},
		)
		result := domain.ActionResult{Queue: t.Queue, ID: t.ID, Success: e == nil}
		if e != nil {
			result.Code = "ACTION_FAILED"
			result.Message = "Action failed. Check the task's current state and the audit log."
		}
		out.Data = append(out.Data, result)
	}
	a.json(w, out)
}
