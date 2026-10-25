package api

import (
	"encoding/json"
	"math"
	"net/http"
	"net/url"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/nanaaikinson/spool/internal/domain"
)

type Parameter struct {
	Name        string
	Type        string
	Description string
	Required    bool
	Enum        []string
	Minimum     *int
	Maximum     *int
}

type Endpoint struct {
	Method     string
	Path       string
	ID         string
	Summary    string
	Response   any
	Request    any
	Parameters []Parameter
	Public     bool
	// Handle runs once the path identifiers and Parameters have been validated.
	Handle func(*API, http.ResponseWriter, *http.Request, params)
}

func q(name, description string) Parameter {
	return Parameter{Name: name, Type: "string", Description: description}
}

// logParams are the search and range shared by the log endpoints.
func logParams() []Parameter {
	return []Parameter{
		q("q", "Search: free text, field:value (level, message, caller or an attribute; * is a wildcard), -term to exclude, \"quoted text\""),
		{Name: "start", Type: "string", Description: "RFC3339 start; defaults to an hour before end"},
		{Name: "end", Type: "string", Description: "RFC3339 end, exclusive; defaults to now; at most 31 days after start"},
	}
}

func n(name, description string, min, max int) Parameter {
	return Parameter{Name: name, Type: "integer", Description: description, Minimum: &min, Maximum: &max}
}

// parseQuery checks v against ps and returns the integers it parsed. Empty values count as absent.
func parseQuery(ps []Parameter, v url.Values) (map[string]int, *domain.FieldError) {
	ints := map[string]int{}
	for _, p := range ps {
		raw := v.Get(p.Name)
		if raw == "" {
			if p.Required {
				return nil, invalidParam(p.Name, "is required")
			}
			continue
		}
		if len(p.Enum) > 0 && !slices.Contains(p.Enum, raw) {
			return nil, invalidParam(p.Name, "must be one of "+oneOf(p.Enum))
		}
		if p.Type == "integer" {
			i, e := strconv.Atoi(raw)
			if e != nil || (p.Minimum != nil && i < *p.Minimum) || (p.Maximum != nil && i > *p.Maximum) {
				return nil, invalidParam(p.Name, "must be a whole number"+bounds(p))
			}
			ints[p.Name] = i
		}
	}
	return ints, nil
}

func invalidParam(name, problem string) *domain.FieldError {
	return &domain.FieldError{Field: name, Reasons: []string{name + " " + problem + "."}}
}

func bounds(p Parameter) string {
	switch {
	case p.Minimum != nil && p.Maximum != nil:
		return " from " + thousands(*p.Minimum) + " to " + thousands(*p.Maximum)
	case p.Minimum != nil:
		return " of " + thousands(*p.Minimum) + " or more"
	case p.Maximum != nil:
		return " of " + thousands(*p.Maximum) + " or fewer"
	}
	return ""
}

func oneOf(values []string) string {
	switch len(values) {
	case 1:
		return values[0]
	case 2:
		return values[0] + " or " + values[1]
	}
	return strings.Join(values[:len(values)-1], ", ") + ", or " + values[len(values)-1]
}

func thousands(n int) string {
	s, sign := strconv.Itoa(n), ""
	if n < 0 {
		s, sign = s[1:], "-"
	}
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return sign + s
}

var metricNames = []string{"depth", "pending", "active", "retry", "archived", "latency", "processed", "failed"}

func Endpoints() []Endpoint {
	return []Endpoint{
		{"GET", "/session", "getSession", "Session and environment", domain.Session{}, nil, nil, true, (*API).getSession},
		{"POST", "/session", "login", "Sign in", domain.Session{}, domain.LoginRequest{}, nil, true, (*API).login},
		{"DELETE", "/session", "logout", "Sign out", domain.OK{}, domain.ActionRequest{}, nil, false, (*API).logout},
		{"GET", "/overview", "getOverview", "Current Asynq overview", domain.Overview{}, nil, nil, false, (*API).getOverview},
		{"GET", "/queues", "listQueues", "List current queues", domain.QueueList{}, nil, nil, false, (*API).listQueues},
		{"GET", "/queues/{queue}", "getQueue", "Inspect a queue", domain.Queue{}, nil, nil, false, (*API).getQueue},
		{
			"POST",
			"/queues/{queue}/pause",
			"pauseQueue",
			"Pause queue processing",
			domain.OK{},
			domain.ActionRequest{},
			nil,
			false,
			(*API).pauseQueue,
		},
		{
			"POST",
			"/queues/{queue}/resume",
			"resumeQueue",
			"Resume queue processing",
			domain.OK{},
			domain.ActionRequest{},
			nil,
			false,
			(*API).resumeQueue,
		},
		{
			"GET",
			"/tasks",
			"listTasks",
			"Read a bounded native task page",
			domain.TaskList{},
			nil,
			[]Parameter{
				q("queue", "Queue name; combine with id for direct lookup"),
				{
					Name:        "state",
					Type:        "string",
					Description: "failed combines retry and archived",
					Enum:        append(append([]string{}, domain.States...), "failed"),
				},
				q("group", "Required for aggregating tasks"),
				q("type", "Case-insensitive type substring on this native page"),
				q("id", "Exact task ID"),
				n("min_retry", "Minimum retry count on this native page", 0, 100000),
				q("failed_after", "RFC3339 last failure cutoff on this native page"),
				q("cursor", "Opaque cursor; filters must remain unchanged"),
				n("limit", "Native page size", 1, 100),
			},
			false,
			(*API).listTasks,
		},
		{
			"GET",
			"/tasks/{queue}/{id}",
			"getTask",
			"Inspect retained task details",
			domain.Task{},
			nil,
			nil,
			false,
			(*API).getTask,
		},
		{
			"POST",
			"/tasks/{queue}/{id}/retry",
			"retryTask",
			"Run eligible task now",
			domain.OK{},
			domain.ActionRequest{},
			nil,
			false,
			(*API).retryTask,
		},
		{
			"POST",
			"/tasks/{queue}/{id}/archive",
			"archiveTask",
			"Archive eligible task",
			domain.OK{},
			domain.ActionRequest{},
			nil,
			false,
			(*API).archiveTask,
		},
		{
			"DELETE",
			"/tasks/{queue}/{id}",
			"deleteTask",
			"Delete inactive task",
			domain.OK{},
			domain.ActionRequest{},
			nil,
			false,
			(*API).deleteTask,
		},
		{
			"POST",
			"/tasks/{queue}/{id}/cancel",
			"cancelTask",
			"Request cancellation of active processing",
			domain.OK{},
			domain.ActionRequest{},
			nil,
			false,
			(*API).cancelTask,
		},
		{
			"POST",
			"/tasks/{queue}/{id}/clone",
			"cloneTask",
			"Enqueue a new copy with explicit options",
			domain.Task{},
			domain.CloneRequest{},
			nil,
			false,
			(*API).cloneTask,
		},
		{
			"POST",
			"/tasks/bulk",
			"bulkAction",
			"Perform up to 50 confirmed task actions",
			domain.BulkResult{},
			domain.BulkRequest{},
			nil,
			false,
			(*API).bulkAction,
		},
		{
			"GET",
			"/failures/groups",
			"listErrorGroups",
			"Group the newest retained failures by task type and error",
			domain.ErrorGroupList{},
			nil,
			[]Parameter{
				q("queue", "Optional queue scope"),
				n("limit", "Failures to sample, newest first, split across queues and states", 50, 1000),
			},
			false,
			(*API).listErrorGroups,
		},
		{
			"GET",
			"/servers",
			"listServers",
			"Live servers and active workers",
			domain.ServerList{},
			nil,
			nil,
			false,
			(*API).listServers,
		},
		{
			"GET",
			"/schedulers",
			"listSchedulers",
			"Live periodic schedule entries",
			domain.SchedulerList{},
			nil,
			nil,
			false,
			(*API).listSchedulers,
		},
		{
			"GET",
			"/metrics",
			"metricsHealth",
			"Historical metrics availability",
			domain.MetricHealth{},
			nil,
			nil,
			false,
			(*API).metricsHealth,
		},
		{"GET", "/redis", "getRedisInfo", "Redis server information", domain.RedisInfo{}, nil, nil, false, (*API).redisInfo},
		{"GET", "/status", "getDeploymentStatus", "Deployment connection diagnostics", domain.DeploymentStatus{}, nil, nil, false, (*API).deploymentStatus},
		{
			"GET",
			"/metrics/query",
			"queryMetric",
			"Query an allowlisted native metric",
			domain.MetricResult{},
			nil,
			[]Parameter{
				{
					Name:     "metric",
					Type:     "string",
					Required: true,
					Enum:     metricNames,
				},
				q("queue", "Optional queue scope"),
			},
			false,
			(*API).queryMetric,
		},
		{
			"GET",
			"/metrics/query-range",
			"queryMetricRange",
			"Query bounded historical metrics",
			domain.MetricResult{},
			nil,
			[]Parameter{
				{
					Name:     "metric",
					Type:     "string",
					Required: true,
					Enum:     metricNames,
				},
				q("queue", "Optional queue scope"),
				{Name: "start", Type: "string", Required: true, Description: "RFC3339 start"},
				{Name: "end", Type: "string", Required: true, Description: "RFC3339 end; range no more than 7 days"},
				n("step", "Seconds between points; at most 1500 points", 15, 3600),
			},
			false,
			(*API).queryMetricRange,
		},
		{
			"GET",
			"/audit",
			"listAudit",
			"Administrative audit intents, newest first",
			domain.AuditList{},
			nil,
			[]Parameter{
				n("page", "Page number, starting at 1", 1, 1000000),
				n("limit", "Records per page", 1, 100),
			},
			false,
			(*API).listAudit,
		},
		{
			"GET",
			"/logs",
			"listServerLogs",
			"Spool's own log records, newest first; administrator only",
			domain.ServerLogList{},
			nil,
			append(
				logParams(),
				n("before", "Return records older than this record ID", 1, math.MaxInt32),
				n("after", "Return the records just newer than this record ID", 1, math.MaxInt32),
				Parameter{Name: "at", Type: "string", Description: "RFC3339 time; return records logged before it, newest first"},
				n("around", "Return the records logged around this record ID, ignoring q, start and end", 1, math.MaxInt32),
				n("limit", "Records to return; with around, records on each side is half of this", 1, 500),
			),
			false,
			(*API).listServerLogs,
		},
		{
			"GET",
			"/logs/histogram",
			"logHistogram",
			"Matching log records per level over time; administrator only",
			domain.LogHistogram{},
			nil,
			logParams(),
			false,
			(*API).logHistogram,
		},
		{"GET", "/views", "listViews", "Current actor's saved views", domain.ViewList{}, nil, nil, false, (*API).listViews},
		{
			"POST",
			"/views",
			"saveView",
			"Save current task or queue view",
			domain.SavedView{},
			domain.ViewRequest{},
			nil,
			false,
			(*API).saveView,
		},
		{
			"DELETE",
			"/views/{id}",
			"deleteView",
			"Delete own saved view",
			domain.OK{},
			domain.ActionRequest{},
			nil,
			false,
			(*API).deleteView,
		},
		{"GET", "/events", "events", "Server-sent query invalidations", nil, nil, nil, false, (*API).events},
	}
}

func OpenAPI() ([]byte, error) {
	schemas := map[string]any{}
	var schema func(reflect.Type) map[string]any
	schema = func(t reflect.Type) map[string]any {
		if t.Kind() == reflect.Pointer {
			s := schema(t.Elem())
			return map[string]any{"anyOf": []any{s, map[string]any{"type": "null"}}}
		}
		if t == reflect.TypeFor[time.Time]() {
			return map[string]any{"type": "string", "format": "date-time"}
		}
		switch t.Kind() {
		case reflect.String:
			s := map[string]any{"type": "string"}
			if t == reflect.TypeFor[domain.TaskState]() {
				s["enum"] = domain.States
			}
			return s
		case reflect.Bool:
			return map[string]any{"type": "boolean"}
		case reflect.Int, reflect.Int64:
			return map[string]any{"type": "integer"}
		case reflect.Float64:
			return map[string]any{"type": "number"}
		case reflect.Slice:
			return map[string]any{"type": "array", "items": schema(t.Elem())}
		case reflect.Map:
			return map[string]any{"type": "object", "additionalProperties": schema(t.Elem())}
		case reflect.Struct:
			name := t.Name()
			if _, ok := schemas[name]; ok {
				return map[string]any{"$ref": "#/components/schemas/" + name}
			}
			schemas[name] = map[string]any{}
			props := map[string]any{}
			required := []string{}
			var fields func(reflect.Type)
			fields = func(st reflect.Type) {
				for i := 0; i < st.NumField(); i++ {
					f := st.Field(i)
					if f.Anonymous {
						fields(f.Type)
						continue
					}
					key := strings.Split(f.Tag.Get("json"), ",")[0]
					if key == "" || key == "-" {
						continue
					}
					props[key] = schema(f.Type)
					required = append(required, key)
				}
			}
			fields(t)
			schemas[name] = map[string]any{
				"type":                 "object",
				"properties":           props,
				"required":             required,
				"additionalProperties": false,
			}
			return map[string]any{"$ref": "#/components/schemas/" + name}
		}
		panic("unsupported contract type: " + t.String())
	}
	errorSchema := schema(reflect.TypeFor[domain.Error]())
	paths := map[string]any{}
	for _, e := range Endpoints() {
		path := "/api/v1" + e.Path
		item, ok := paths[path].(map[string]any)
		if !ok {
			item = map[string]any{}
			paths[path] = item
		}
		parameters := []any{}
		for _, part := range strings.Split(e.Path, "/") {
			if strings.HasPrefix(part, "{") {
				name := strings.Trim(part, "{}")
				parameters = append(
					parameters,
					map[string]any{
						"name":        name,
						"in":          "path",
						"required":    true,
						"description": "Validated resource identifier",
						"schema":      map[string]any{"type": "string", "minLength": 1, "maxLength": 200},
					},
				)
			}
		}
		for _, p := range e.Parameters {
			s := map[string]any{"type": p.Type}
			if len(p.Enum) > 0 {
				s["enum"] = p.Enum
			}
			if p.Minimum != nil {
				s["minimum"] = *p.Minimum
			}
			if p.Maximum != nil {
				s["maximum"] = *p.Maximum
			}
			parameters = append(
				parameters,
				map[string]any{
					"name":        p.Name,
					"in":          "query",
					"required":    p.Required,
					"description": p.Description,
					"schema":      s,
				},
			)
		}
		responses := map[string]any{}
		for code, desc := range map[string]string{
			"400": "Malformed request",
			"401": "Authentication required",
			"403": "Insufficient permission",
			"404": "Resource not found",
			"409": "State conflict",
			"422": "Validation failed",
			"429": "Request limit reached",
			"500": "Internal failure",
			"503": "Dependency unavailable",
		} {
			responses[code] = map[string]any{
				"description": desc,
				"content":     map[string]any{"application/json": map[string]any{"schema": errorSchema}},
			}
		}
		if e.Response == nil {
			responses["200"] = map[string]any{
				"description": "SSE stream: connected, snapshot, changed",
				"content":     map[string]any{"text/event-stream": map[string]any{"schema": map[string]any{"type": "string"}}},
			}
		} else {
			responses["200"] = map[string]any{
				"description": "Successful response",
				"content":     map[string]any{"application/json": map[string]any{"schema": schema(reflect.TypeOf(e.Response))}},
			}
		}
		op := map[string]any{
			"operationId": e.ID,
			"summary":     e.Summary,
			"responses":   responses,
			"tags":        []string{strings.Split(strings.TrimPrefix(e.Path, "/"), "/")[0]},
			"parameters":  parameters,
		}
		if e.Public {
			op["security"] = []any{}
		}
		if e.Request != nil {
			op["requestBody"] = map[string]any{
				"required": true,
				"content":  map[string]any{"application/json": map[string]any{"schema": schema(reflect.TypeOf(e.Request))}},
			}
		}
		if e.Method != "GET" && e.ID != "login" {
			parameters = append(
				parameters,
				map[string]any{
					"name":     "X-Spool-Action",
					"in":       "header",
					"required": true,
					"schema":   map[string]any{"type": "string", "enum": []string{"confirmed"}},
				},
			)
			op["parameters"] = parameters
		}
		item[strings.ToLower(e.Method)] = op
	}

	constrain := func(name, field string, rules map[string]any) {
		obj := schemas[name].(map[string]any)
		props := obj["properties"].(map[string]any)
		value := props[field].(map[string]any)
		for k, v := range rules {
			value[k] = v
		}
	}
	for _, name := range []string{"ActionRequest", "BulkRequest", "CloneRequest"} {
		constrain(name, "confirm", map[string]any{"const": true})
	}
	constrain("BulkRequest", "action", map[string]any{"enum": []string{"retry", "archive", "delete"}})
	constrain(
		"BulkRequest",
		"tasks",
		map[string]any{"minItems": 1, "maxItems": 50, "uniqueItems": true},
	)
	for _, name := range []string{"TaskTarget", "CloneRequest"} {
		constrain(
			name,
			"queue",
			map[string]any{"minLength": 1, "maxLength": 200, "pattern": identifier.String()},
		)
	}
	constrain(
		"TaskTarget",
		"id",
		map[string]any{"minLength": 1, "maxLength": 200, "pattern": identifier.String()},
	)
	constrain("CloneRequest", "type", map[string]any{"minLength": 1, "maxLength": 200})
	constrain("CloneRequest", "payload", map[string]any{"maxLength": 256 * 1024})
	constrain("CloneRequest", "max_retry", map[string]any{"minimum": 0, "maximum": 100})
	constrain("ViewRequest", "name", map[string]any{"minLength": 1, "maxLength": 80})
	constrain(
		"ViewRequest",
		"path",
		map[string]any{
			"minLength": 1,
			"maxLength": 2048,
			"pattern":   `^/(tasks|queues|failures|scheduled)(\?.*)?$`,
		},
	)
	constrain("Payload", "encoding", map[string]any{"enum": []string{"json", "utf8", "base64"}})
	constrain("Session", "role", map[string]any{"enum": []string{"admin", "viewer", ""}})
	constrain("Audit", "status", map[string]any{"enum": []string{"pending", "succeeded", "failed"}})
	constrain(
		"Task",
		"actions",
		map[string]any{
			"items": map[string]any{"type": "string", "enum": []string{"retry", "archive", "delete", "cancel", "clone"}},
		},
	)
	doc := map[string]any{
		"openapi": "3.1.0",
		"info": map[string]any{
			"title":       "Spool API",
			"version":     "0.1.0",
			"description": "Asynq operations console. Current-state data is distinct from Prometheus history.",
			"license":     map[string]any{"name": "MIT", "identifier": "MIT"},
		},
		"servers":  []any{map[string]any{"url": "/", "description": "Same-origin Spool server"}},
		"paths":    paths,
		"security": []any{map[string]any{"session": []string{}}},
		"components": map[string]any{
			"schemas":         schemas,
			"securitySchemes": map[string]any{"session": map[string]any{"type": "apiKey", "in": "cookie", "name": "spool_session"}},
		},
	}
	return json.MarshalIndent(doc, "", "  ")
}
