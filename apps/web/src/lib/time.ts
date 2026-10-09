import { useEffect, useState, useSyncExternalStore } from "react";
import type { Worker } from "../api/generated/types.gen";
const pad = (n: number) => String(n).padStart(2, "0");
/** Ticking clock format: 9s, 1m 05s, 2h 03m. */
export function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${pad(m)}m`;
  if (m) return `${m}m ${pad(s % 60)}s`;
  return `${s}s`;
}
export const timeOfDay = (at: number | string) =>
  new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
/** Current time, ticking every second unless paused. */
export function useNow(paused: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [paused]);
  return now;
}
export type RunState = {
  elapsed: number;
  tone: string;
  label: string;
  deadline?: { progress: number; left: number };
};
export function runState(w: Worker, now: number): RunState {
  const started = Date.parse(w.started);
  const elapsed = now - started;
  if (!w.deadline) return { elapsed, tone: "green", label: "Running" };
  const end = Date.parse(w.deadline);
  const deadline = {
    progress: Math.min(1, elapsed / Math.max(1, end - started)),
    left: end - now,
  };
  if (deadline.left <= 0)
    return { elapsed, deadline, tone: "red", label: "Overdue" };
  if (deadline.progress >= 0.8)
    return { elapsed, deadline, tone: "amber", label: "Near deadline" };
  return { elapsed, deadline, tone: "green", label: "Running" };
}
export function dueIn(at: string, now: number) {
  const ms = Date.parse(at) - now;
  return ms <= 0 ? "due now" : `in ${clock(ms)}`;
}

// One shared ticker for every relative timestamp on the page.
const listeners = new Set<() => void>();
let clockNow = Date.now();
let ticker: number | undefined;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (ticker === undefined)
    ticker = window.setInterval(() => {
      clockNow = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.clearInterval(ticker);
      ticker = undefined;
    }
  };
}
/** Current time from the shared one-second ticker. */
export const useClock = () =>
  useSyncExternalStore(
    subscribe,
    () => clockNow,
    () => clockNow,
  );
/** Coarse relative time for tables: "12s ago", "in 3m", "2d ago". */
export function relative(at: string | number, now: number) {
  const ms = (typeof at === "number" ? at : Date.parse(at)) - now;
  const s = Math.round(Math.abs(ms) / 1000);
  if (s < 5) return ms > 0 ? "now" : "just now";
  const value =
    s < 60
      ? `${s}s`
      : s < 3600
        ? `${Math.floor(s / 60)}m`
        : s < 172800
          ? `${Math.floor(s / 3600)}h`
          : `${Math.floor(s / 86400)}d`;
  return ms > 0 ? `in ${value}` : `${value} ago`;
}
