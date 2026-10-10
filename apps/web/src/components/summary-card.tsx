import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import type { ReactNode } from "react";
import { number } from "../lib/utils";

export function SummaryCard({
  icon,
  label,
  value,
  note,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  note: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card
      data-testid="summary-card"
      className="min-w-0 gap-0 p-4 shadow-[inset_0_0_0_3px_var(--background),inset_0_0_0_4px_var(--inset-border)] md:min-h-[196px] md:p-5"
    >
      <CardHeader className="flex items-center gap-3 p-0">
        <span className="grid size-8 flex-none place-items-center rounded-lg border bg-hover shadow-[0_2px_4px_rgba(0,0,0,0.1)] md:size-9">
          {icon}
        </span>
        <div className="min-w-0 wrap-anywhere">
          <CardTitle>
            <h2 className="text-base/[1.35] font-[550]">{label}</h2>
          </CardTitle>
          <CardDescription className="text-xs/5 text-muted-foreground">
            {note}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent
        data-testid="summary-value"
        className="mt-4 p-0 text-2xl/[1.2] font-semibold tracking-[-0.02em] tabular-nums md:text-3xl/[1.2] [&_small]:text-sm/[1.2] [&_small]:font-normal [&_small]:tracking-normal [&_small]:text-muted-foreground"
      >
        {value}
      </CardContent>
      <CardFooter className="mt-auto block p-0 pt-4 text-xs/normal text-muted-foreground [&_p]:wrap-anywhere">
        {children}
      </CardFooter>
    </Card>
  );
}

export function SnapshotBar({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <div>
      <div
        className="flex h-1.5 gap-[3px] overflow-hidden rounded-[4px] bg-hover"
        aria-hidden="true"
      >
        {segments.map((segment) =>
          segment.value > 0 ? (
            <span
              key={segment.label}
              data-skeleton-hide
              className="min-w-[3px] rounded-[4px]"
              style={{
                flex: segment.value,
                background: `var(--${segment.color})`,
              }}
            />
          ) : null,
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs/normal">
        {segments.map((segment) => (
          <span
            key={segment.label}
            className="inline-flex items-center gap-[5px]"
          >
            <i
              data-skeleton-hide
              className="h-[9px] w-[3px] rounded-[2px]"
              style={{ background: `var(--${segment.color})` }}
            />
            {number(segment.value)} {segment.label}
          </span>
        ))}
        {!total && <span className="sr-only">No recorded activity</span>}
      </div>
    </div>
  );
}
