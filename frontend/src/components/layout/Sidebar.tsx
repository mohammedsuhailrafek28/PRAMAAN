import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Inbox,
  History,
  Archive,
  Search,
  Link2,
  Settings,
} from "lucide-react";

import { useAuthStore } from "@/store/authStore";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
}

const NAV_BY_ROLE: Record<string, NavItem[]> = {
  msme: [
    { to: "/msme/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/msme/evidence-vault", label: "Evidence", icon: Archive },
    { to: "/msme/consent-requests", label: "Requests", icon: Inbox },
    { to: "/msme/access", label: "Access", icon: Link2 },
    { to: "/msme/audit-log", label: "Activity", icon: History },
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

export function Sidebar() {
  const { currentUser } = useAuthStore();
  const items = currentUser ? NAV_BY_ROLE[currentUser.role] : [];

  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-white md:flex md:flex-col">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-700 text-sm font-bold text-white">
          P
        </div>
        <span className="text-base font-semibold tracking-tight text-slate-900">Pramaan</span>
      </div>
      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-surface hover:text-slate-900",
                isActive && "bg-primary-50 text-primary-700 hover:bg-primary-50 hover:text-primary-700"
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-border p-4 text-xs text-muted-foreground">
        Pramaan MVP · Frontend Demo
      </div>
    </aside>
  );
}
