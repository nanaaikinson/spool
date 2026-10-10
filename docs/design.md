# Spool interface

Spool is an incident console for Asynq operators. Neutral surfaces, inset cards, quiet controls and dense tables keep attention on operational state, which is carried by color and always labelled in text.

## Layout

A left sidebar groups pages under **Monitor** (Dashboard, Live activity, Metrics), **Tasks** (Queues, All tasks, Scheduled, Failed) and **Infrastructure** (Servers, Periodic schedules), with Settings, the signed-in account and a subtle environment and version line in the footer. Alt+1 to Alt+9 open the pages in sidebar order. The sidebar collapses to icons with ⌘B or Ctrl+B and becomes a sheet on phones.

A sticky topbar holds the sidebar toggle, a breadcrumb for the current page, search (the command palette, ⌘K or Ctrl+K), the live connection status and the theme toggle. On phones the breadcrumb shows only the current page and the controls become icons.

Pages follow one pattern: a heading with a one-line description and actions, an optional row of figures, then cards holding tables, lists or charts. The task page adds a status panel with a lifecycle line, a wide payload column and a narrow details column.

## Responsive behavior

Styles are mobile first: unprefixed utilities describe the phone layout, and wider layouts are added with breakpoint variants. Page grids use container queries on the content area (the `@container/main` element in `app/shell.tsx`) rather than the viewport, so they respond to the width actually available whether the sidebar is open, collapsed or hidden.

| Content width | Summary cards | Figure tiles | Paired cards |
| --- | --- | --- | --- |
| Under 448px | 1 per row | 2 per row | Stacked |
| `@md/main` (448px) and up | 2 per row | 2 per row (3 for six-tile rows from `@xl/main`, 576px) | Stacked |
| `@4xl/main` (896px) and up | 2 per row | 4 per row | Side by side |
| `@5xl/main` (1024px) and up | 4 per row | 6 for six-tile rows | Side by side; charts split 1.8 : 1 |

Wide tables scroll horizontally inside their card instead of squeezing columns; long error messages are cut to two lines with the full text on hover. On phones, filters stack at full width, pagination and dialog buttons stack, and the command palette drops its keyboard hints.

## Tokens

Styling is Tailwind CSS v4 utilities. `src/styles.css` holds only the theme: color tokens for both themes, the `@theme` type scale, fonts and animations, a few base rules and the `live-halo` utility. There are no app-specific classes; anything shared is a component.

Spacing uses Tailwind's 4px scale. Page gutters grow from 16px to 24px at 768px and 32px at 1280px; vertical rhythm between blocks (`stack` in `components/page.tsx`) grows from 16px to 24px. Card and table padding share `cardX`, so the first table column lines up with the card heading.

Type uses the native system sans for interface text and native monospace for queue names, IDs, cron specs, payloads and errors. The scale is 11, 12, 13, 14, 15, 18, 22, 24 and 28px (`text-2xs` to `text-3xl`): 11px for labels and metadata, 12px for secondary text, 13px for tables, 14px for body text, 15px for card headings, 22px (24px from 768px) for page headings, and 24–28px for summary figures. Numbers that update use tabular figures. There are no web fonts.

Cards use a 12px radius (`rounded-xl`) and controls 8px (`rounded-lg`).

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

The UI is built on the official shadcn Radix components in `apps/web/src/components/ui`, adjusted in place for the app's density (tables, dialogs, input groups, sidebar width). Page building blocks live in `components/page.tsx`: `PageHeader`, `Section` with `SectionHeader` and `SectionBody`, `StatTile` and `statGrid`, `StateBadge`, `StatusDot`, `RunStatus`, `Meter`, the tab bar classes, `FilterBar` and `PaginationBar`, and the `Tone` maps that turn a state into its color. Other domain pieces live in `apps/web/src/components` and each feature folder. Select inputs compose `Label`, `SelectTrigger`, `SelectValue`, `SelectContent` and `SelectItem`; React Hook Form controllers keep form selects in sync with validation and URL-backed filters. An empty filter is a nonempty UI option mapped back to the API's empty value, and queue options are prefixed so a queue named "all" stays selectable.

Loading states use structure-aware skeletons from [phantom-ui](https://github.com/aejkatappaja/phantom-ui), wrapped in `components/phantom.tsx`. The real component renders with stand-in data from `lib/placeholders.ts` and phantom-ui shimmers over what it measures, so skeletons always match the layout they stand in for. Stand-in colors (bars, badges) are hidden while loading, table headings stay visible, and the shimmer colors come from the `--phantom-block` and `--phantom-shimmer` theme tokens. Places without a dedicated skeleton use the shared `Loading` placeholder. phantom-ui marks the region busy for screen readers, keeps placeholders out of the tab order and respects reduced motion.

Operational confirmations use AlertDialog; cloning and saving views use Dialog. Async confirmations stay open on failure, and Cancel receives initial focus. Secondary explanations sit behind a small ⓘ button that opens a popover, so they work on touch screens as well as with a pointer and keyboard. Relative times ("3m ago", "in 30s") update from one shared clock and show the exact time on hover.

Color always has a text counterpart. Keyboard focus is visible, dialogs trap focus, live regions announce new tail events, and reduced-motion preferences turn off animation.

## Copy

- **Voice:** plain and specific. Say what happened and what to do next. Avoid internal terms such as cursor, bucket, inspector or intent.
- **Case:** sentence case for headings, labels and buttons. Full sentences end with a period; labels and button text do not.
- **Terms:** task (not job); queue; server for an Asynq server process; worker slot for concurrency; periodic schedule for a cron entry and one-off for a task delayed with `ProcessIn` or `ProcessAt`; retrying and archived for the two failure states; audit log. Write Asynq, Redis, PostgreSQL and Prometheus with capitals.
- **Numbers and time:** use relative times in lists, exact times on hover, and plural-aware counts ("1 task", "3 tasks").
- **Confirmations:** the title names the action and target ("Archive this task?"); the description states the effect, especially if it can't be undone.
