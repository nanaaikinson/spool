import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Braces,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Filter,
  Link2,
  Rows3,
  Search,
  Sparkles,
  X,
  ZoomOut,
} from "lucide-react";
import { listServerLogs } from "../api/generated/sdk.gen";
import { logHistogramOptions } from "../api/generated/@tanstack/react-query.gen";
import type { LogHistogram, ServerLog } from "../api/generated/types.gen";
import { errorCode } from "../api/client";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Kbd } from "../components/ui/kbd";
import { DataError, Empty, Loading } from "../components/data-state";
import {
  PageHeader,
  Section,
  SectionBody,
  StateBadge,
  StatusDot,
  cardX,
  type Tone,
} from "../components/page";
import { cn, number } from "@/lib/utils";
import { LIVE_REFRESH_MS } from "./charts";
import { useSession } from "./session";

const PAGE = 200;
const spans = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
} as const;
const rangeLabels: Record<keyof typeof spans, string> = {
  "15m": "Last 15 minutes",
  "1h": "Last hour",
  "6h": "Last 6 hours",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
};
/** The API accepts at most 31 days per query. */
const MAX_SPAN = 31 * 24 * 60 * 60_000;
const levelColors = {
  error: "var(--red)",
  warn: "var(--amber)",
  info: "var(--muted-foreground)",
} as const;
const levelTones: Record<string, Tone> = { ERROR: "red", WARN: "amber" };
const rowTint: Record<string, string> = {
  ERROR: "bg-red-bg/60 hover:bg-red-bg",
  WARN: "bg-amber-bg/50 hover:bg-amber-bg",
};
const views = ["table", "json"] as const;
const details = ["formatted", "json"] as const;
const segment =
  "h-7 px-2.5 text-muted-foreground aria-pressed:bg-hover aria-pressed:text-foreground";
/** A per-viewer preference kept in localStorage when the browser allows it. */
function useStoredState<T extends string>(
  key: string,
  initial: T,
  allowed: readonly T[],
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key) as T | null;
      return saved && allowed.includes(saved) ? saved : initial;
    } catch {
      return initial;
    }
  });
  const set = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Storage can be unavailable, as in private windows; keep it in memory.
    }
  };
  return [value, set] as const;
}
/**
 * A line with the fields Spool writes to standard output, reordered for
 * reading: the message first, then attributes, then where it came from.
 */
export function jsonLine(e: ServerLog) {
  const out: Record<string, string | number> = {
    time: e.time,
    level: e.level,
    msg: e.message,
  };
  for (const a of e.attrs) if (!(a.key in out)) out[a.key] = a.value;
  if (e.caller && !("caller" in out)) out.caller = e.caller;
  if (!("id" in out)) out.id = e.id;
  return out;
}
const zone =
  new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value ?? "";
function stamp(iso: string, withDate: boolean) {
  return new Date(iso).toLocaleString(undefined, {
    ...(withDate ? { month: "short", day: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hour12: false,
  });
}
const fullStamp = (iso: string) => `${stamp(iso, true)} ${zone}`;
const iso = (ms: number) => new Date(ms).toISOString();
/** datetime-local value for a timestamp, in the browser's zone. */
function localInput(ms: number) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

type LogSearch = ReturnType<typeof useLogSearch>["search"];
function useLogSearch() {
  const search = useSearch({ from: "__root__" });
  const navigate = useNavigate();
  const set = (patch: Partial<typeof search>, replace = false) =>
    navigate({ to: ".", search: (old) => ({ ...old, ...patch }), replace });
  return { search, set };
}

/** Live tail polls this often; other relative ranges every LIVE_REFRESH_MS. */
const TAIL_MS = 2_000;
/**
 * The time window. Relative ranges end now and move forward every refresh,
 * except while the reader is browsing older pages or a selected line. Live
 * tail keeps moving regardless.
 */
function useWindow(search: LogSearch, paused: boolean, live: boolean) {
  const custom = !!(search.from && search.to);
  const [anchor, setAnchor] = useState(() => Date.now());
  useEffect(() => {
    if (custom || (paused && !live)) return;
    const id = setInterval(
      () => {
        if (!document.hidden) setAnchor(Date.now());
      },
      live ? TAIL_MS : LIVE_REFRESH_MS,
    );
    return () => clearInterval(id);
  }, [custom, paused, live]);
  const span = spans[search.range as keyof typeof spans] ?? spans["1h"];
  const start = custom ? Date.parse(search.from) : anchor - span;
  const end = custom ? Date.parse(search.to) : anchor;
  const label = custom
    ? `${new Date(start).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} – ${new Date(end).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : rangeLabels[search.range as keyof typeof spans];
  return { start, end, custom, label, refresh: () => setAnchor(Date.now()) };
}

export function LogsPage() {
  const session = useSession();
  const { search, set } = useLogSearch();
  const noDatabase = session.data?.read_only_reason === "no_database";
  const around = search.around || 0;
  const [pages, setPages] = useState(1);
  const live = search.live && !around && !(search.from && search.to);
  const [view, setView] = useStoredState("spool.logs.view", "table", views);
  const win = useWindow(search, pages > 1 || !!search.log || !!around, live);
  const query = { q: search.q, start: iso(win.start), end: iso(win.end) };
  const list = useInfiniteQuery({
    queryKey: ["serverLogs", around ? { around } : query],
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await listServerLogs({
        query: around
          ? { around, limit: PAGE }
          : { ...query, limit: PAGE, before: pageParam || undefined },
        signal,
        throwOnError: true,
      });
      return data;
    },
    initialPageParam: 0,
    getNextPageParam: (last) =>
      !around && last.has_more ? last.data.at(-1)?.id : undefined,
    placeholderData: keepPreviousData,
    enabled: !noDatabase,
  });
  const histogram = useQuery({
    ...logHistogramOptions({ query }),
    enabled: !noDatabase && !around,
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(
    () => list.data?.pages.flatMap((p) => p.data) ?? [],
    [list.data],
  );
  useEffect(() => setPages(list.data?.pages.length ?? 1), [list.data]);
  // Lines newer than this arrived on the last refresh and are highlighted.
  const top = rows[0]?.id ?? 0;
  const [seenTop, setSeenTop] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setSeenTop(top), 1500);
    return () => clearTimeout(t);
  }, [top]);
  const fresh = (id: number) => live && seenTop > 0 && id > seenTop;
  const index = rows.findIndex((r) => r.id === search.log);
  const selected = index >= 0 ? rows[index] : undefined;
  const select = (id: number) => set({ log: id }, true);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest(
        "input, textarea, [contenteditable]",
      );
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchInput.current?.focus();
      } else if (e.key === "Escape" && search.log && !typing) {
        set({ log: 0 }, true);
      } else if (selected && !typing && !e.metaKey && !e.ctrlKey) {
        const step =
          e.key === "ArrowDown" || e.key === "j"
            ? 1
            : e.key === "ArrowUp" || e.key === "k"
              ? -1
              : 0;
        const next = rows[index + step];
        if (step && next) {
          e.preventDefault();
          select(next.id);
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  // Bring the anchor line into view; it sits mid-list.
  const anchorShown = around > 0 && rows.some((r) => r.id === around);
  useEffect(() => {
    if (anchorShown)
      document
        .querySelector(`[data-log-id="${around}"]`)
        ?.scrollIntoView({ block: "center" });
  }, [around, anchorShown]);
  const forbidden = errorCode(list.error) === "FORBIDDEN";
  const withDate = win.end - win.start > spans["24h"] || !!around;
  return (
    <>
      <PageHeader
        title="Logs"
        description="Spool’s own log lines: startup, sign-ins, queue and task actions, warnings and errors. HTTP request lines stay in the process output."
      />
      {noDatabase ? (
        <Section>
          <Empty title="Logs need a database">
            Ask the operator to configure persistent storage to keep Spool’s log
            lines.
          </Empty>
        </Section>
      ) : forbidden ? (
        <Section>
          <Empty title="Only the administrator can view logs">
            Server logs can name internal hosts, so viewer accounts can’t see
            them.
          </Empty>
        </Section>
      ) : (
        <>
          <Toolbar
            search={search}
            set={set}
            win={win}
            live={live}
            view={view}
            setView={setView}
            inputRef={searchInput}
          />
          <Section className="overflow-hidden">
            {around ? (
              <div
                className={cn(
                  "flex flex-wrap items-center gap-2 border-b py-3 text-sm",
                  cardX,
                )}
              >
                <Rows3 className="size-4 text-muted-foreground" />
                <span>
                  Lines logged around{" "}
                  <span className="font-mono">#{around}</span>, ignoring the
                  search and time range
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  className="ml-auto"
                  onClick={() => set({ around: 0 })}
                >
                  Back to search
                </Button>
              </div>
            ) : (
              <Histogram
                data={histogram.data}
                error={histogram.error}
                retry={() => histogram.refetch()}
                shown={rows.length}
                more={!!list.hasNextPage}
                win={win}
                set={set}
              />
            )}
            {list.isPending ? (
              <Loading rows={6} />
            ) : list.error ? (
              <SectionBody>
                <DataError error={list.error} retry={() => list.refetch()} />
              </SectionBody>
            ) : !rows.length ? (
              <Empty title="No log lines">
                {search.q
                  ? "Nothing matches this search in this range. Try a longer range or a broader search."
                  : "Spool hasn’t logged anything in this range."}
              </Empty>
            ) : (
              <>
                {view === "json" ? (
                  <div
                    role="list"
                    aria-label="Log lines as JSON"
                    className="divide-y font-mono text-xs"
                  >
                    {rows.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        role="listitem"
                        data-log-id={r.id}
                        aria-current={r.id === search.log || undefined}
                        onClick={() => select(r.id)}
                        className={cn(
                          "block w-full py-2 text-left whitespace-pre-wrap [overflow-wrap:anywhere] hover:bg-hover",
                          cardX,
                          rowTint[r.level],
                          fresh(r.id) && "animate-in fade-in-0 bg-hover",
                          (r.id === search.log || r.id === around) &&
                            "bg-accent outline outline-1 -outline-offset-1 outline-ring/40",
                        )}
                      >
                        {JSON.stringify(jsonLine(r))}
                      </button>
                    ))}
                  </div>
                ) : (
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead
                          className={withDate ? "w-[170px]" : "w-[120px]"}
                        >
                          Time ({zone})
                        </TableHead>
                        <TableHead className="hidden w-[76px] sm:table-cell">
                          Level
                        </TableHead>
                        <TableHead>Message</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="font-mono text-xs">
                      {rows.map((r) => (
                        <TableRow
                          key={r.id}
                          data-log-id={r.id}
                          aria-selected={r.id === search.log}
                          onClick={() => select(r.id)}
                          className={cn(
                            "cursor-pointer",
                            rowTint[r.level],
                            fresh(r.id) && "animate-in fade-in-0 bg-hover",
                            (r.id === search.log || r.id === around) &&
                              "bg-accent hover:bg-accent outline outline-1 -outline-offset-1 outline-ring/40",
                          )}
                        >
                          <TableCell className="tabular-nums text-muted-foreground">
                            <button
                              type="button"
                              className="inline-flex items-center gap-2 text-left outline-none focus-visible:underline"
                              aria-label={`Open log line from ${fullStamp(r.time)}`}
                            >
                              <StatusDot
                                tone={levelTones[r.level] ?? "muted"}
                                className="sm:hidden"
                              />
                              {stamp(r.time, withDate)}
                            </button>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            <StateBadge state={r.level.toLowerCase()} />
                          </TableCell>
                          <TableCell className="truncate">
                            <span className="text-foreground">{r.message}</span>
                            {r.attrs.length > 0 && (
                              <span className="ml-3 text-muted-foreground">
                                {r.attrs
                                  .map((a) => `${a.key}=${a.value}`)
                                  .join(" ")}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                {list.hasNextPage && (
                  <div className={cn("border-t py-3 text-center", cardX)}>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={list.isFetchingNextPage}
                      onClick={() => {
                        // Older pages and a moving tail don't mix.
                        if (search.live) set({ live: false }, true);
                        list.fetchNextPage();
                      }}
                    >
                      {list.isFetchingNextPage
                        ? "Loading…"
                        : "Load older lines"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </Section>
        </>
      )}
      {selected && (
        <LogDetail
          entry={selected}
          position={`${number(index + 1)} / ${number(rows.length)}${list.hasNextPage ? "+" : ""}`}
          prev={rows[index - 1] && (() => select(rows[index - 1].id))}
          next={rows[index + 1] && (() => select(rows[index + 1].id))}
          close={() => set({ log: 0 }, true)}
          around={() => set({ around: selected.id })}
          pattern={() =>
            set({
              q: `message:"${selected.message.replaceAll('"', "*")}"`,
              around: 0,
            })
          }
          instance={
            session.data?.instance_name || session.data?.environment || ""
          }
        />
      )}
    </>
  );
}

function Toolbar({
  search,
  set,
  win,
  live,
  view,
  setView,
  inputRef,
}: {
  search: LogSearch;
  set: ReturnType<typeof useLogSearch>["set"];
  win: ReturnType<typeof useWindow>;
  live: boolean;
  view: (typeof views)[number];
  setView: (v: (typeof views)[number]) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  // The query applies on Enter, not on every keystroke.
  const [draft, setDraft] = useState(search.q);
  useEffect(() => setDraft(search.q), [search.q]);
  return (
    <div className="mb-4 flex flex-col gap-2 md:mb-5 @3xl/main:flex-row @3xl/main:items-center">
      <form
        className="min-w-0 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: draft.trim(), log: 0, around: 0 });
        }}
      >
        <InputGroup className="bg-card">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            aria-label="Search logs"
            className="font-mono text-xs"
            placeholder="level:error -healthcheck code:DEPENDENCY_*"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <InputGroupAddon align="inline-end" className="gap-1.5">
            {search.q && (
              <button
                type="button"
                aria-label="Clear search"
                className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => set({ q: "", log: 0 })}
              >
                <X className="size-3.5" />
              </button>
            )}
            <Kbd>/</Kbd>
            <SearchHelp />
          </InputGroupAddon>
        </InputGroup>
      </form>
      <div
        role="group"
        aria-label="Time range"
        className="inline-flex flex-none items-center gap-0.5 self-start rounded-md border bg-card p-0.5"
      >
        {(["15m", "1h", "24h", "7d"] as const).map((r) => (
          <Button
            key={r}
            variant="ghost"
            size="sm"
            aria-pressed={!win.custom && search.range === r}
            className={segment}
            onClick={() => {
              set({ range: r, from: "", to: "", log: 0 });
              win.refresh();
            }}
          >
            {r}
          </Button>
        ))}
        <CustomRange win={win} set={set} />
      </div>
      <div className="flex flex-none gap-2 self-start">
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={live}
          disabled={!!search.around}
          title={
            search.around
              ? "Go back to search to tail new lines"
              : "Show new lines as they are logged"
          }
          className={cn(segment, "h-9 border bg-card px-3")}
          onClick={() => {
            set({ live: !live, from: "", to: "", log: 0 });
            win.refresh();
          }}
        >
          <StatusDot tone={live ? "green" : "muted"} pulse={live} />
          Live
        </Button>
        <div
          role="group"
          aria-label="Line format"
          className="inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5"
        >
          {views.map((v) => (
            <Button
              key={v}
              variant="ghost"
              size="sm"
              aria-pressed={view === v}
              className={segment}
              onClick={() => setView(v)}
            >
              {v === "table" ? <Rows3 /> : <Braces />}
              {v === "table" ? "Table" : "JSON"}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SearchHelp() {
  const rows: [string, string][] = [
    ["timeout", "Lines whose message, caller or attributes contain timeout"],
    ["level:error", "Only errors; repeat a field to match any of its values"],
    ["code:DEPENDENCY_*", "An attribute value; * matches any text"],
    ['message:"request failed"', "The exact message"],
    ["caller:*queues.go*", "Lines logged from a file"],
    ["-level:info", "Exclude matches"],
    ['"redis://cache:6379"', "Quote text containing spaces or colons"],
  ];
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Search syntax"
        className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
      >
        <CircleHelp className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(420px,calc(100vw-32px))]">
        <p className="font-medium">Search syntax</p>
        <dl className="grid gap-2 text-xs">
          {rows.map(([example, meaning]) => (
            <div key={example} className="grid gap-0.5">
              <dt className="font-mono text-foreground">{example}</dt>
              <dd className="text-muted-foreground">{meaning}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          Terms are combined, and matching ignores case. Press Enter to search.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function CustomRange({
  win,
  set,
}: {
  win: ReturnType<typeof useWindow>;
  set: ReturnType<typeof useLogSearch>["set"];
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const start = Date.parse(from);
  const end = Date.parse(to);
  const valid = start < end && end - start <= MAX_SPAN;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setFrom(localInput(win.start));
          setTo(localInput(win.end));
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={win.custom}
            className={segment}
          />
        }
      >
        <CalendarRange />
        Custom…
      </PopoverTrigger>
      <PopoverContent align="end">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            set({ from: iso(start), to: iso(end), log: 0, live: false });
            setOpen(false);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="logs-from">From</Label>
            <Input
              id="logs-from"
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="logs-to">To</Label>
            <Input
              id="logs-to"
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          {!valid && from && to && (
            <p className="text-xs text-red">
              Choose an end after the start, at most 31 days later.
            </p>
          )}
          <Button type="submit" size="sm" disabled={!valid}>
            Apply range
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function Histogram({
  data,
  error,
  retry,
  shown,
  more,
  win,
  set,
}: {
  data?: LogHistogram;
  error: unknown;
  retry: () => void;
  shown: number;
  more: boolean;
  win: ReturnType<typeof useWindow>;
  set: ReturnType<typeof useLogSearch>["set"];
}) {
  const span = win.end - win.start;
  const now = Date.now();
  const custom = (start: number, end: number) =>
    set({
      from: iso(start),
      to: iso(Math.min(end, now)),
      log: 0,
      live: false,
    });
  const bars = (data?.buckets ?? []).map((b) => ({
    ...b,
    t: Date.parse(b.start),
  }));
  const step = (data?.step_seconds ?? 60) * 1000;
  const tick = (t: number) =>
    new Date(t).toLocaleString(
      undefined,
      span > spans["24h"]
        ? { month: "short", day: "numeric", hour: "2-digit" }
        : { hour: "2-digit", minute: "2-digit" },
    );
  return (
    <div className="border-b">
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-xs text-muted-foreground",
          cardX,
        )}
      >
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Earlier"
            onClick={() => custom(win.start - span, win.end - span)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            disabled={span * 4 > MAX_SPAN}
            onClick={() => {
              const mid = (win.start + win.end) / 2;
              custom(mid - span * 2, mid + span * 2);
            }}
          >
            <ZoomOut />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Later"
            disabled={win.end >= now - 1000}
            onClick={() => custom(win.start + span, win.end + span)}
          >
            <ChevronRight />
          </Button>
        </div>
        <span>
          {data ? `${number(data.total)} lines` : "Counting…"} · {win.label}
          {" · "}
          {number(shown)}
          {more ? "+" : ""} shown, newest first
        </span>
        <span className="ml-auto flex items-center gap-3">
          {(["error", "warn", "info"] as const).map((l) => (
            <span key={l} className="inline-flex items-center gap-1.5">
              <i
                className="size-2 rounded-[2px]"
                style={{ background: levelColors[l] }}
              />
              {l === "warn" ? "Warn" : l === "error" ? "Error" : "Info"}
            </span>
          ))}
        </span>
      </div>
      {error ? (
        <SectionBody>
          <DataError error={error} retry={retry} />
        </SectionBody>
      ) : (
        <div className="h-[120px] px-2 pt-2 pb-1 md:px-3">
          <ChartContainer
            className="aspect-auto h-full w-full"
            config={{
              error: { label: "Error", color: levelColors.error },
              warn: { label: "Warn", color: levelColors.warn },
              info: { label: "Info", color: levelColors.info },
            }}
          >
            <BarChart
              data={bars}
              margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
              barCategoryGap={1}
              onClick={(state) => {
                const b = bars[Number(state?.activeIndex)];
                // Zoom into a bucket, unless it is already one second wide.
                if (b && step > 1000) custom(b.t, b.t + step);
              }}
              className="cursor-zoom-in"
            >
              <CartesianGrid
                stroke="var(--grid)"
                strokeDasharray="3 4"
                vertical={false}
              />
              <XAxis
                dataKey="t"
                tickFormatter={tick}
                stroke="var(--muted-foreground)"
                fontSize={11}
                minTickGap={60}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={number}
                stroke="var(--muted-foreground)"
                fontSize={11}
                width={40}
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
              />
              <ChartTooltip
                cursor={{ fill: "var(--hover)" }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => {
                      const t = payload?.[0]?.payload?.t as number | undefined;
                      return t ? stamp(iso(t), span > spans["24h"]) : "";
                    }}
                  />
                }
              />
              {(["info", "warn", "error"] as const).map((l) => (
                <Bar
                  key={l}
                  dataKey={l}
                  stackId="levels"
                  fill={`var(--color-${l})`}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ChartContainer>
        </div>
      )}
    </div>
  );
}

function LogDetail({
  entry,
  position,
  prev,
  next,
  close,
  around,
  pattern,
  instance,
}: {
  entry: ServerLog;
  position: string;
  prev?: () => void;
  next?: () => void;
  close: () => void;
  around: () => void;
  pattern: () => void;
  instance: string;
}) {
  const [detail, setDetail] = useStoredState(
    "spool.logs.detail",
    "formatted",
    details,
  );
  const copy = (text: string, what: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success(`${what} copied.`))
      .catch(() => toast.error("The browser blocked clipboard access."));
  const link = `${window.location.origin}/logs?around=${entry.id}&log=${entry.id}`;
  const forAI = [
    `Help me understand this log line from Spool, an Asynq operations console${instance ? ` (instance ${instance})` : ""}.`,
    "",
    `time: ${entry.time}`,
    `level: ${entry.level}`,
    `message: ${entry.message}`,
    `caller: ${entry.caller || "unknown"}`,
    ...(entry.attrs.length
      ? ["attributes:", ...entry.attrs.map((a) => `  ${a.key}: ${a.value}`)]
      : []),
  ].join("\n");
  return (
    <aside
      aria-label="Log line"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l bg-background shadow-xl sm:w-[min(540px,100vw)]"
    >
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <StateBadge state={entry.level.toLowerCase()} />
        <time
          dateTime={entry.time}
          className="min-w-0 truncate font-mono text-xs tabular-nums"
        >
          {fullStamp(entry.time)}
        </time>
        <div className="ml-auto flex flex-none items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Newer line"
            disabled={!prev}
            onClick={prev}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Older line"
            disabled={!next}
            onClick={next}
          >
            <ArrowDown />
          </Button>
          <span className="px-1 font-mono text-xs text-muted-foreground tabular-nums">
            {position}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy link to this line"
            onClick={() => copy(link, "Link")}
          >
            <Link2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={close}
          >
            <X />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={around}>
            <Rows3 />
            Lines around
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => copy(forAI, "Log line")}
          >
            <Sparkles />
            Copy for AI
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              copy(JSON.stringify(jsonLine(entry), null, 2), "JSON")
            }
          >
            <Braces />
            Copy JSON
          </Button>
          <Button variant="secondary" size="sm" onClick={pattern}>
            <Filter />
            Same message
          </Button>
        </div>
        <div
          role="group"
          aria-label="Detail format"
          className="mt-5 inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5"
        >
          {details.map((v) => (
            <Button
              key={v}
              variant="ghost"
              size="sm"
              aria-pressed={detail === v}
              className={segment}
              onClick={() => setDetail(v)}
            >
              {v === "formatted" ? "Formatted" : "JSON"}
            </Button>
          ))}
        </div>
        {detail === "json" ? (
          <JsonBlock value={jsonLine(entry)} />
        ) : (
          <>
            <DetailHeading>Message</DetailHeading>
            <div className="rounded-md border bg-card px-3 py-2.5 font-mono text-sm [overflow-wrap:anywhere]">
              {entry.message}
            </div>
            <DetailHeading>Fields</DetailHeading>
            <KeyValues
              rows={[
                ["time", fullStamp(entry.time)],
                ["level", entry.level],
                ["caller", entry.caller || "—"],
                ["id", `#${entry.id}`],
              ]}
            />
            <DetailHeading>
              Attributes
              <span className="ml-2 rounded-sm bg-hover px-1.5 py-px text-2xs text-muted-foreground tabular-nums">
                {entry.attrs.length}
              </span>
            </DetailHeading>
            {entry.attrs.length ? (
              <KeyValues
                rows={entry.attrs.map((a) => [a.key, JSON.stringify(a.value)])}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                This line has no attributes.
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

/** Pretty-printed JSON with keys and numbers set apart. */
function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="mt-4 overflow-x-auto rounded-md border bg-card p-3 font-mono text-xs leading-5">
      {JSON.stringify(value, null, 2)
        .split("\n")
        .map((line, i) => {
          const m = /^(\s*)("(?:[^"\\]|\\.)*")(: )(.*)$/.exec(line);
          return (
            <div key={i}>
              {m ? (
                <>
                  {m[1]}
                  <span className="text-muted-foreground">{m[2]}</span>
                  {m[3]}
                  <span className={m[4].startsWith('"') ? "" : "text-amber"}>
                    {m[4]}
                  </span>
                </>
              ) : (
                line
              )}
            </div>
          );
        })}
    </pre>
  );
}

function DetailHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-6 mb-2 flex items-center text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

function KeyValues({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y overflow-hidden rounded-md border bg-card font-mono text-xs">
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="grid grid-cols-[minmax(96px,38%)_1fr] gap-3 px-3 py-2"
        >
          <dt className="text-muted-foreground [overflow-wrap:anywhere]">
            {k}
          </dt>
          <dd className="[overflow-wrap:anywhere]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
