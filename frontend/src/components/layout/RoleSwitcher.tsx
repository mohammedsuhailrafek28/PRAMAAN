import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Repeat } from "lucide-react";

import { useToast } from "@/components/ui/use-toast";
import { useAuthStore } from "@/store/authStore";
import { homeForRole } from "@/lib/roles";
import type { Role } from "@/types";
import { cn } from "@/lib/utils";

const DEMO_PASSWORD = "password123";
const DEMO_IDENTITIES: { role: Role; label: string; sub: string; email: string }[] = [
  // Must match prisma/seed.ts demo accounts.
  { role: "msme", label: "Ravi Sharma", sub: "Sharma Textiles (MSME)", email: "msme@pramaan.demo" },
  { role: "buyer", label: "Ananya Iyer", sub: "Acme Retail Buyers (Buyer)", email: "buyer@pramaan.demo" },
  { role: "bank", label: "Karan Mehta", sub: "Kisan NBFC (Bank)", email: "bank@pramaan.demo" },
];

/**
 * Demo-only (rendered when VITE_DEMO_MODE=true). Lets whoever is running the demo jump between the three seeded accounts
 * instantly, without a real logout/login round trip — this is what makes
 * the MSME -> Buyer -> MSME -> Buyer demo flow fast to drive live.
 */
export function RoleSwitcher() {
  const [open, setOpen] = useState(false);
  const { currentUser, loginAs } = useAuthStore();
  const navigate = useNavigate();
  const { toast } = useToast();

  async function switchTo(identity: (typeof DEMO_IDENTITIES)[number]) {
    setOpen(false);
    try {
      const user = await loginAs(identity.email, DEMO_PASSWORD);
      navigate(homeForRole(user.role));
    } catch {
      toast({ title: "Couldn't switch role", description: "Is the demo data seeded? Try npm run demo:reset.", variant: "destructive" });
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Switch demo role"
        className="flex h-10 min-w-10 items-center justify-center gap-2 rounded-md border border-border bg-white px-2.5 text-sm font-medium sm:px-3 text-slate-700 shadow-subtle hover:bg-surface"
      >
        <Repeat className="h-3.5 w-3.5 text-primary-600" />
        <span className="hidden sm:inline">Switch demo role</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-64 rounded-md border border-border bg-white p-1.5 shadow-panel">
            {DEMO_IDENTITIES.map((identity) => (
              <button
                key={identity.role}
                onClick={() => void switchTo(identity)}
                className={cn(
                  "flex w-full flex-col items-start rounded-sm px-3 py-2 text-left text-sm hover:bg-surface",
                  currentUser?.role === identity.role && "bg-primary-50"
                )}
              >
                <span className="font-medium text-slate-800">{identity.label}</span>
                <span className="text-xs text-muted-foreground">{identity.sub}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
