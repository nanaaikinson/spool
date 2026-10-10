import "@aejkatappaja/phantom-ui";
import type { ReactNode } from "react";
/**
 * Structure-aware skeleton: renders the real children (with placeholder data
 * while loading) and shimmers over every text, image and control it measures.
 * Colors come from theme tokens, so the shimmer follows light and dark mode.
 */
export function Phantom({
  loading,
  count,
  label = "Loading",
  className,
  children,
}: {
  loading: boolean;
  /** Repeat the single child as this many skeleton rows (for lists). */
  count?: number;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <phantom-ui
      loading={loading}
      count={count}
      shimmer-color="var(--phantom-shimmer)"
      background-color="var(--phantom-block)"
      fallback-radius={4}
      reveal={0.2}
      loading-label={label}
      className={className}
    >
      {children}
    </phantom-ui>
  );
}
