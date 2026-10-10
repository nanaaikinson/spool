package domain

import "time"

type Queue struct {
	Name           string    `json:"name"`
	Paused         bool      `json:"paused"`
	Pending        int       `json:"pending"`
	Active         int       `json:"active"`
	Scheduled      int       `json:"scheduled"`
	Retry          int       `json:"retry"`
	Archived       int       `json:"archived"`
	Completed      int       `json:"completed"`
	Aggregating    int       `json:"aggregating"`
	Processed      int       `json:"processed"`
	Failed         int       `json:"failed"`
	ProcessedTotal int       `json:"processed_total"`
	FailedTotal    int       `json:"failed_total"`
	LatencySeconds float64   `json:"latency_seconds"`
	MemoryBytes    int64     `json:"memory_bytes"`
	Timestamp      time.Time `json:"timestamp"`
}

type QueueList struct {
	Data []Queue `json:"data"`
}

type TaskState string

const (
	Pending     TaskState = "pending"
	Active      TaskState = "active"
	Scheduled   TaskState = "scheduled"
	Retry       TaskState = "retry"
	Archived    TaskState = "archived"
	Completed   TaskState = "completed"
	Aggregating TaskState = "aggregating"
)

var States = []string{"pending", "active", "scheduled", "retry", "archived", "completed", "aggregating"}

type TaskSummary struct {
	ID            string       `json:"id"`
	Queue         string       `json:"queue"`
	Type          string       `json:"type"`
	State         TaskState    `json:"state"`
	Retried       int          `json:"retried"`
	MaxRetry      int          `json:"max_retry"`
	LastError     string       `json:"last_error"`
	LastFailedAt  *time.Time   `json:"last_failed_at"`
	NextProcessAt *time.Time   `json:"next_process_at"`
	CompletedAt   *time.Time   `json:"completed_at"`
	Orphaned      bool         `json:"orphaned"`
	Schedule      *ScheduleRef `json:"schedule"`
}

// ScheduleRef links a task to the periodic entry that enqueued it.
type ScheduleRef struct {
	EntryID string `json:"entry_id"`
	Spec    string `json:"spec"`
}

type Payload struct {
	Data      string `json:"data"`
	Encoding  string `json:"encoding"`
	Bytes     int    `json:"bytes"`
	Truncated bool   `json:"truncated"`
}

type Task struct {
	TaskSummary
	Payload          Payload           `json:"payload"`
	Result           Payload           `json:"result"`
	Headers          map[string]string `json:"headers"`
	TimeoutSeconds   float64           `json:"timeout_seconds"`
	Deadline         *time.Time        `json:"deadline"`
	Group            string            `json:"group"`
	RetentionSeconds float64           `json:"retention_seconds"`
	Actions          []string          `json:"actions"`
}

type Pagination struct {
	NextCursor string `json:"next_cursor"`
	HasMore    bool   `json:"has_more"`
	Total      int    `json:"total"`
	Scope      string `json:"scope"`
}

type TaskList struct {
	Data       []TaskSummary `json:"data"`
	Pagination Pagination    `json:"pagination"`
}

type TaskFilter struct {
	Queue       string
	State       string
	Group       string
	Type        string
	ID          string
	MinRetry    int
	FailedAfter *time.Time
	Cursor      string
	Limit       int
}

type Worker struct {
	TaskID   string     `json:"task_id"`
	TaskType string     `json:"task_type"`
	Queue    string     `json:"queue"`
	Started  time.Time  `json:"started"`
	Deadline *time.Time `json:"deadline"`
}

type Server struct {
	ID             string         `json:"id"`
	Host           string         `json:"host"`
	PID            int            `json:"pid"`
	Concurrency    int            `json:"concurrency"`
	Queues         map[string]int `json:"queues"`
	StrictPriority bool           `json:"strict_priority"`
	Started        time.Time      `json:"started"`
	Status         string         `json:"status"`
	Workers        []Worker       `json:"workers"`
}

type ServerList struct {
	Data []Server `json:"data"`
}

type Scheduler struct {
	ID       string     `json:"id"`
	Spec     string     `json:"spec"`
	Type     string     `json:"type"`
	Next     time.Time  `json:"next"`
	Previous *time.Time `json:"previous"`
}

type SchedulerList struct {
	Data []Scheduler `json:"data"`
}

type Overview struct {
	Queues        []Queue   `json:"queues"`
	Servers       int       `json:"servers"`
	Concurrency   int       `json:"concurrency"`
	ActiveWorkers int       `json:"active_workers"`
	ObservedAt    time.Time `json:"observed_at"`
}

type Point struct {
	Time  time.Time `json:"time"`
	Value float64   `json:"value"`
}

type Series struct {
	Queue  string  `json:"queue"`
	Points []Point `json:"points"`
}

type MetricResult struct {
	Metric string   `json:"metric"`
	Source string   `json:"source"`
	Unit   string   `json:"unit"`
	Data   []Series `json:"data"`
}

type MetricHealth struct {
	Configured bool   `json:"configured"`
	Available  bool   `json:"available"`
	Message    string `json:"message"`
}

type FieldError struct {
	Field   string   `json:"field"`
	Reasons []string `json:"reasons"`
}

type ErrorDetails struct {
	Fields []FieldError `json:"fields"`
}

type Error struct {
	Code    string       `json:"code"`
	Message string       `json:"message"`
	Details ErrorDetails `json:"details"`
}

type ActionRequest struct {
	Confirm bool `json:"confirm"`
}

type TaskTarget struct {
	Queue string `json:"queue"`
	ID    string `json:"id"`
}

type BulkRequest struct {
	Action  string       `json:"action"`
	Tasks   []TaskTarget `json:"tasks"`
	Confirm bool         `json:"confirm"`
}

type ActionResult struct {
	Queue   string `json:"queue"`
	ID      string `json:"id"`
	Success bool   `json:"success"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type BulkResult struct {
	Data []ActionResult `json:"data"`
}

type CloneRequest struct {
	Confirm  bool   `json:"confirm"`
	Queue    string `json:"queue"`
	Type     string `json:"type"`
	Payload  string `json:"payload"`
	MaxRetry int    `json:"max_retry"`
}

type Audit struct {
	ID        string    `json:"id"`
	Actor     string    `json:"actor"`
	Action    string    `json:"action"`
	Queue     string    `json:"queue"`
	TaskID    string    `json:"task_id"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

type AuditList struct {
	Data []Audit `json:"data"`
}

type SavedView struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	Actor     string    `json:"actor"`
	CreatedAt time.Time `json:"created_at"`
}

type ViewRequest struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type ViewList struct {
	Data []SavedView `json:"data"`
}

type Session struct {
	Authenticated bool   `json:"authenticated"`
	AuthRequired  bool   `json:"auth_required"`
	Actor         string `json:"actor"`
	Role          string `json:"role"`
	Environment   string `json:"environment"`
	Version       string `json:"version"`
	// ReadOnly is true when no changes are allowed for anyone, with the reason
	// in ReadOnlyReason: "configured" or "no_database".
	ReadOnly       bool   `json:"read_only"`
	ReadOnlyReason string `json:"read_only_reason"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type OK struct {
	OK bool `json:"ok"`
}

// ErrorGroup collects sampled failures that share a task type and normalized error.
type ErrorGroup struct {
	Signature string     `json:"signature"`
	Type      string     `json:"type"`
	Pattern   string     `json:"pattern"`
	Error     string     `json:"error"`
	Count     int        `json:"count"`
	Retry     int        `json:"retry"`
	Archived  int        `json:"archived"`
	Queues    []string   `json:"queues"`
	FirstSeen *time.Time `json:"first_seen"`
	LastSeen  *time.Time `json:"last_seen"`
	Sample    TaskTarget `json:"sample"`
}

type ErrorGroupList struct {
	Data    []ErrorGroup `json:"data"`
	Sampled int          `json:"sampled"`
	Total   int          `json:"total"`
}

// ScheduleLink records that a periodic entry enqueued a task.
type ScheduleLink struct {
	TaskID     string
	EntryID    string
	EnqueuedAt time.Time
}
