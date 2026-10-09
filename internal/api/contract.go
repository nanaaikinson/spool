package api

import (
	"encoding/json"
	"reflect"
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
}

func q(name, description string) Parameter {
	return Parameter{Name: name, Type: "string", Description: description}
}

func n(name, description string, min, max int) Parameter {
	return Parameter{Name: name, Type: "integer", Description: description, Minimum: &min, Maximum: &max}
}

func Endpoints() []Endpoint {
	return []Endpoint{
		{"GET", "/session", "getSession", "Session and environment", domain.Session{}, nil, nil, true},
		{"POST", "/session", "login", "Sign in", domain.Session{}, domain.LoginRequest{}, nil, true},
		{"DELETE", "/session", "logout", "Sign out", domain.OK{}, domain.ActionRequest{}, nil, false},
		{"GET", "/overview", "getOverview", "Current Asynq overview", domain.Overview{}, nil, nil, false},
		{"GET", "/queues", "listQueues", "List current queues", domain.QueueList{}, nil, nil, false},
		{"GET", "/queues/{queue}", "getQueue", "Inspect a queue", domain.Queue{}, nil, nil, false},
		{
			"POST",
			"/queues/{queue}/pause",
			"pauseQueue",
			"Pause queue processing",
			domain.OK{},
			domain.ActionRequest{},
			nil,
			false,
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
		},
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
					Enum:     []string{"depth", "pending", "active", "retry", "archived", "latency", "processed", "failed"},
				},
				q("queue", "Optional queue scope"),
			},
			false,
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
					Enum:     []string{"depth", "pending", "active", "retry", "archived", "latency", "processed", "failed"},
				},
				q("queue", "Optional queue scope"),
				{Name: "start", Type: "string", Required: true, Description: "RFC3339 start"},
				{Name: "end", Type: "string", Required: true, Description: "RFC3339 end; range no more than 7 days"},
				n("step", "Seconds between points; at most 1500 points", 15, 3600),
			},
			false,
		},
		{
			"GET",
			"/audit",
			"listAudit",
			"Last 100 administrative audit intents",
			domain.AuditList{},
			nil,
			nil,
			false,
		},
		{"GET", "/views", "listViews", "Current actor's saved views", domain.ViewList{}, nil, nil, false},
		{
			"POST",
			"/views",
			"saveView",
			"Save current task or queue view",
			domain.SavedView{},
			domain.ViewRequest{},
			nil,
			false,
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
		},
		{"GET", "/events", "events", "Server-sent query invalidations", nil, nil, nil, false},
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
