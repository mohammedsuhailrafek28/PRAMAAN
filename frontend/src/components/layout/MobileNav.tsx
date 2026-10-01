import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";

import { Brand, NavLinks, SidebarFooter } from "@/components/layout/Sidebar";

/** Slide-in navigation drawer for screens narrower than the `md` breakpoint. */
export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-white text-slate-600 hover:bg-surface md:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-4 w-4" />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-900/40 md:hidden" />
        <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-white shadow-panel focus:outline-none md:hidden">
          <div className="flex h-16 items-center justify-between border-b border-border px-5">
            <DialogPrimitive.Title asChild><div><Brand /></div></DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Main navigation</DialogPrimitive.Description>
            <DialogPrimitive.Close className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-surface" aria-label="Close navigation">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <NavLinks onNavigate={() => setOpen(false)} />
          <SidebarFooter />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
