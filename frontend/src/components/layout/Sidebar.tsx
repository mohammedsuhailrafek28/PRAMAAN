import { NavLink } from "react-router-dom";

import { NAV_BY_ROLE } from "@/components/layout/navigation";
import { useAuthStore } from "@/store/authStore";
import { cn } from "@/lib/utils";

export function Brand() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-700 text-sm font-bold text-white" aria-hidden>
        P
      </div>
      <span className="text-base font-semibold tracking-tight text-slate-900">Pramaan</span>
    </div>
  );
}

/** Role-specific navigation links, shared by the desktop sidebar and the mobile drawer. */
export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { currentUser } = useAuthStore();
  const items = currentUser ? NAV_BY_ROLE[currentUser.role] : [];

  return (
    <nav aria-label="Main" className="flex-1 space-y-0.5 px-3 py-4">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-surface hover:text-slate-900",
              isActive && "bg-primary-50 text-primary-700 hover:bg-primary-50 hover:text-primary-700"
            )
          }
        >
          <item.icon className="h-4 w-4" aria-hidden />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function SidebarFooter() {
  return <div className="border-t border-border p-4 text-xs text-muted-foreground">Pramaan · Demo environment</div>;
}

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-white md:flex md:flex-col">
      <div className="flex h-16 items-center border-b border-border px-5">
        <Brand />
      </div>
      <NavLinks />
      <SidebarFooter />
    </aside>
  );
}
