import type { Queue, TaskSummary } from "../api/generated/types.gen";
/*
 * Stand-in data rendered under skeletons while the real data loads. Phantom UI
 * measures the rendered layout, so values only need realistic lengths; they are
 * never visible.
 */
export const placeholderQueue = (name: string): Queue => ({
  name,
  active: 2,
  aggregating: 0,
  archived: 1280,
  completed: 3400,
  failed: 120,
  failed_total: 900,
  latency_seconds: 4,
  memory_bytes: 3_145_728,
  paused: false,
  pending: 42,
  processed: 1200,
  processed_total: 90000,
  retry: 18,
  scheduled: 16,
  timestamp: "1970-01-01T00:00:00Z",
});
export const placeholderQueues: Queue[] = [
  "critical",
  "default",
  "reports",
].map(placeholderQueue);
const types = [
  "email:deliver",
  "invoice:sync",
  "report:generate",
  "webhook:deliver",
];
export const placeholderTasks: TaskSummary[] = Array.from(
  { length: 8 },
  (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    queue: "default",
    type: types[i % types.length],
    state: "pending",
    retried: 0,
    max_retry: 3,
    last_error: i % 2 ? "endpoint returned 503: upstream unavailable" : "",
    last_failed_at: null,
    next_process_at: "1970-01-01T00:00:00Z",
    completed_at: null,
    orphaned: false,
    schedule: null,
  }),
);
