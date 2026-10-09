import type { ReactNode } from "react";
import { Info, RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Button } from "./ui/button";
/** Secondary explanation kept out of the layout until asked for. */
export function InfoTip({
  children,
  label = "More information",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="info-tip" aria-label={label}>
          <Info size={14} />
        </button>
      </TooltipTrigger>
      <TooltipContent className="info-tip-content">{children}</TooltipContent>
    </Tooltip>
  );
}
export function RefreshButton({
  onClick,
  pending = false,
}: {
  onClick: () => void;
  pending?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          onClick={onClick}
          disabled={pending}
          aria-label="Refresh"
        >
          <RefreshCw
            size={14}
            className={pending ? "animate-spin" : undefined}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Refresh</TooltipContent>
    </Tooltip>
  );
}
