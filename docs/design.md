# Spool interface

Spool is an incident console for Asynq operators. Neutral surfaces, inset cards, quiet controls and dense tables keep attention on operational state, which is carried by color and always labelled in text.

## Layout

A left sidebar groups pages under **Monitor** (Dashboard, Live activity, Metrics), **Tasks** (Queues, All tasks, Scheduled, Failed) and **Infrastructure** (Servers, Periodic schedules), with Settings, the signed-in account and a subtle environment and version line in the footer. Alt+1 to Alt+9 open the pages in sidebar order. The sidebar collapses to icons with ⌘B or Ctrl+B and becomes a sheet on phones.

A sticky topbar holds the sidebar toggle, a breadcrumb for the current page, search (the command palette, ⌘K or Ctrl+K), the live connection status and the theme toggle. On phones the breadcrumb shows only the current page and the controls become icons.

Pages follow one pattern: a heading with a one-line description and actions, an optional row of figures, then cards holding tables, lists or charts. The task page adds a status panel with a lifecycle line, a wide payload column and a narrow details column.

## Responsive behavior

Styles are mobile first: base rules describe the phone layout, and wider layouts are added with `min-width` queries. Page grids use container queries on the content area (`.main`) rather than the viewport, so they respond to the width actually available whether the sidebar is open, collapsed or hidden.

| Content width | Summary cards | Figure tiles | Paired cards |
| --- | --- | --- | --- |
| Under 440px | 1 per row | 2 per row | Stacked |
| 440px and up | 2 per row | 2 per row (3 for six-tile rows from 560px) | Stacked |
| 880px and up | 2 per row | 4 per row | Side by side |
| 1000px and up | 4 per row | 6 for six-tile rows | Side by side; charts split 1.8 : 1 |

Wide tables scroll horizontally inside their card instead of squeezing columns; long error messages are cut to two lines with the full text on hover. On phones, filters stack at full width, pagination and dialog buttons stack, and the command palette drops its keyboard hints.

## Tokens

Spacing uses a 4px scale (`--space-1` to `--space-8`: 4, 8, 12, 16, 20, 24, 32). Page gutters grow from 16px to 24px at 768px and 32px at 1280px; vertical rhythm between blocks (`--stack`) grows from 16px to 24px. Card and table padding share `--card-x`, so the first table column lines up with the card heading.

Type uses the native system sans for interface text and native monospace for queue names, IDs, cron specs, payloads and errors. The scale is 11, 12, 13, 14, 15, 18, 22, 24 and 28px (`--text-2xs` to `--text-3xl`): 11px for labels and metadata, 12px for secondary text, 13px for tables, 14px for body text, 15px for card headings, 22px (24px from 768px) for page headings, and 24–28px for summary figures. Numbers that update use tabular figures. There are no web fonts.

Cards use a 12px radius and controls 8px.

## Brand

The Spool symbol is a spindle with a diagonal opening that suggests an unwinding thread. Brand colors are copper #B65C3A and ink #161616 on light backgrounds, and light copper #E4A07A and paper #F3EFE7 on dark ones. They belong to the logo only; operational state never uses them.

- **Sidebar:** the symbol in light copper on an ink tile, matching the app icon, in both themes. It uses the kit's small-size drawing, which has broader flanges and a wider opening for 16–24px.
- **Sign-in:** a full-screen page without the app frame. From 960px a brand panel (ink, with the dark lockup, a short pitch and a faint diagonal thread echoing the symbol) sits beside the form; on phones the form stands alone under the themed lockup. The form keeps errors inline, clears the password after a failed attempt, warns when Caps Lock is on and lets people reveal the password.
- **Browser:** SVG and ICO favicons, an Apple touch icon, 192/512px icons and a maskable icon, declared in `index.html` and `site.webmanifest`.

Brand files live in `apps/web/public` (icons) and `apps/web/src/assets/brand` (lockups), with README copies in `docs/assets`. Keep clear space of one flange thickness around the artwork, and don't recolor, stretch or rebuild the wordmark.

## Color and themes

Palette: black #0a0a0a (canvas), charcoal #171717 (surface), neutral #2b2b2b (rules), white #eeeeee (text and primary actions), green #58bc92 (running, succeeded), red #ed7379 (failures), amber #e4b930 (retrying, waiting, warnings), purple #aa82ef (scheduled, paused, periodic). Light mode uses a #f7f7f7 canvas, white surfaces, #202020 text and darker semantic colors. Every surface, form, chart, popover, skeleton and toast uses the same theme tokens.

Dark is the first-visit default even if the OS prefers light. The theme toggle persists locally and is applied before React mounts, so there is no flash. Native controls receive the matching color scheme.

## Components

The UI is built on the official shadcn Radix components in `apps/web/src/components/ui`, with domain pieces in `apps/web/src/components` and each feature folder. Select inputs compose `Label`, `SelectTrigger`, `SelectValue`, `SelectContent` and `SelectItem`; React Hook Form controllers keep form selects in sync with validation and URL-backed filters. An empty filter is a nonempty UI option mapped back to the API's empty value, and queue options are prefixed so a queue named "all" stays selectable.

Operational confirmations use AlertDialog; cloning and saving views use Dialog. Async confirmations stay open on failure, and Cancel receives initial focus. Secondary explanations sit behind a small ⓘ button that opens a popover, so they work on touch screens as well as with a pointer and keyboard. Relative times ("3m ago", "in 30s") update from one shared clock and show the exact time on hover.

Color always has a text counterpart. Keyboard focus is visible, dialogs trap focus, live regions announce new tail events, and reduced-motion preferences turn off animation.

## Copy

- **Voice:** plain and specific. Say what happened and what to do next. Avoid internal terms such as cursor, bucket, inspector or intent.
- **Case:** sentence case for headings, labels and buttons. Full sentences end with a period; labels and button text do not.
- **Terms:** task (not job); queue; server for an Asynq server process; worker slot for concurrency; periodic schedule for a cron entry and one-off for a task delayed with `ProcessIn` or `ProcessAt`; retrying and archived for the two failure states; audit log. Write Asynq, Redis, PostgreSQL and Prometheus with capitals.
- **Numbers and time:** use relative times in lists, exact times on hover, and plural-aware counts ("1 task", "3 tasks").
- **Confirmations:** the title names the action and target ("Archive this task?"); the description states the effect, especially if it can't be undone.
