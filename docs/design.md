# Spool interface

Spool is an incident console for Asynq operators. The supplied Cron Jobs reference informs its neutral surfaces, inset cards, quiet controls and dense tables. A compact left rail anchors a wide, left-aligned workspace: page context and actions, four operational summary cards, then tables and time series. Task inspection has a wide payload pane and a narrow metadata pane.

Palette: black #0a0a0a (canvas), charcoal #171717 (surface), neutral #2b2b2b (rules), white #eeeeee (text and primary actions), green #58bc92 (processing), red #ed7379 (failures), amber #e4b930 (retries), purple #aa82ef (schedules and pauses). Light mode uses a #f7f7f7 canvas, white surfaces, #202020 text, and darker semantic colors. Every surface, form, chart, popup, skeleton, and toast uses the same theme tokens.

Typography: native system sans for navigation, task titles and prose; native monospace for queue names, identifiers, payloads, and errors. Use compact 13–14px table text, a clear 24px page heading, and tabular summary values. No network font dependency.

Dark is the first-visit default even if the OS prefers light. An explicit theme toggle persists locally and initializes before React mounts to prevent a theme flash. Native controls receive the matching color-scheme.

Summary bars show current task state or today's recorded attempt totals. Queue ticks represent actual queues, up to 40; the accompanying counts cover every queue. These summaries do not imply a run history or SLO. Historical charts continue to use Prometheus. The Scheduled view distinguishes one-off scheduled tasks, periodic cron entries, retries, and the next task in its bounded page.

Table panels have a heading, count-bearing navigation tabs, search and filters, a dark header row and restrained row dividers. Queue status tabs persist in the URL. Task views expose the common queue/state/type filters first and retain advanced ID, retry, group and failure-time filters behind Filter. Color always has a text label counterpart. Keyboard focus is visible, dialogs trap focus, and reduced motion is respected.

The UI foundation uses the official shadcn Radix components in `apps/web/src/components/ui`. Queue, state, and historical-range selectors compose `Label`, `SelectTrigger`, `SelectValue`, `SelectContent`, and `SelectItem` with React `useId`; React Hook Form Controllers synchronize form selects with validation and URL-backed filters. Empty filter values are represented by a nonempty UI option and mapped back to the API's empty value. Queue option values have a prefix so a queue named “all” remains selectable.

Cards and TanStack Table use shadcn presentation components. Task tabs, queue ToggleGroup, advanced Collapsible filters, Checkbox selection, cursor Pagination, responsive Sidebar/Sheet, Breadcrumb, CommandDialog, Tooltip, Skeleton, Empty, Alert, ScrollArea, Sonner, and Recharts Chart wrappers provide the remaining common primitives. Operational confirmations use AlertDialog; cloning and saved views use Dialog. Async confirmations remain open on failure, and cancellation receives initial focus. The existing theme provider supplies Sonner's theme directly. Custom queue distributions, snapshot bars, task metadata, and retained lifecycle timestamps remain domain-specific content.
