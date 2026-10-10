import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { CircleCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/*
 * Shared page building blocks. Pages compose these instead of defining their
 * own classes; anything one-off stays as utilities at the call site.
 *
 * Page grids respond to the content area's width (the `main` container on the
 * app frame), so they behave the same with the sidebar open, collapsed or
 * hidden. Use `@md/main:` (448px), `@xl/main:` (576px), `@2xl/main:` (672px),
 * `@3xl/main:` (768px), `@4xl/main:` (896px) and `@5xl/main:` (1024px).
 */

/** Vertical rhythm between top-level blocks on a page. */
export const stack = "mb-4 md:mb-5 xl:mb-6";
/** Horizontal padding shared by card headers, bodies and table edges. */
export const cardX = "px-4 md:px-5";

export function PageHeader({
  title,
  description,
  info,
  actions,
  eyebrow,
  titleClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  info?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  titleClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 @3xl/main:flex-row @3xl/main:items-start @3xl/main:justify-between",
        stack,
      )}
    >
      <div className="min-w-0">
        {eyebrow}
        <h1
          className={cn(
            "flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight text-balance md:text-2xl",
            titleClassName,
          )}
        >
          {title}
          {info}
        </h1>
        {description && (
          <p className="mt-2 max-w-[72ch] text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-none flex-wrap items-center gap-2 @3xl/main:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}

/** A bordered card for page content: heading, then tables, lists or charts. */
export function Section({ className, ...props }: ComponentProps<typeof Card>) {
  return (
    <Card
      className={cn(
        "gap-0 overflow-hidden rounded-xl py-0 shadow-none",
        stack,
        className,
      )}
      {...props}
    />
  );
}

export function SectionHeader({
  title,
  description,
  info,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  info?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b py-3 md:py-4",
        cardX,
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="flex flex-wrap items-center gap-2 text-md font-semibold">
          {title}
          {info}
        </h2>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="flex-none whitespace-nowrap">{action}</div>}
    </div>
  );
}

export function SectionBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("py-4", cardX, className)} {...props} />;
}

/** A small figure: label, value, and an optional detail line or meter. */
export function StatTile({
  label,
  value,
  detail,
  children,
  className,
  valueClassName,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-xl border bg-card px-4 py-3 md:p-4",
        className,
      )}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <strong
        className={cn(
          "truncate text-lg font-semibold tracking-tight tabular-nums md:text-xl [&_small]:text-xs [&_small]:font-normal [&_small]:tracking-normal [&_small]:text-muted-foreground",
          valueClassName,
        )}
      >
        {value}
      </strong>
      {detail && (
        <small className="truncate text-2xs text-muted-foreground">
          {detail}
        </small>
      )}
      {children}
    </div>
  );
}

/** Grid of StatTiles: two per row on phones, more as the content widens. */
export const statGrid = cva(cn("grid grid-cols-2 gap-3", stack), {
  variants: {
    columns: {
      4: "@4xl/main:grid-cols-4",
      6: "@xl/main:grid-cols-3 @5xl/main:grid-cols-6",
    },
  },
  defaultVariants: { columns: 4 },
});

/**
 * Paired cards. `split` puts main content beside a narrower aside from
 * 1024px of content width; `even` puts two equal panels side by side from 896px.
 */
export const cardColumns = cva(
  "grid grid-cols-1 gap-x-4 md:gap-x-5 xl:gap-x-6",
  {
    variants: {
      layout: {
        split: "@5xl/main:grid-cols-[minmax(0,1.8fr)_minmax(300px,1fr)]",
        even: "@4xl/main:grid-cols-2",
      },
    },
    defaultVariants: { layout: "split" },
  },
);

/** Positive empty state inside a Section, e.g. no issues or no errors. */
export function AllClear({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex items-start gap-3 py-5 text-green", cardX)}>
      <CircleCheck size={18} className="flex-none" aria-hidden="true" />
      <div>
        <strong className="block font-[550] text-foreground">{title}</strong>
        <p className="text-xs text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

/* Operational tones. Color always comes with a text label at the call site. */
export type Tone = "green" | "amber" | "red" | "purple" | "muted";
export const toneText: Record<Tone, string> = {
  green: "text-green",
  amber: "text-amber",
  red: "text-red",
  purple: "text-purple",
  muted: "text-muted-foreground",
};
export const toneFill: Record<Tone, string> = {
  green: "bg-green",
  amber: "bg-amber",
  red: "bg-red",
  purple: "bg-purple",
  muted: "bg-muted-foreground",
};
export const toneSoft: Record<Tone, string> = {
  green: "bg-green-bg text-green",
  amber: "bg-amber-bg text-amber",
  red: "bg-red-bg text-red",
  purple: "bg-purple-bg text-purple",
  muted: "bg-hover text-muted-foreground",
};

const stateTones: Record<string, Tone> = {
  pending: "amber",
  paused: "purple",
  scheduled: "purple",
  aggregating: "purple",
  active: "green",
  running: "green",
  completed: "green",
  succeeded: "green",
  retry: "red",
  archived: "red",
  failed: "red",
};
/** Task, queue, server or audit state as a small labelled badge. */
export function StateBadge({
  state,
  className,
  ...props
}: { state: string } & Omit<ComponentProps<typeof Badge>, "children">) {
  return (
    <Badge
      variant="outline"
      data-skeleton-hide
      className={cn(
        "rounded-[5px] border-border px-1.5 py-0.5 text-2xs font-normal",
        toneSoft[stateTones[state] ?? "muted"],
        className,
      )}
      {...props}
    >
      {state}
    </Badge>
  );
}

/** A colored dot; `pulse` adds a halo for live, ongoing states. */
export function StatusDot({
  tone,
  pulse = false,
  className,
}: {
  tone: Tone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <i
      aria-hidden="true"
      className={cn(
        "relative inline-block size-[7px] flex-none rounded-full",
        toneFill[tone],
        pulse && "live-halo",
        className,
      )}
    />
  );
}

export function RunStatus({
  tone,
  pulse,
  children,
  className,
}: {
  tone: Tone;
  pulse?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[7px] text-xs whitespace-nowrap",
        toneText[tone],
        className,
      )}
    >
      <StatusDot tone={tone} pulse={pulse} />
      {children}
    </span>
  );
}

const meter = cva("flex-none overflow-hidden rounded-full bg-hover", {
  variants: {
    size: {
      sm: "h-1.5 w-[110px]",
      md: "h-2 w-full",
      full: "h-1.5 w-full",
    },
  },
  defaultVariants: { size: "sm" },
});
/** Progress or share, 0 to 1. */
export function Meter({
  value,
  tone = "muted",
  size,
  className,
}: {
  value: number;
  tone?: Tone;
  className?: string;
} & VariantProps<typeof meter>) {
  const width = `${Math.min(1, Math.max(0, value)) * 100}%`;
  return (
    <div className={cn(meter({ size }), className)} aria-hidden="true">
      <span
        data-skeleton-hide
        className={cn(
          "block h-full rounded-full transition-[width] duration-1000 ease-linear",
          toneFill[tone],
        )}
        style={{ width } as CSSProperties}
      />
    </div>
  );
}

/*
 * Underlined tab bar for table views. Applied to shadcn TabsList/TabsTrigger
 * and ToggleGroup/ToggleGroupItem, which render the same way here.
 */
export const tabBar = cn(
  "flex h-auto w-full items-stretch justify-start gap-4 overflow-x-auto rounded-none border-b bg-transparent p-0 [scrollbar-width:none]",
  cardX,
);
export const tabItem =
  "inline-flex h-auto flex-none items-center gap-[7px] rounded-none border-0 border-b-2 border-transparent bg-transparent px-0.5 pt-3 pb-2.5 text-sm font-normal whitespace-nowrap text-muted-foreground shadow-none after:hidden hover:bg-transparent hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:text-foreground data-active:border-foreground data-active:bg-transparent data-active:text-foreground data-active:shadow-none data-pressed:border-foreground data-pressed:bg-transparent data-pressed:text-foreground dark:data-active:border-foreground dark:data-active:bg-transparent";
export function TabCount({ children }: { children: ReactNode }) {
  return (
    <span className="inline-grid min-w-[22px] place-items-center rounded-full border bg-hover px-1.5 text-2xs leading-[18px] text-muted-foreground tabular-nums">
      {children}
    </span>
  );
}

/** Row of filters above a table; fields stack on phones. */
export function FilterBar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end gap-3 border-b py-3",
        cardX,
        className,
      )}
      {...props}
    />
  );
}
/** Width for a field inside FilterBar: full on phones, natural when wider. */
export const filterField =
  "w-full gap-1.5 @2xl/main:w-auto @2xl/main:flex-none";

/** Pagination row under a table. */
export function PaginationBar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 border-t py-3 @2xl/main:flex-row @2xl/main:items-center @2xl/main:justify-between",
        cardX,
        className,
      )}
      {...props}
    />
  );
}

/** Divided list inside a Section (issues, error groups, consumers). */
export const dividedList =
  "m-0 list-none p-0 [&>li+li]:border-t [&>li+li]:border-inset-border";
