package asynqadapter

import (
	"context"
	"crypto/sha256"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/hibiken/asynq"
	"github.com/nanaaikinson/spool/internal/domain"
)

// Normalization strips per-task noise (IDs, timestamps, addresses, long numbers)
// while keeping details that distinguish failures, such as HTTP status codes.
var (
	timePattern   = regexp.MustCompile(`\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?`)
	uuidPattern   = regexp.MustCompile(`(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`)
	addrPattern   = regexp.MustCompile(`\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b`)
	hexPattern    = regexp.MustCompile(`(?i)\b(0x)?[0-9a-f]{8,}\b`)
	quotedPattern = regexp.MustCompile(`"[^"]*"|'[^']*'`)
	numberPattern = regexp.MustCompile(`\b\d{4,}\b`)
	spacePattern  = regexp.MustCompile(`\s+`)
)

const maxPatternRunes = 240

// NormalizeError reduces an error message to a pattern shared by similar failures.
func NormalizeError(message string) string {
	s := strings.TrimSpace(message)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	if s == "" {
		return "(no error recorded)"
	}
	s = timePattern.ReplaceAllString(s, "<time>")
	s = uuidPattern.ReplaceAllString(s, "<id>")
	s = addrPattern.ReplaceAllString(s, "<addr>")
	s = hexPattern.ReplaceAllStringFunc(s, func(m string) string {
		// Long hex runs with a digit are identifiers; all-letter runs are words.
		if strings.ContainsAny(m, "0123456789") {
			return "<hex>"
		}
		return m
	})
	s = quotedPattern.ReplaceAllString(s, `"…"`)
	s = numberPattern.ReplaceAllString(s, "<n>")
	s = spacePattern.ReplaceAllString(s, " ")
	return truncateRunes(s, maxPatternRunes)
}

func truncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n]) + "…"
}

// ErrorGroups samples the newest retained failures and groups them. It reads a
// bounded number of tasks per queue and state; it never scans whole queues.
func (a *Adapter) ErrorGroups(ctx context.Context, queue string, sample int) (domain.ErrorGroupList, error) {
	out := domain.ErrorGroupList{Data: []domain.ErrorGroup{}}
	queues, e := a.Queues(ctx)
	if e != nil {
		return out, e
	}
	buckets := []bucket{}
	for _, q := range queues {
		if queue != "" && q.Name != queue {
			continue
		}
		for _, b := range []bucket{{q.Name, "retry", q.Retry}, {q.Name, "archived", q.Archived}} {
			if b.count > 0 {
				buckets = append(buckets, b)
				out.Total += b.count
			}
		}
	}
	if len(buckets) > 256 {
		return out, fmt.Errorf("queue limit exceeded; scope your connection")
	}
	if len(buckets) == 0 {
		return out, nil
	}
	shares := allocate(buckets, sample)
	var tasks []domain.TaskSummary
	for i, b := range buckets {
		if e := ctx.Err(); e != nil {
			return out, e
		}
		ts, e := a.newestFailures(b, shares[i])
		if e != nil {
			return out, e
		}
		tasks = append(tasks, ts...)
	}
	out.Sampled = len(tasks)
	out.Data = groupFailures(tasks)
	return out, nil
}

// newestFailures returns up to n of the most recently failed tasks in a bucket.
// Archived tasks are scored by archive time in ascending order, so the newest
// sit on the last page; retry tasks are scored by next attempt instead.
func (a *Adapter) newestFailures(b bucket, n int) ([]domain.TaskSummary, error) {
	list := a.inspector.ListRetryTasks
	page := 1
	if b.state == "archived" {
		list = a.inspector.ListArchivedTasks
		page = (b.count + n - 1) / n
	}
	read := func(p int) ([]*asynq.TaskInfo, error) {
		ts, e := list(b.queue, asynq.PageSize(n), asynq.Page(p))
		if e != nil && mapError(e) == ErrNotFound {
			return nil, nil
		}
		return ts, e
	}
	ts, e := read(page)
	if e != nil {
		return nil, e
	}
	// The last page may be short (or empty if the queue shrank); top up from the one before.
	if len(ts) < n && page > 1 {
		before, e := read(page - 1)
		if e != nil {
			return nil, e
		}
		ts = append(before, ts...)
		if len(ts) > n {
			ts = ts[len(ts)-n:]
		}
	}
	out := make([]domain.TaskSummary, 0, len(ts))
	for _, t := range ts {
		out = append(out, summary(t))
	}
	return out, nil
}

func groupFailures(tasks []domain.TaskSummary) []domain.ErrorGroup {
	groups := map[string]*domain.ErrorGroup{}
	queues := map[string]map[string]bool{}
	for _, t := range tasks {
		pattern := NormalizeError(t.LastError)
		key := t.Type + "\x00" + pattern
		g, ok := groups[key]
		if !ok {
			g = &domain.ErrorGroup{
				Signature: fmt.Sprintf("%x", sha256.Sum256([]byte(key)))[:16],
				Type:      t.Type,
				Pattern:   pattern,
			}
			groups[key] = g
			queues[key] = map[string]bool{}
		}
		g.Count++
		if t.State == domain.Retry {
			g.Retry++
		} else {
			g.Archived++
		}
		queues[key][t.Queue] = true
		if t.LastFailedAt != nil {
			if g.FirstSeen == nil || t.LastFailedAt.Before(*g.FirstSeen) {
				g.FirstSeen = t.LastFailedAt
			}
			if g.LastSeen == nil || t.LastFailedAt.After(*g.LastSeen) {
				g.LastSeen = t.LastFailedAt
				g.Error = firstLine(t.LastError)
				g.Sample = domain.TaskTarget{Queue: t.Queue, ID: t.ID}
			}
		}
		if g.Sample.ID == "" {
			g.Error = firstLine(t.LastError)
			g.Sample = domain.TaskTarget{Queue: t.Queue, ID: t.ID}
		}
	}
	out := make([]domain.ErrorGroup, 0, len(groups))
	for key, g := range groups {
		for q := range queues[key] {
			g.Queues = append(g.Queues, q)
		}
		sort.Strings(g.Queues)
		out = append(out, *g)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Signature < out[j].Signature
	})
	if len(out) > 50 {
		out = out[:50]
	}
	return out
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return truncateRunes(s, 500)
}

// allocate splits the sample across buckets so small buckets take only what they
// hold and the remainder goes to larger ones, with at least one task each.
func allocate(buckets []bucket, sample int) []int {
	order := make([]int, len(buckets))
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(a, b int) bool { return buckets[order[a]].count < buckets[order[b]].count })
	shares := make([]int, len(buckets))
	remaining := sample
	for k, i := range order {
		share := max(1, remaining/(len(order)-k))
		shares[i] = min(buckets[i].count, share)
		remaining = max(0, remaining-shares[i])
	}
	return shares
}
