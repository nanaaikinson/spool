package api

import (
	"net/http"
	"strings"

	z "github.com/Oudwins/zog"
	"github.com/nanaaikinson/spool/internal/domain"
)

func (a *API) listAudit(w http.ResponseWriter, r *http.Request, p params) {
	v, e := a.Store.Audits(r.Context(), p.int("page", 1), p.int("limit", 25))
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, v)
}

func (a *API) listViews(w http.ResponseWriter, r *http.Request, _ params) {
	v, e := a.Store.Views(r.Context(), actor(r))
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, domain.ViewList{Data: v})
}

func (a *API) saveView(w http.ResponseWriter, r *http.Request, _ params) {
	var in domain.ViewRequest
	if !a.decode(w, r, &in) {
		return
	}
	if !a.validate(
		w,
		r,
		z.Struct(z.Shape{"Name": z.String().Required().Min(1).Max(80), "Path": z.String().Required().Max(2048)}),
		&in,
	) {
		return
	}
	if !validView(in.Path) {
		a.fail(w, r, 422, "INVALID_VIEW", "Saved views can only point to the Queues, All tasks, Scheduled, or Failed page.", nil)
		return
	}
	v, e := a.Store.SaveView(r.Context(), actor(r), in)
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, v)
}

func (a *API) deleteView(w http.ResponseWriter, r *http.Request, p params) {
	if !a.confirmed(w, r) {
		return
	}
	if e := a.Store.DeleteView(r.Context(), actor(r), p.id); e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, domain.OK{OK: true})
}

func validView(path string) bool {
	base := strings.Split(path, "?")[0]
	return base == "/tasks" || base == "/queues" || base == "/failures" || base == "/scheduled"
}
