import {
  Archive,
  Building2,
  History,
  KeyRound,
  Layers,
  LayoutDashboard,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/types";

/** Every MSME/verifier route in one place, so links can't drift from the router. */
export const ROUTES = {
  dashboard: "/msme/dashboard",
  businessProfile: "/msme/verification",
  evidence: "/msme/evidence-vault",
  trustProfile: "/msme/trust-profile",
  consent: "/msme/consent",
  secureLinks: "/msme/consent?tab=links",
  readiness: "/msme/readiness",
  reports: "/msme/reports",
  activity: "/msme/audit-log",
  msmeSettings: "/msme/settings",
} as const;

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export const NAV_BY_ROLE: Record<Role, NavSection[]> = {
  msme: [
    { items: [{ to: ROUTES.dashboard, label: "Dashboard", icon: LayoutDashboard }] },
    {
      label: "Trust",
      items: [
        { to: ROUTES.businessProfile, label: "Business Profile", icon: Building2 },
        { to: ROUTES.evidence, label: "Evidence", icon: Archive },
        { to: ROUTES.trustProfile, label: "Trust Profile", icon: Layers },
      ],
    },
    {
      label: "Sharing",
      items: [
        { to: ROUTES.consent, label: "Consent & Access", icon: KeyRound },
        { to: ROUTES.activity, label: "Activity", icon: History },
      ],
    },
    { label: "Account", items: [{ to: ROUTES.msmeSettings, label: "Settings", icon: Settings }] },
  ],
  buyer: [
    { items: [{ to: "/buyer/dashboard", label: "Verification Workspace", icon: Search }] },
    { label: "Account", items: [{ to: "/buyer/settings", label: "Settings", icon: Settings }] },
  ],
  bank: [
    { items: [{ to: "/bank/dashboard", label: "Verification Workspace", icon: Search }] },
    { label: "Account", items: [{ to: "/bank/settings", label: "Settings", icon: Settings }] },
  ],
};

/** Short context shown in the top bar (pages render their own h1). */
export function workspaceLabel(role: Role): string {
  return role === "msme" ? "MSME workspace" : role === "bank" ? "Lender workspace" : "Buyer workspace";
}
