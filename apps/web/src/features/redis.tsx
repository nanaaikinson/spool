import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { getRedisInfoOptions } from "../api/generated/@tanstack/react-query.gen";
import type { RedisInfo } from "../api/generated/types.gen";
import { DataError, Loading, Stale } from "../components/data-state";
import { InfoTip, RefreshButton } from "../components/info-tip";
import {
  Meter,
  PageHeader,
  Section,
  SectionBody,
  SectionHeader,
  StatTile,
  StatusDot,
  cardColumns,
  statGrid,
} from "../components/page";
import { Time } from "../components/time";
import { bytes, number } from "../lib/utils";
import { clock } from "../lib/time";

const dash = (value?: string) => value || "Unknown";

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y">
      {rows.map(([name, value]) => (
        <div
          key={name}
          className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0"
        >
          <dt className="text-sm text-muted-foreground">{name}</dt>
          <dd className="min-w-0 truncate text-right text-sm tabular-nums">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Panel({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: [string, ReactNode][];
}) {
  return (
    <Section>
      <SectionHeader title={title} description={description} />
      <SectionBody>
        <Rows rows={rows} />
      </SectionBody>
    </Section>
  );
}

function hitRate(info: RedisInfo) {
  const lookups = info.keyspace_hits + info.keyspace_misses;
  return lookups ? info.keyspace_hits / lookups : undefined;
}

export function RedisPage() {
  const query = useQuery({ ...getRedisInfoOptions(), refetchInterval: 10_000 });
  const info = query.data;
  const limited = !!info && info.max_memory_bytes > 0;
  const memoryShare = info
    ? limited
      ? info.used_memory_bytes / info.max_memory_bytes
      : 0
    : 0;
  const rate = info && hitRate(info);
  return (
    <>
      <PageHeader
        title="Redis"
        info={
          <InfoTip label="About Redis information">
            A fixed selection of the Redis INFO output for the connection Spool
            uses to read Asynq. Hostnames, ports, paths and configuration are
            left out. Counters such as commands and hits count from the last
            Redis restart, and Redis Cluster reports one node.
          </InfoTip>
        }
        description="Health, memory and traffic of the Redis server behind your Asynq queues."
        actions={
          <RefreshButton
            onClick={() => query.refetch()}
            pending={query.isFetching}
          />
        }
      />
      {query.isPending ? (
        <Loading />
      ) : query.error && !info ? (
        <DataError error={query.error} retry={() => query.refetch()} />
      ) : (
        info && (
          <>
            <Stale error={query.error} />
            <div className={statGrid({ columns: 6 })}>
              <StatTile
                label="Version"
                value={dash(info.version)}
                detail={`${dash(info.mode)} · ${dash(info.role)}`}
              />
              <StatTile
                label="Uptime"
                value={clock(info.uptime_seconds * 1000)}
              />
              <StatTile
                label="Memory used"
                value={bytes(info.used_memory_bytes)}
                detail={
                  limited
                    ? `of ${bytes(info.max_memory_bytes)} limit`
                    : "No memory limit"
                }
              >
                {limited && (
                  <Meter
                    value={memoryShare}
                    tone={
                      memoryShare > 0.9
                        ? "red"
                        : memoryShare > 0.75
                          ? "amber"
                          : "green"
                    }
                  />
                )}
              </StatTile>
              <StatTile
                label="Clients"
                value={number(info.connected_clients)}
                detail={`${number(info.blocked_clients)} blocked`}
              />
              <StatTile label="Keys" value={number(info.keys)} />
              <StatTile
                label="Commands / sec"
                value={number(info.ops_per_second)}
              />
            </div>
            <div className={cardColumns({ layout: "even" })}>
              <Panel
                title="Memory"
                description="What Redis holds and what the operating system gives it."
                rows={[
                  ["Used", bytes(info.used_memory_bytes)],
                  ["Peak", bytes(info.used_memory_peak_bytes)],
                  ["Resident set", bytes(info.used_memory_rss_bytes)],
                  [
                    "Fragmentation ratio",
                    info.memory_fragmentation_ratio
                      ? number(info.memory_fragmentation_ratio)
                      : "Unknown",
                  ],
                  ["Limit", limited ? bytes(info.max_memory_bytes) : "None"],
                  ["Eviction policy", dash(info.eviction_policy)],
                ]}
              />
              <Panel
                title="Traffic"
                description="Counted since Redis last started."
                rows={[
                  ["Commands processed", number(info.total_commands)],
                  ["Connections received", number(info.total_connections)],
                  ["Connections rejected", number(info.rejected_connections)],
                  [
                    "Keyspace hit rate",
                    rate === undefined
                      ? "No lookups yet"
                      : `${number(rate * 100)}%`,
                  ],
                  ["Expired keys", number(info.expired_keys)],
                  ["Evicted keys", number(info.evicted_keys)],
                ]}
              />
              <Panel
                title="Persistence and replication"
                description="Whether data survives a restart, and who copies it."
                rows={[
                  [
                    "Last snapshot",
                    <span key="save" className="inline-flex items-center gap-2">
                      <StatusDot tone={info.last_save_ok ? "green" : "amber"} />
                      {info.last_save_ok ? "Succeeded" : "Failed or none yet"}
                    </span>,
                  ],
                  ["Append-only file", info.aof_enabled ? "On" : "Off"],
                  ["Role", dash(info.role)],
                  ["Connected replicas", number(info.connected_replicas)],
                ]}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Checked <Time value={info.checked_at} />
            </p>
          </>
        )
      )}
    </>
  );
}
