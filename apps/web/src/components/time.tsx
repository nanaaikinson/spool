import { relative, useClock } from "../lib/time";
import { date } from "../lib/utils";
/** Relative timestamp that keeps itself current; the exact time is on hover. */
export function Time({
  value,
  empty = "—",
}: {
  value?: string | null;
  empty?: string;
}) {
  const now = useClock();
  if (!value) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <time dateTime={value} title={date(value)} className="tabular-nums">
      {relative(value, now)}
    </time>
  );
}
