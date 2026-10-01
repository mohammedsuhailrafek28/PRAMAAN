import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** Destructive actions (revoke, decline) use the destructive button style. */
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
}

/** A deliberate second step for consequential actions. Focus starts on Cancel. */
export function ConfirmDialog({ open, title, description, confirmLabel, destructive = false, onConfirm, onOpenChange }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try { await onConfirm(); onOpenChange(false); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild><div className="space-y-2 text-sm text-slate-600">{description}</div></DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" autoFocus onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={() => void confirm()} disabled={busy}>{busy ? "Working…" : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
