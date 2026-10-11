package store

import (
	"context"
	"slices"
	"strings"
	"time"
	"unicode"

	"github.com/nanaaikinson/spool/internal/domain"
	"github.com/uptrace/bun"
)

// LogLimit caps stored log lines between retention runs, in case something
// logs far more than usual.
const LogLimit = 100_000

type logModel struct {
	bun.BaseModel `bun:"table:logs"`
	ID            int64            `bun:"id,pk,autoincrement"`
	Time          int64            `bun:"time"` // Unix microseconds
	Level         string           `bun:"level"`
	Message       string           `bun:"message"`
	Caller        string           `bun:"caller"`
	Attrs         []domain.LogAttr `bun:"attrs,type:text"`
}

func (m logModel) entry() domain.ServerLog {
	attrs := m.Attrs
	if attrs == nil {
		attrs = []domain.LogAttr{}
	}
	return domain.ServerLog{
		ID:      m.ID,
		Time:    time.UnixMicro(m.Time).UTC(),
		Level:   m.Level,
		Message: m.Message,
		Caller:  m.Caller,
		Attrs:   attrs,
	}
}

// RecordServerLogs appends log records, then drops all but the newest
// LogLimit. PruneServerLogs removes old records.
func (s *Store) RecordServerLogs(ctx context.Context, entries []domain.ServerLog) error {
	if s == nil {
		return ErrUnavailable
	}
	if len(entries) == 0 {
		return nil
	}
	rows := make([]logModel, 0, len(entries))
	for _, e := range entries {
		rows = append(rows, logModel{Time: e.Time.UnixMicro(), Level: e.Level, Message: e.Message, Caller: e.Caller, Attrs: e.Attrs})
	}
	return s.DB.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, e := tx.NewInsert().Model(&rows).Exec(ctx); e != nil {
			return e
		}
		_, e := tx.NewDelete().
			Model((*logModel)(nil)).
			Where("id <= (SELECT max(id) FROM logs) - ?", LogLimit).
			Exec(ctx)
		return e
	})
}

// PruneServerLogs deletes records logged before the cutoff and reports how
// many it removed.
func (s *Store) PruneServerLogs(ctx context.Context, before time.Time) (int64, error) {
	if s == nil {
		return 0, ErrUnavailable
	}
	res, e := s.DB.NewDelete().Model((*logModel)(nil)).Where("time < ?", before.UnixMicro()).Exec(ctx)
	if e != nil {
		return 0, e
	}
	return res.RowsAffected()
}

// LogQuery selects log records. Search uses the syntax described at
// ParseLogSearch. Start and End bound the time range (end exclusive).
type LogQuery struct {
	Search     string
	Start, End time.Time
}

// LogCursor picks where a page of log records starts. Before and After are
// record IDs; At is a time. At most one is set; none means the newest.
type LogCursor struct {
	Before, After int64
	At            time.Time
}

// ServerLogs returns up to limit matching records, newest first: the newest
// ones, those older than Before or logged before At, or the oldest ones newer
// than After. HasMore and HasNewer say whether matching records lie beyond
// the page in either direction.
func (s *Store) ServerLogs(ctx context.Context, q LogQuery, c LogCursor, limit int) (domain.ServerLogList, error) {
	out := domain.ServerLogList{Data: []domain.ServerLog{}, Limit: limit}
	if s == nil {
		return out, ErrUnavailable
	}
	var rows []logModel
	sel := s.DB.NewSelect().Model(&rows).Limit(limit)
	q.apply(sel)
	switch {
	case c.After > 0:
		sel.Where("id > ?", c.After).OrderExpr("id")
	case c.Before > 0:
		sel.Where("id < ?", c.Before).OrderExpr("id DESC")
	case !c.At.IsZero():
		sel.Where("time < ?", c.At.UnixMicro()).OrderExpr("id DESC")
	default:
		sel.OrderExpr("id DESC")
	}
	if e := sel.Scan(ctx); e != nil {
		return out, e
	}
	if c.After > 0 {
		slices.Reverse(rows)
	}
	for _, r := range rows {
		out.Data = append(out.Data, r.entry())
	}
	newest, oldest := c.After, c.Before
	if len(rows) > 0 {
		newest, oldest = rows[0].ID, rows[len(rows)-1].ID
	}
	var e error
	if out.HasMore, e = s.logsBeyond(ctx, q, "id < ?", oldest, len(rows) == 0 && c.After == 0); e != nil {
		return out, e
	}
	// An At page with no rows may still have newer records at or after At.
	if newest == 0 && !c.At.IsZero() {
		out.HasNewer, e = s.logsBeyond(ctx, q, "time >= ?", c.At.UnixMicro(), false)
		return out, e
	}
	out.HasNewer, e = s.logsBeyond(ctx, q, "id > ?", newest, newest == 0)
	return out, e
}

// logsBeyond reports whether a matching record satisfies cond. none short-
// circuits to false when the page is empty and nothing lies past it.
func (s *Store) logsBeyond(ctx context.Context, q LogQuery, cond string, arg int64, none bool) (bool, error) {
	if none {
		return false, nil
	}
	sel := s.DB.NewSelect().Model((*logModel)(nil)).Where(cond, arg)
	q.apply(sel)
	return sel.Exists(ctx)
}

// LogsAround returns the records logged just before and after id, newest
// first, regardless of any search.
func (s *Store) LogsAround(ctx context.Context, id int64, each int) (domain.ServerLogList, error) {
	out := domain.ServerLogList{Data: []domain.ServerLog{}, Limit: 2*each + 1}
	if s == nil {
		return out, ErrUnavailable
	}
	var newer, older []logModel
	if e := s.DB.NewSelect().Model(&newer).Where("id > ?", id).OrderExpr("id").Limit(each).Scan(ctx); e != nil {
		return out, e
	}
	if e := s.DB.NewSelect().Model(&older).Where("id <= ?", id).OrderExpr("id DESC").Limit(each + 1).Scan(ctx); e != nil {
		return out, e
	}
	for i := len(newer) - 1; i >= 0; i-- {
		out.Data = append(out.Data, newer[i].entry())
	}
	for _, r := range older {
		out.Data = append(out.Data, r.entry())
	}
	return out, nil
}

// LogHistogram counts matching records per level in buckets of step.
func (s *Store) LogHistogram(ctx context.Context, q LogQuery, step time.Duration) (domain.LogHistogram, error) {
	out := domain.LogHistogram{Buckets: []domain.LogBucket{}, Start: q.Start.UTC(), End: q.End.UTC(), StepSeconds: int(step / time.Second)}
	if s == nil {
		return out, ErrUnavailable
	}
	us := step.Microseconds()
	var rows []struct {
		Bucket int64  `bun:"bucket"`
		Level  string `bun:"level"`
		Count  int    `bun:"count"`
	}
	sel := s.DB.NewSelect().
		Model((*logModel)(nil)).
		ColumnExpr("time / ? AS bucket, level, count(*) AS count", us).
		GroupExpr("bucket, level")
	q.apply(sel)
	if e := sel.Scan(ctx, &rows); e != nil {
		return out, e
	}
	first := q.Start.UnixMicro() / us
	n := int((q.End.UnixMicro()-1)/us - first + 1)
	if n < 1 {
		return out, nil
	}
	out.Buckets = make([]domain.LogBucket, n)
	for i := range out.Buckets {
		out.Buckets[i].Start = time.UnixMicro((first + int64(i)) * us).UTC()
	}
	for _, r := range rows {
		i := int(r.Bucket - first)
		if i < 0 || i >= n {
			continue
		}
		b := &out.Buckets[i]
		switch r.Level {
		case "ERROR":
			b.Error += r.Count
		case "WARN":
			b.Warn += r.Count
		case "INFO":
			b.Info += r.Count
		default:
			b.Debug += r.Count
		}
		out.Total += r.Count
	}
	return out, nil
}

func (q LogQuery) apply(sel *bun.SelectQuery) {
	sel.Where("time >= ? AND time < ?", q.Start.UnixMicro(), q.End.UnixMicro())
	terms := ParseLogSearch(q.Search)
	// Repeated fields match any of their values; everything else must match.
	fields := map[string][]LogTerm{}
	var order []string
	for _, t := range terms {
		if t.Field == "" || t.Negate {
			sel.Where(t.sql(), t.args()...)
			continue
		}
		if _, ok := fields[t.Field]; !ok {
			order = append(order, t.Field)
		}
		fields[t.Field] = append(fields[t.Field], t)
	}
	for _, f := range order {
		sel.WhereGroup(" AND ", func(g *bun.SelectQuery) *bun.SelectQuery {
			for _, t := range fields[f] {
				g.WhereOr(t.sql(), t.args()...)
			}
			return g
		})
	}
}

// LogTerm is one search token: free text, or field:value. Negate excludes
// matches.
type LogTerm struct {
	Field  string
	Value  string
	Negate bool
}

// ParseLogSearch splits a search into terms. Free text matches the message,
// caller or attributes; field:value matches level, message, caller or an
// attribute key, where * is a wildcard; -term excludes; "quoted text" keeps
// spaces. Matching ignores case.
func ParseLogSearch(s string) []LogTerm {
	var out []LogTerm
	rs := []rune(s)
	for i := 0; i < len(rs); {
		if unicode.IsSpace(rs[i]) {
			i++
			continue
		}
		t := LogTerm{}
		if rs[i] == '-' && i+1 < len(rs) && !unicode.IsSpace(rs[i+1]) {
			t.Negate = true
			i++
		}
		word, next := readWord(rs, i)
		i = next
		if k := strings.IndexByte(word, ':'); k > 0 && !strings.HasPrefix(word, `"`) {
			t.Field = strings.ToLower(word[:k])
			word = word[k+1:]
			if word == "" && i < len(rs) && rs[i] == '"' {
				word, i = readWord(rs, i)
			}
		}
		t.Value = strings.Trim(word, `"`)
		if t.Value != "" {
			out = append(out, t)
		}
	}
	return out
}

// readWord reads up to the next unquoted space.
func readWord(rs []rune, i int) (string, int) {
	var b strings.Builder
	quoted := false
	for ; i < len(rs); i++ {
		r := rs[i]
		if r == '"' {
			quoted = !quoted
		}
		if unicode.IsSpace(r) && !quoted {
			break
		}
		b.WriteRune(r)
	}
	return b.String(), i
}

func (t LogTerm) sql() string {
	var cond string
	switch t.Field {
	case "":
		cond = `(message LIKE ? ESCAPE '\' OR caller LIKE ? ESCAPE '\' OR EXISTS (SELECT 1 FROM json_each(attrs) WHERE json_extract(value, '$.value') LIKE ? ESCAPE '\'))`
	case "level":
		cond = "level = ?"
	case "message", "caller":
		cond = t.Field + ` LIKE ? ESCAPE '\'`
	default:
		cond = `EXISTS (SELECT 1 FROM json_each(attrs) WHERE lower(json_extract(value, '$.key')) = ? AND json_extract(value, '$.value') LIKE ? ESCAPE '\')`
	}
	if t.Negate {
		return "NOT " + cond
	}
	return cond
}

func (t LogTerm) args() []any {
	switch t.Field {
	case "":
		p := "%" + like(t.Value) + "%"
		return []any{p, p, p}
	case "level":
		v := strings.ToUpper(t.Value)
		if v == "WARNING" {
			v = "WARN"
		}
		return []any{v}
	case "message", "caller":
		return []any{pattern(t.Value)}
	default:
		return []any{t.Field, pattern(t.Value)}
	}
}

// pattern turns a field value into a LIKE pattern: * is any text.
func pattern(v string) string { return strings.ReplaceAll(like(v), "*", "%") }

func like(v string) string {
	return strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(v)
}
