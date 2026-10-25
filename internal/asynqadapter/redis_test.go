package asynqadapter

import (
	"context"
	"os"
	"testing"

	"github.com/hibiken/asynq"
)

func TestParseRedisInfo(t *testing.T) {
	info := parseRedisInfo("# Server\r\nredis_version:7.4.1\r\nredis_mode:standalone\r\nuptime_in_seconds:3600\r\n" +
		"# Clients\r\nconnected_clients:4\r\nblocked_clients:1\r\n" +
		"# Memory\r\nused_memory:1048576\r\nused_memory_rss:2097152\r\nused_memory_peak:3145728\r\nmaxmemory:0\r\n" +
		"mem_fragmentation_ratio:2.05\r\nmaxmemory_policy:noeviction\r\n" +
		"# Persistence\r\nrdb_last_bgsave_status:ok\r\naof_enabled:1\r\n" +
		"# Stats\r\ninstantaneous_ops_per_sec:12\r\nkeyspace_hits:90\r\nkeyspace_misses:10\r\nevicted_keys:abc\r\n" +
		"# Replication\r\nrole:master\r\nconnected_slaves:2\r\n")
	if info.Version != "7.4.1" || info.Mode != "standalone" || info.Role != "master" || info.UptimeSeconds != 3600 {
		t.Fatalf("server fields: %+v", info)
	}
	if info.ConnectedClients != 4 || info.BlockedClients != 1 || info.ConnectedReplicas != 2 {
		t.Fatalf("client fields: %+v", info)
	}
	if info.UsedMemoryBytes != 1<<20 || info.UsedMemoryRSSBytes != 2<<20 || info.UsedMemoryPeakBytes != 3<<20 || info.MaxMemoryBytes != 0 {
		t.Fatalf("memory fields: %+v", info)
	}
	if info.MemoryFragmentationRatio != 2.05 || info.EvictionPolicy != "noeviction" || info.OpsPerSecond != 12 {
		t.Fatalf("derived fields: %+v", info)
	}
	if info.KeyspaceHits != 90 || info.KeyspaceMisses != 10 || info.EvictedKeys != 0 || !info.AOFEnabled || !info.LastSaveOK {
		t.Fatalf("stats and persistence: %+v", info)
	}
	if empty := parseRedisInfo(""); empty.Version != "" || empty.UsedMemoryBytes != 0 || empty.LastSaveOK {
		t.Fatalf("missing fields must stay zero: %+v", empty)
	}
}

func TestRealRedisInfo(t *testing.T) {
	address := os.Getenv("SPOOL_TEST_REDIS")
	if address == "" {
		t.Skip("set SPOOL_TEST_REDIS to an isolated test database")
	}
	opt, e := asynq.ParseRedisURI(address)
	if e != nil {
		t.Fatal(e)
	}
	a := New(opt)
	defer a.Close()
	info, e := a.Redis(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	if info.Version == "" || info.UptimeSeconds <= 0 || info.UsedMemoryBytes <= 0 || info.ConnectedClients < 1 || info.CheckedAt.IsZero() {
		t.Fatalf("info: %+v", info)
	}
}
