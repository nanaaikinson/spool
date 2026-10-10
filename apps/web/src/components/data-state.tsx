import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { errorMessage } from "../api/client";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import { Card } from "./ui/card";
import { Phantom } from "./phantom";
import { cardX, stack, StateBadge } from "./page";
import { cn } from "@/lib/utils";
import {
  Empty as UiEmpty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "./ui/empty";
const widths = ["40%", "18%", "14%", "20%"];
/** Generic table-shaped skeleton for places without a structure-aware one. */
export function Loading({ rows = 5 }: { rows?: number }) {
  return (
    <Card className={cn("gap-0 overflow-hidden py-0", stack)}>
      <Phantom loading count={rows} label="Loading data">
        <div
          className={cn(
            "flex justify-between gap-6 py-4 text-sm/normal",
            cardX,
          )}
        >
          {widths.map((width) => (
            <span key={width} style={{ width }}>
              Loading
            </span>
          ))}
        </div>
      </Phantom>
    </Card>
  );
}
export function DataError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <Alert variant="destructive" className="mb-5">
      <AlertCircle />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-4">
        <span>{errorMessage(error)}</span>
        <Button variant="secondary" size="sm" onClick={retry}>
          <RefreshCw />
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <UiEmpty className="py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox />
        </EmptyMedia>
        <EmptyTitle>
          <h3 className="text-base font-semibold">{title}</h3>
        </EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </UiEmpty>
  );
}
/** Kept for existing call sites; prefer StateBadge from page.tsx. */
export function Badge({ state }: { state: string }) {
  return <StateBadge state={state} />;
}
export function Stale({ error }: { error: unknown }) {
  return error ? (
    <Alert role="status" className="border-amber text-amber">
      <AlertDescription>
        Couldn’t refresh. Showing data from the last successful update.
      </AlertDescription>
    </Alert>
  ) : null;
}
