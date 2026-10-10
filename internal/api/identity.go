package api

import (
	"net/http"

	"github.com/nanaaikinson/spool/internal/domain"
)

func (a *API) managed(w http.ResponseWriter, r *http.Request) bool {
	if !a.Config.MultiOrg || a.Store == nil {
		a.fail(w, r, 409, "MANAGED_ACCOUNTS_DISABLED", "Enable organization management with PostgreSQL to manage accounts and organizations.", nil)
		return false
	}
	return true
}
func (a *API) setup(w http.ResponseWriter, r *http.Request, _ params) {
	if !a.managed(w, r) {
		return
	}
	if !a.csrf(r) {
		a.fail(w, r, 403, "CSRF_REJECTED", "Set up Spool from this console or the setup CLI.", nil)
		return
	}
	if !a.logins.allow(r) {
		a.fail(w, r, 429, "RATE_LIMITED", "Too many setup attempts. Try again in a minute.", nil)
		return
	}
	var in domain.SetupRequest
	if !a.decode(w, r, &in) {
		return
	}
	if a.Config.SetupToken == "" || !secureEqual(in.Token, a.Config.SetupToken) {
		a.fail(w, r, 403, "INVALID_SETUP_TOKEN", "Enter the setup token from your private deployment configuration.", nil)
		return
	}
	if a.Config.ReadOnly {
		a.fail(w, r, 403, "READ_ONLY", "Disable read-only mode to complete setup.", nil)
		return
	}
	if in.Organization.RedisURL == "" {
		in.Organization.RedisURL = a.Config.RedisURL
	}
	org, e := a.Store.Setup(r.Context(), a.Config.DataKey, in)
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, org)
}
func (a *API) listOrganizations(w http.ResponseWriter, r *http.Request, _ params) {
	if !a.managed(w, r) {
		return
	}
	c, _ := r.Context().Value(authKey{}).(claims)
	v, e := a.Store.Organizations(r.Context(), c.UserID, c.PlatformAdmin)
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, domain.OrganizationList{Data: v})
}
func (a *API) switchOrganization(w http.ResponseWriter, r *http.Request, _ params) {
	if !a.managed(w, r) {
		return
	}
	var in domain.SwitchOrganizationRequest
	if !a.decode(w, r, &in) {
		return
	}
	c, _ := r.Context().Value(authKey{}).(claims)
	if _, e := a.Store.Organization(r.Context(), in.ID, c.UserID, c.PlatformAdmin); e != nil {
		a.fail(w, r, 403, "FORBIDDEN", "You do not have access to this organization.", nil)
		return
	}
	c.OrganizationID = in.ID
	a.writeSession(w, r, c)
}
func (a *API) createOrganization(w http.ResponseWriter, r *http.Request, _ params) {
	if !a.managed(w, r) {
		return
	}
	var in domain.OrganizationRequest
	if !a.decode(w, r, &in) {
		return
	}
	c, _ := r.Context().Value(authKey{}).(claims)
	v, e := a.Store.CreateOrganization(r.Context(), a.Config.DataKey, c.UserID, c.Actor, in)
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, v)
}
func (a *API) renameOrganization(w http.ResponseWriter, r *http.Request, _ params) {
	if !a.managed(w, r) {
		return
	}
	var in domain.OrganizationNameRequest
	if !a.decode(w, r, &in) {
		return
	}
	if e := a.Store.RenameOrganization(r.Context(), actor(r), in.Name); e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, domain.OK{OK: true})
}
func (a *API) updateOrganizationConnection(w http.ResponseWriter, r *http.Request, _ params) {
	if !a.managed(w, r) {
		return
	}
	var in domain.OrganizationRequest
	if !a.decode(w, r, &in) {
		return
	}
	if e := a.Store.UpdateConnection(r.Context(), a.Config.DataKey, actor(r), in); e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, domain.OK{OK: true})
}
func (a *API) listMembers(w http.ResponseWriter, r *http.Request, _ params) {
	if !a.managed(w, r) {
		return
	}
	v, e := a.Store.Members(r.Context())
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, domain.MemberList{Data: v})
}
func (a *API) addMember(w http.ResponseWriter, r *http.Request, _ params) {
	if !a.managed(w, r) {
		return
	}
	var in domain.MemberRequest
	if !a.decode(w, r, &in) {
		return
	}
	if e := a.Store.AddMember(r.Context(), actor(r), in); e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, domain.OK{OK: true})
}
func (a *API) changeMember(w http.ResponseWriter, r *http.Request, p params) {
	if !a.managed(w, r) {
		return
	}
	var in domain.MemberRoleRequest
	if !a.decode(w, r, &in) {
		return
	}
	if e := a.Store.ChangeMember(r.Context(), actor(r), p.id, in.Role, false); e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, domain.OK{OK: true})
}
func (a *API) removeMember(w http.ResponseWriter, r *http.Request, p params) {
	if !a.managed(w, r) || !a.confirmed(w, r) {
		return
	}
	if e := a.Store.ChangeMember(r.Context(), actor(r), p.id, "", true); e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, domain.OK{OK: true})
}
func (a *API) listUsers(w http.ResponseWriter, r *http.Request, _ params) {
	if !a.managed(w, r) {
		return
	}
	v, e := a.Store.Users(r.Context())
	if e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, domain.UserList{Data: v})
}
func (a *API) updateUser(w http.ResponseWriter, r *http.Request, p params) {
	if !a.managed(w, r) {
		return
	}
	var in domain.UserUpdateRequest
	if !a.decode(w, r, &in) {
		return
	}
	if e := a.Store.UpdateUser(r.Context(), actor(r), p.id, in); e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, domain.OK{OK: true})
}
func (a *API) changePassword(w http.ResponseWriter, r *http.Request, _ params) {
	if !a.managed(w, r) {
		return
	}
	var in domain.PasswordRequest
	if !a.decode(w, r, &in) {
		return
	}
	c, _ := r.Context().Value(authKey{}).(claims)
	if e := a.Store.ChangePassword(r.Context(), c.UserID, in.CurrentPassword, in.Password); e != nil {
		a.failure(w, r, e)
		return
	}
	a.json(w, domain.OK{OK: true})
}
