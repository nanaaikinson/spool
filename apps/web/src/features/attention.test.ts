import { describe, expect, it } from "vitest";
import type { Queue, Server } from "../api/generated/types.gen";
import { findIssues } from "./attention";
const queue = (name: string, overrides: Partial<Queue> = {}): Queue => ({
  name,
  active: 0,
  aggregating: 0,
  archived: 0,
  completed: 0,
  failed: 0,
  failed_total: 0,
  latency_seconds: 0,
  memory_bytes: 0,
  paused: false,
  pending: 0,
  processed: 0,
  processed_total: 0,
  retry: 0,
  scheduled: 0,
  timestamp: "2026-10-09T12:00:00Z",
  ...overrides,
});
const server = (queues: Record<string, number>, busy = 0): Server => ({
  id: "srv",
  host: "web-1",
  pid: 1,
  concurrency: 4,
  queues,
  started: "2026-10-09T11:00:00Z",
  status: "active",
  strict_priority: false,
  workers: Array.from({ length: busy }, (_, i) => ({
    task_id: `t${i}`,
    task_type: "x",
    queue: "default",
    started: "2026-10-09T11:59:00Z",
    deadline: null,
  })),
});
const now = Date.parse("2026-10-09T12:00:00Z");
const ids = (issues: ReturnType<typeof findIssues>) => issues.map((i) => i.id);
describe("findIssues", () => {
  it("reports a healthy environment as clear", () => {
    expect(
      findIssues({
        queues: [queue("default", { pending: 3, processed: 100, failed: 2 })],
        servers: [server({ default: 1 })],
        schedulers: [],
        archivedTrend: new Map(),
        now,
      }),
    ).toEqual([]);
  });
  it("flags missing servers and queues nothing processes", () => {
    expect(
      ids(
        findIssues({
          queues: [queue("default", { pending: 2 })],
          servers: [],
          schedulers: [],
          archivedTrend: new Map(),
          now,
        }),
      ),
    ).toEqual(["no-servers"]);
    expect(
      ids(
        findIssues({
          queues: [queue("default"), queue("emails", { retry: 1 })],
          servers: [server({ default: 1 })],
          schedulers: [],
          archivedTrend: new Map(),
          now,
        }),
      ),
    ).toEqual(["unconsumed-emails"]);
  });
  it("orders critical issues first and applies thresholds", () => {
    const issues = findIssues({
      queues: [
        queue("default", { paused: true, pending: 5 }),
        queue("critical", { latency_seconds: 400, processed: 40, failed: 30 }),
        queue("reports", { processed: 10, failed: 10 }),
      ],
      servers: [server({ default: 1, critical: 1, reports: 1 }, 4)],
      schedulers: [
        {
          id: "s",
          type: "report:generate",
          spec: "@every 1m",
          next: "2026-10-09T11:50:00Z",
          previous: null,
        },
      ],
      archivedTrend: new Map([["critical", [10, 12, 15]]]),
      now,
    });
    expect(ids(issues)).toEqual([
      "latency-critical",
      "failing-critical",
      "paused-default",
      "archived-critical",
      "capacity-srv",
      "schedule-s",
    ]);
  });
});
