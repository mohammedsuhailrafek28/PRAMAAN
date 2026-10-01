import { NavLink } from "react-router-dom";

import { NAV_BY_ROLE } from "@/components/layout/navigation";
import { useAuthStore } from "@/store/authStore";
import { cn } from "@/lib/utils";

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-800 text-sm font-bold text-white shadow-subtle" aria-hidden>
        P
      </div>
      <div className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight text-slate-900">Pramaan</span>
        <span className="block text-[11px] text-slate-500">Consent-based business trust</span>
      </div>
    </div>
  );
}

/** Role-specific navigation, shared by the desktop sidebar and the mobile drawer. */
export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { currentUser } = useAuthStore();
  const sections = currentUser ? NAV_BY_ROLE[currentUser.role] : [];

  return (
    <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-5">
      {sections.map((section, index) => (
        <div key={section.label ?? index}>
          {section.label && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{section.label}</p>}
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "relative flex min-h-10 items-center gap-2.5 rounded-md px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive && "bg-primary-50 text-primary-800 hover:bg-primary-50 hover:text-primary-800 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-primary-700"
                    )
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function SidebarFooter() {
  return (
    <div className="border-t border-border px-5 py-4 text-[11px] leading-5 text-slate-500">
      Demo environment · internal cross-checks only, no government systems queried
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-border bg-white md:flex md:flex-col">
      <div className="flex h-16 items-center border-b border-border px-5">
        <Brand />
      </div>
      <NavLinks />
      <SidebarFooter />
    </aside>
  );
}
