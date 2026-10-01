import {
  Archive,
  Building2,
  History,
  Inbox,
  Layers,
  LayoutDashboard,
  Link2,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/types";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  msme: [
    { to: "/msme/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/msme/verification", label: "Business Profile", icon: Building2 },
    { to: "/msme/evidence-vault", label: "Evidence", icon: Archive },
    { to: "/msme/trust-profile", label: "Trust Profile", icon: Layers },
    { to: "/msme/consent-requests", label: "Requests", icon: Inbox },
    { to: "/msme/access", label: "Access", icon: Link2 },
    { to: "/msme/audit-log", label: "Activity", icon: History },
    { to: "/msme/settings", label: "Settings", icon: Settings },
  ],
  buyer: [
    { to: "/buyer/dashboard", label: "Verification Workspace", icon: Search },
    { to: "/buyer/settings", label: "Settings", icon: Settings },
  ],
  bank: [
    { to: "/bank/dashboard", label: "Verification Workspace", icon: Search },
    { to: "/bank/settings", label: "Settings", icon: Settings },
  ],
};

const PAGE_TITLES: Record<string, string> = {
  "/msme/dashboard": "Dashboard",
  "/msme/verification": "Business Profile",
  "/msme/evidence-vault": "Evidence Vault",
  "/msme/trust-profile": "Trust Profile",
  "/msme/consent-requests": "Consent Requests",
  "/msme/access": "Access",
  "/msme/audit-log": "Activity",
  "/msme/settings": "Settings",
  "/buyer/dashboard": "Verification Workspace",
  "/buyer/settings": "Settings",
  "/bank/dashboard": "Verification Workspace",
  "/bank/settings": "Settings",
};

export function pageTitle(pathname: string): string {
  if (pathname.startsWith("/trust-view/")) return "Trust View";
  return PAGE_TITLES[pathname] ?? "Pramaan";
}
