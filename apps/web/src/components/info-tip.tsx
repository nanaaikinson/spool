import type { ReactNode } from "react";
import { Info, RefreshCw } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
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
      <Popover.Trigger
        className="-my-0.5 inline-grid size-6 place-items-center rounded-full border-0 bg-transparent p-0 align-middle text-muted-foreground hover:bg-hover hover:text-foreground data-popup-open:bg-hover data-popup-open:text-foreground"
        aria-label={label}
      >
        <Info size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="z-50"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={16}
        >
          <Popover.Popup className="max-w-[min(320px,calc(100vw-32px))] rounded-lg border bg-surface-raised p-3 text-xs/[1.55] font-normal tracking-normal text-foreground normal-case shadow-overlay outline-none">
            {children}
          </Popover.Popup>
        </Popover.Positioner>
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
      <TooltipTrigger
        render={
          <Button
            variant="secondary"
            size="icon"
            onClick={onClick}
            disabled={pending}
            aria-label="Refresh"
          />
        }
      >
        <RefreshCw size={14} className={pending ? "animate-spin" : undefined} />
      </TooltipTrigger>
      <TooltipContent>Refresh</TooltipContent>
    </Tooltip>
  );
}
