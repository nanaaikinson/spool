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
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useId, useMemo, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  metricsHealthOptions,
  queryMetricRangeOptions,
} from "../api/generated/@tanstack/react-query.gen";
import type { QueryMetricRangeData } from "../api/generated/types.gen";
import { DataError, Empty, Loading } from "../components/data-state";
import { number } from "../lib/utils";
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
export function HistoricalChart({
  metric,
  title,
  queue,
}: {
  metric: NonNullable<QueryMetricRangeData["query"]>["metric"];
  title: string;
  queue?: string;
}) {
  const search = useSearch({ from: "__root__" });
  const health = useQuery({ ...metricsHealthOptions(), staleTime: 60_000 });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) setNow(Date.now());
    };
    const ticker = setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(ticker);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
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
    <Card className="section">
      <CardHeader className="section-heading">
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        <span className="muted small">
          Prometheus · {query.data?.unit ?? "history"}
        </span>
      </CardHeader>
      {health.error ? (
        <CardContent className="section-body">
          <DataError error={health.error} retry={() => health.refetch()} />
        </CardContent>
      ) : health.isPending ? (
        <Loading rows={2} />
      ) : !health.data?.available ? (
        <Empty
          title={
            health.data?.configured
              ? "Prometheus unavailable"
              : "Historical metrics are not connected"
          }
        >
          {health.data?.message} Current queue statistics remain available.
        </Empty>
      ) : query.isPending ? (
        <Loading rows={3} />
      ) : query.error ? (
        <CardContent className="section-body">
          <DataError error={query.error} retry={() => query.refetch()} />
        </CardContent>
      ) : !chartData.length ? (
        <Empty title="No samples in this range">
          Check the Prometheus scrape target or choose a wider time range. Spool
          does not infer history from current snapshots.
        </Empty>
      ) : (
        <>
          <div className="chart">
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
    </Card>
  );
}
