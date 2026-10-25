package asynqadapter

import (
	"bufio"
	"context"
	"errors"
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
