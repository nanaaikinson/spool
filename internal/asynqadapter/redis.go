package asynqadapter

import (
	"bufio"
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/nanaaikinson/spool/internal/domain"
)

// Redis reads a fixed selection of the server's INFO fields. The Inspector has
// no equivalent, so it uses its own connection built from the same options.
func (a *Adapter) Redis(ctx context.Context) (domain.RedisInfo, error) {
	if a.redis == nil {
		return domain.RedisInfo{}, errors.New("redis client unavailable")
	}
	raw, e := a.redis.Info(ctx).Result()
	if e != nil {
		return domain.RedisInfo{}, e
	}
	keys, e := a.redis.DBSize(ctx).Result()
	if e != nil {
		return domain.RedisInfo{}, e
	}
	out := parseRedisInfo(raw)
	out.Keys = keys
	return out, nil
}

// parseRedisInfo maps INFO's "name:value" lines onto the fields Spool shows.
// Missing or malformed fields stay zero, since managed services hide some.
func parseRedisInfo(raw string) domain.RedisInfo {
	fields := map[string]string{}
	sc := bufio.NewScanner(strings.NewReader(raw))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if name, value, ok := strings.Cut(line, ":"); ok && !strings.HasPrefix(line, "#") {
			fields[name] = value
		}
	}
	whole := func(name string) int64 {
		v, _ := strconv.ParseInt(fields[name], 10, 64)
		return v
	}
	ratio, _ := strconv.ParseFloat(fields["mem_fragmentation_ratio"], 64)
	return domain.RedisInfo{
		Version:                  fields["redis_version"],
		Mode:                     fields["redis_mode"],
		Role:                     fields["role"],
		UptimeSeconds:            whole("uptime_in_seconds"),
		ConnectedClients:         int(whole("connected_clients")),
		BlockedClients:           int(whole("blocked_clients")),
		ConnectedReplicas:        int(whole("connected_slaves")),
		UsedMemoryBytes:          whole("used_memory"),
		UsedMemoryRSSBytes:       whole("used_memory_rss"),
		UsedMemoryPeakBytes:      whole("used_memory_peak"),
		MaxMemoryBytes:           whole("maxmemory"),
		MemoryFragmentationRatio: ratio,
		EvictionPolicy:           fields["maxmemory_policy"],
		OpsPerSecond:             whole("instantaneous_ops_per_sec"),
		TotalCommands:            whole("total_commands_processed"),
		TotalConnections:         whole("total_connections_received"),
		KeyspaceHits:             whole("keyspace_hits"),
		KeyspaceMisses:           whole("keyspace_misses"),
		ExpiredKeys:              whole("expired_keys"),
		EvictedKeys:              whole("evicted_keys"),
		RejectedConnections:      whole("rejected_connections"),
		AOFEnabled:               fields["aof_enabled"] == "1",
		LastSaveOK:               fields["rdb_last_bgsave_status"] == "ok",
		CheckedAt:                time.Now().UTC(),
	}
}

// RedisCluster lists, for each queue, the hash slot and nodes that hold it. A
// standalone or sentinel deployment reports Enabled false and no queues.
func (a *Adapter) RedisCluster(ctx context.Context) (domain.RedisCluster, error) {
	out := domain.RedisCluster{Queues: []domain.RedisClusterQueue{}}
	if a.redis == nil {
		return out, errors.New("redis client unavailable")
	}
	server, e := a.redis.Info(ctx, "server").Result()
	if e != nil {
		return out, e
	}
	if parseRedisInfo(server).Mode != "cluster" {
		return out, nil
	}
	out.Enabled = true
	names, e := a.inspector.Queues()
	if e != nil {
		return out, e
	}
	sort.Strings(names)
	for _, name := range names {
		if e := ctx.Err(); e != nil {
			return out, e
		}
		slot, e := a.inspector.ClusterKeySlot(name)
		if e != nil {
			return out, e
		}
		nodes, e := a.inspector.ClusterNodes(name)
		if e != nil {
			return out, e
		}
		q := domain.RedisClusterQueue{Queue: name, KeySlot: slot, Nodes: []domain.RedisClusterNode{}}
		for _, n := range nodes {
			q.Nodes = append(q.Nodes, domain.RedisClusterNode{ID: n.ID, Address: n.Addr})
		}
		out.Queues = append(out.Queues, q)
	}
	return out, nil
}

// RedisRaw returns the INFO output as sections of name and value pairs.
func (a *Adapter) RedisRaw(ctx context.Context) (domain.RedisRawInfo, error) {
	if a.redis == nil {
		return domain.RedisRawInfo{}, errors.New("redis client unavailable")
	}
	raw, e := a.redis.Info(ctx).Result()
	if e != nil {
		return domain.RedisRawInfo{}, e
	}
	out := domain.RedisRawInfo{Sections: []domain.RedisInfoSection{}, CheckedAt: time.Now().UTC()}
	sc := bufio.NewScanner(strings.NewReader(raw))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		switch {
		case line == "":
		case strings.HasPrefix(line, "#"):
			out.Sections = append(out.Sections, domain.RedisInfoSection{
				Name:   strings.TrimSpace(strings.TrimPrefix(line, "#")),
				Fields: []domain.RedisInfoField{},
			})
		default:
			key, value, ok := strings.Cut(line, ":")
			if !ok {
				continue
			}
			if len(out.Sections) == 0 {
				out.Sections = append(out.Sections, domain.RedisInfoSection{Name: "General", Fields: []domain.RedisInfoField{}})
			}
			last := &out.Sections[len(out.Sections)-1]
			last.Fields = append(last.Fields, domain.RedisInfoField{Key: key, Value: value})
		}
	}
	return out, nil
}
