import type { ReactNode, RefObject } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";

import { useSession } from "../features/session";
import { InstanceIdentity } from "../features/deployment";

// Keep operational confirmations open until the mutation succeeds or is cancelled.
export function OperationDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  kind = "confirm",
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  kind?: "confirm" | "form";
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const session = useSession();
  const identity = (
    <div className="border-l-2 border-amber pl-3">
      <InstanceIdentity session={session.data} />
    </div>
  );
  if (kind === "form")
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent finalFocus={finalFocus}>
          <DialogHeader>
            {identity}
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    );
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent finalFocus={finalFocus}>
        <AlertDialogHeader>
          {identity}
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
      </AlertDialogContent>
    </AlertDialog>
  );
}
