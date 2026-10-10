import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { errorMessage } from "../api/client";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge as UiBadge } from "./ui/badge";
import { Card } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import {
  Empty as UiEmpty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "./ui/empty";
export function Loading({ rows = 5 }: { rows?: number }) {
  return (
    <Card aria-label="Loading data" role="status" className="section">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i}>
          {[0, 1, 2, 3].map((j) => (
            <Skeleton className="h-4" key={j} />
          ))}
        </div>
      ))}
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
          <h3>{title}</h3>
        </EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </UiEmpty>
  );
}
export function Badge({ state }: { state: string }) {
  return (
    <UiBadge variant="outline" className={`badge ${state}`}>
      {state}
    </UiBadge>
  );
}
export function Stale({ error }: { error: unknown }) {
  return error ? (
    <Alert role="status" className="border-[var(--amber)] text-[var(--amber)]">
      <AlertDescription>
        Couldn’t refresh. Showing data from the last successful update.
      </AlertDescription>
    </Alert>
  ) : null;
}
