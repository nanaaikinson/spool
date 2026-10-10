import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { useId, useMemo, useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  metricsHealthOptions,
  queryMetricOptions,
  queryMetricRangeOptions,
} from "../api/generated/@tanstack/react-query.gen";
import type { QueryMetricRangeData } from "../api/generated/types.gen";
import { DataError, Empty, Loading } from "../components/data-state";
import {
  Section,
  SectionBody,
  SectionHeader,
  StatTile,
  StatusDot,
  statGrid,
} from "../components/page";
import { duration, number } from "../lib/utils";
/** Matches the usual Prometheus scrape interval; faster polling only repeats samples. */
export const LIVE_REFRESH_MS = 15_000;
const spans = {
  "15m": 900,
  "1h": 3600,
  "6h": 21600,
  "24h": 86400,
  "7d": 604800,
};
const colors = [
  "var(--green)",
  "var(--purple)",
  "var(--amber)",
  "var(--red)",
  "var(--primary)",
];
export function TimeRange() {
  const id = useId();
  const search = useSearch({ from: "__root__" });
  const navigate = useNavigate();
  const labels = {
    "15m": "Last 15 minutes",
    "1h": "Last hour",
    "6h": "Last 6 hours",
    "24h": "Last 24 hours",
    "7d": "Last 7 days",
  };
  return (
    <div>
      <Label className="sr-only" htmlFor={id}>
        Historical time range
      </Label>
      <Select
        value={search.range}
        onValueChange={(value) =>
          navigate({
            to: ".",
            search: (old) => ({
              ...old,
              range: value in spans ? (value as keyof typeof spans) : "1h",
            }),
          })
        }
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose a time range" />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(labels).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
type Metric = NonNullable<QueryMetricRangeData["query"]>["metric"];
export function HistoricalChart({
  metric,
  title,
  description,
  queue,
  live = false,
}: {
  metric: Metric;
  title: string;
  description?: string;
  queue?: string;
  live?: boolean;
}) {
  const search = useSearch({ from: "__root__" });
  const health = useQuery({ ...metricsHealthOptions(), staleTime: 60_000 });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) setNow(Date.now());
    };
    if (live) refresh();
    const ticker = setInterval(refresh, live ? LIVE_REFRESH_MS : 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(ticker);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [live]);
  const interval = spans[search.range];
  const window = useMemo(() => {
    const end = new Date(now);
    return {
      end: end.toISOString(),
      start: new Date(end.getTime() - interval * 1000).toISOString(),
      step: Math.max(15, Math.ceil(interval / 240)),
    };
  }, [interval, now]);
  const query = useQuery({
    ...queryMetricRangeOptions({ query: { metric, queue, ...window } }),
    enabled: health.data?.available === true,
    staleTime: 30_000,
    // Keep the previous window on screen while the next one loads.
    placeholderData: keepPreviousData,
  });
  const chartData = useMemo(() => {
    const rows = new Map<string, Record<string, string | number>>();
    for (const [index, s] of (query.data?.data ?? []).entries()) {
      for (const p of s.points) {
        const row = rows.get(p.time) ?? { time: p.time };
        row[`series_${index}`] = p.value;
        rows.set(p.time, row);
      }
    }
    return [...rows.values()].sort((a, b) =>
      String(a.time).localeCompare(String(b.time)),
    );
  }, [query.data]);
  return (
    <Section>
      <SectionHeader
        className="items-start"
        title={title}
        description={description}
        action={
          <span className="inline-flex flex-none items-center gap-[7px] text-xs whitespace-nowrap text-muted-foreground">
            {live && <StatusDot tone="green" pulse />}
            Prometheus · {query.data?.unit ?? "history"}
          </span>
        }
      />
      {health.error ? (
        <SectionBody>
          <DataError error={health.error} retry={() => health.refetch()} />
        </SectionBody>
      ) : health.isPending ? (
        <Loading rows={2} />
      ) : !health.data?.available ? (
        <Empty
          title={
            health.data?.configured
              ? "Can’t reach Prometheus"
              : "Prometheus isn’t configured"
          }
        >
          {health.data?.message} Current queue figures don’t depend on it.
        </Empty>
      ) : query.isPending ? (
        <Loading rows={3} />
      ) : query.error ? (
        <SectionBody>
          <DataError error={query.error} retry={() => query.refetch()} />
        </SectionBody>
      ) : !chartData.length ? (
        <Empty title="No samples in this range">
          Check that Prometheus is scraping Spool’s /metrics endpoint, or choose
          a longer time range.
        </Empty>
      ) : (
        <>
          <div className="h-[220px] px-2 pt-4 pb-1 md:h-[250px] md:px-3">
            <ChartContainer
              className="h-full w-full aspect-auto"
              config={Object.fromEntries(
                (query.data?.data ?? []).map((series, index) => [
                  `series_${index}`,
                  { label: series.queue, color: colors[index % colors.length] },
                ]),
              )}
            >
              <LineChart
                data={chartData}
                margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
              >
                <CartesianGrid
                  stroke="var(--grid)"
                  strokeDasharray="3 4"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  tickFormatter={(value) =>
                    new Date(String(value)).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  }
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  minTickGap={45}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={number}
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  width={45}
                  axisLine={false}
                  tickLine={false}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) =>
                        new Date(
                          String(payload[0]?.payload?.time),
                        ).toLocaleString()
                      }
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                {query.data?.data.map((s, i) => (
                  <Line
                    key={s.queue}
                    dataKey={`series_${i}`}
                    name={s.queue}
                    stroke={colors[i % colors.length]}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ChartContainer>
          </div>
        </>
      )}
    </Section>
  );
}

const readings: {
  metric: Metric;
  label: string;
  combine: "sum" | "max";
  format: (value: number) => string;
}[] = [
  { metric: "depth", label: "Queue depth", combine: "sum", format: number },
  {
    metric: "latency",
    label: "Oldest wait",
    combine: "max",
    format: (v) => duration(v),
  },
  {
    metric: "processed",
    label: "Throughput",
    combine: "sum",
    format: (v) => `${number(v)}/s`,
  },
  {
    metric: "failed",
    label: "Failure rate",
    combine: "sum",
    format: (v) => `${number(v)}/s`,
  },
  { metric: "retry", label: "Awaiting retry", combine: "sum", format: number },
  { metric: "archived", label: "Archived", combine: "sum", format: number },
];
function Reading({
  metric,
  label,
  combine,
  format,
  live,
}: (typeof readings)[number] & { live: boolean }) {
  const query = useQuery({
    ...queryMetricOptions({ query: { metric } }),
    refetchInterval: live ? LIVE_REFRESH_MS : false,
    placeholderData: keepPreviousData,
  });
  const values = (query.data?.data ?? []).flatMap((s) =>
    s.points.length ? [s.points[s.points.length - 1].value] : [],
  );
  const value = values.length
    ? combine === "max"
      ? Math.max(...values)
      : values.reduce((a, b) => a + b, 0)
    : undefined;
  return (
    <StatTile
      label={label}
      value={value === undefined ? "—" : format(value)}
      detail={
        query.error
          ? "Unavailable"
          : `${combine === "max" ? "Highest of" : "Across"} ${values.length} ${values.length === 1 ? "queue" : "queues"}`
      }
    />
  );
}
/** Current value of each charted signal, from Prometheus instant queries. */
export function LiveReadings({ live }: { live: boolean }) {
  const health = useQuery({ ...metricsHealthOptions(), staleTime: 60_000 });
  if (!health.data?.available) return null;
  return (
    <div className={statGrid({ columns: 6 })}>
      {readings.map((r) => (
        <Reading key={r.metric} {...r} live={live} />
      ))}
    </div>
  );
}
/** Per-queue samples of one metric over the last hour, keyed by queue name. */
export function useQueueTrends(metric: Metric) {
  const health = useQuery({ ...metricsHealthOptions(), staleTime: 60_000 });
  const [end, setEnd] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setEnd(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const query = useQuery({
    ...queryMetricRangeOptions({
      query: {
        metric,
        start: new Date(end - 3600_000).toISOString(),
        end: new Date(end).toISOString(),
        step: 60,
      },
    }),
    enabled: health.data?.available === true,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  return useMemo(
    () =>
      new Map(
        (query.data?.data ?? []).map((s) => [
          s.queue,
          s.points.map((p) => p.value),
        ]),
      ),
    [query.data],
  );
}
export function Sparkline({
  values,
  label,
}: {
  values?: number[];
  label: string;
}) {
  if (!values || values.length < 2)
    return <span className="text-muted-foreground">—</span>;
  const max = Math.max(...values, Number.EPSILON);
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 80},${22 - (v / max) * 20}`)
    .join(" ");
  return (
    <svg
      data-skeleton-hide
      viewBox="0 0 80 24"
      width="80"
      height="24"
      role="img"
      aria-label={label}
    >
      <polyline
        points={points}
        className="fill-none stroke-green stroke-[1.5]"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
