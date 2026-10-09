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
    <Card className="summary-card">
      <CardHeader className="summary-heading">
        <span className="summary-icon">{icon}</span>
        <div>
          <CardTitle>
            <h2>{label}</h2>
          </CardTitle>
          <CardDescription className="muted small">{note}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="summary-value">{value}</CardContent>
      <CardFooter className="summary-detail">{children}</CardFooter>
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
      <div className="snapshot-bar" aria-hidden="true">
        {segments.map((segment) =>
          segment.value > 0 ? (
            <span
              key={segment.label}
              style={{
                flex: segment.value,
                background: `var(--${segment.color})`,
              }}
            />
          ) : null,
        )}
      </div>
      <div className="snapshot-legend">
        {segments.map((segment) => (
          <span key={segment.label}>
            <i style={{ background: `var(--${segment.color})` }} />
            {number(segment.value)} {segment.label}
          </span>
        ))}
        {!total && <span className="screen-reader">No recorded activity</span>}
      </div>
    </div>
  );
}
