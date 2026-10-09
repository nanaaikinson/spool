import { z } from "zod";
export const searchSchema = z.object({
  q: z.string().catch(""),
  queue_status: z.enum(["all", "running", "attention", "paused"]).catch("all"),
  queue: z.string().catch(""),
  state: z
    .enum([
      "",
      "pending",
      "active",
      "scheduled",
      "retry",
      "archived",
      "completed",
      "aggregating",
      "failed",
    ])
    .catch(""),
  type: z.string().catch(""),
  id: z.string().catch(""),
  group: z.string().catch(""),
  cursor: z.string().catch(""),
  min_retry: z.coerce.number().int().min(0).max(100000).catch(0),
  failed_after: z.string().catch(""),
  sort: z.string().catch("name"),
  desc: z.coerce.boolean().catch(false),
  range: z.enum(["15m", "1h", "6h", "24h", "7d"]).catch("1h"),
});
