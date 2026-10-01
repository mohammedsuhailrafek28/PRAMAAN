import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Repeat } from "lucide-react";

import { useAuthStore } from "@/store/authStore";
import type { Role } from "@/types";
import { cn } from "@/lib/utils";

const DEMO_IDENTITIES: { role: Role; label: string; sub: string }[] = [
  { role: "msme", label: "Rajeev Sharma", sub: "Sharma Textiles (MSME)" },
  { role: "buyer", label: "Priya Nair", sub: "Acme Retail Buyers" },
  { role: "bank", label: "Vikram Rao", sub: "Kisan NBFC" },
];

/**
 * Lets whoever is running the demo jump between the three seeded accounts
 * instantly, without a real logout/login round trip — this is what makes
 * the MSME -> Buyer -> MSME -> Buyer demo flow fast to drive live.
 */
export function RoleSwitcher() {
  const [open, setOpen] = useState(false);
  const { currentUser, loginAs } = useAuthStore();
  const navigate = useNavigate();

  async function switchTo(role: Role) {
    await loginAs(role);
    setOpen(false);
    navigate(role === "msme" ? "/msme/dashboard" : role === "buyer" ? "/buyer/dashboard" : "/bank/dashboard");
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-subtle hover:bg-surface"
      >
        <Repeat className="h-3.5 w-3.5 text-primary-600" />
        Switch demo role
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-64 rounded-md border border-border bg-white p-1.5 shadow-panel">
            {DEMO_IDENTITIES.map((identity) => (
              <button
                key={identity.role}
                onClick={() => switchTo(identity.role)}
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
