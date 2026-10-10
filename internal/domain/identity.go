package domain

import "time"

// Organization contains public metadata only; connection credentials never leave the server.
type Organization struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
}
type OrganizationList struct {
	Data []Organization `json:"data"`
}
type OrganizationRequest struct {
	Name     string `json:"name"`
	RedisURL string `json:"redis_url"`
	// Empty uses the deployment's Prometheus. All queries are organization scoped.
	PrometheusURL string `json:"prometheus_url"`
}
type SetupRequest struct {
	Token        string              `json:"token"`
	Organization OrganizationRequest `json:"organization"`
	Username     string              `json:"username"`
	Password     string              `json:"password"`
}
type SwitchOrganizationRequest struct {
	ID string `json:"id"`
}
type OrganizationNameRequest struct {
	Name string `json:"name"`
}
type Member struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
	Disabled bool   `json:"disabled"`
}
type MemberList struct {
	Data []Member `json:"data"`
}
type MemberRequest struct {
	Username string `json:"username"`
	// A password creates a new user. Leave empty to add an existing user.
	Password string `json:"password"`
	Role     string `json:"role"`
}
type MemberRoleRequest struct {
	Role string `json:"role"`
}
type User struct {
	ID            string    `json:"id"`
	Username      string    `json:"username"`
	Disabled      bool      `json:"disabled"`
	PlatformAdmin bool      `json:"platform_admin"`
	CreatedAt     time.Time `json:"created_at"`
}
type UserList struct {
	Data []User `json:"data"`
}
type UserUpdateRequest struct {
	// Nil preserves the account status during a password-only reset.
	Disabled *bool `json:"disabled"`
	// Empty preserves the password. Changing a password revokes existing sessions.
	Password string `json:"password"`
}
type PasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	Password        string `json:"password"`
}
