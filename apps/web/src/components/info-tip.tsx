import type { ReactNode } from "react";
import { Info, RefreshCw } from "lucide-react";
import { Popover } from "radix-ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Button } from "./ui/button";
/**
 * Secondary explanation kept out of the layout until asked for. A popover, not
 * a tooltip, so it also opens on tap.
 */
export function InfoTip({
  children,
  label = "More information",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="info-tip" aria-label={label}>
          <Info size={14} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="info-tip-content"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={16}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
