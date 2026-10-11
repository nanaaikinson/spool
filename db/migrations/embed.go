package migrations

import _ "embed"

//go:embed 001_initial.sql
var Initial string

//go:embed 002_schedule_entries.sql
var ScheduleEntries string

//go:embed 003_server_logs.sql
var ServerLogs string
