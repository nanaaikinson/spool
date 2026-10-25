import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  getRedisClusterOptions,
  getRedisInfoOptions,
  getRedisRawInfoOptions,
} from "../api/generated/@tanstack/react-query.gen";
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
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { useSession } from "./session";
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

/** Where each queue lives when Redis runs as a cluster. Shown to the administrator only. */
function ClusterQueues() {
  const cluster = useQuery(getRedisClusterOptions());
  if (!cluster.data?.enabled) return null;
  return (
    <Section>
      <SectionHeader
        title="Cluster placement"
        description="Each queue hashes to one slot, which one node serves."
      />
      {!cluster.data.queues.length ? (
        <SectionBody className="text-sm text-muted-foreground">
          No Asynq queues yet.
        </SectionBody>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Queue</TableHead>
              <TableHead>Key slot</TableHead>
              <TableHead>Nodes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cluster.data.queues.map((q) => (
              <TableRow key={q.queue}>
                <TableCell className="font-mono">{q.queue}</TableCell>
                <TableCell className="tabular-nums">{q.key_slot}</TableCell>
                <TableCell className="font-mono text-xs">
                  {q.nodes.map((n) => (
                    <div key={n.id} title={n.id}>
                      {n.address}
                      <span className="ml-2 text-muted-foreground">
                        {n.id.slice(0, 8)}
                      </span>
                    </div>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

/** The full INFO output, including ports and paths. Shown to the administrator only. */
function RawInfo() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const raw = useQuery({ ...getRedisRawInfoOptions(), enabled: open });
  const needle = filter.trim().toLowerCase();
  const sections = (raw.data?.sections ?? [])
    .map((section) => ({
      ...section,
      fields: section.fields.filter(
        (f) =>
          !needle ||
          f.key.toLowerCase().includes(needle) ||
          f.value.toLowerCase().includes(needle),
      ),
    }))
    .filter((section) => section.fields.length);
  return (
    <Section>
      <SectionHeader
        title="Raw INFO"
        description="Everything Redis reports, including ports and file paths."
        action={
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Hide" : "Show"}
          </Button>
        }
      />
      {open && (
        <SectionBody>
          {raw.isPending ? (
            <Loading rows={4} />
          ) : raw.error ? (
            <DataError error={raw.error} retry={() => raw.refetch()} />
          ) : (
            <>
              <Input
                aria-label="Filter INFO fields"
                placeholder="Filter by name or value"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="mb-4 max-w-sm"
              />
              {!sections.length ? (
                <p className="text-sm text-muted-foreground">
                  No fields match.
                </p>
              ) : (
                sections.map((section) => (
                  <div key={section.name} className="mb-4 last:mb-0">
                    <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {section.name}
                    </h3>
                    <Rows
                      rows={section.fields.map((f) => [
                        f.key,
                        <span key={f.key} className="font-mono text-xs">
                          {f.value}
                        </span>,
                      ])}
                    />
                  </div>
                ))
              )}
            </>
          )}
        </SectionBody>
      )}
    </Section>
  );
}

export function RedisPage() {
  const session = useSession();
  // The administrator is the account that may also read server logs.
  const admin = !!session.data?.server_logs;
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
            {admin && (
              <>
                <ClusterQueues />
                <RawInfo />
              </>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Checked <Time value={info.checked_at} />
            </p>
          </>
        )
      )}
    </>
  );
}
