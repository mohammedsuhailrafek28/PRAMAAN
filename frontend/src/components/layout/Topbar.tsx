import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, LogOut } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { RoleSwitcher } from "@/components/layout/RoleSwitcher";
import { DEMO_MODE } from "@/lib/demoMode";
import { MobileNav } from "@/components/layout/MobileNav";
import { ROUTES, workspaceLabel } from "@/components/layout/navigation";
import { useAuthStore } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";
import { timeAgo, cn } from "@/lib/utils";
import type { Notification } from "@/types";

/** Workspace context, notifications and account. Pages own their h1 (PageHeader). */
export function Topbar() {
  const { currentUser, logout } = useAuthStore();
  const { notifications, loadNotifications, markNotificationRead } = useAppStore();
  const navigate = useNavigate();
  const [bellOpen, setBellOpen] = useState(false);
  const bellButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (currentUser) loadNotifications();
  }, [currentUser, loadNotifications]);

  useEffect(() => {
    if (!bellOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setBellOpen(false); bellButton.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [bellOpen]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  function openNotification(notification: Notification) {
    void markNotificationRead(notification.id);
    setBellOpen(false);
    if (!notification.relatedConsentId || !currentUser) return;
    navigate(currentUser.role === "msme" ? ROUTES.consent : `/trust-view/${notification.relatedConsentId}`);
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border bg-white/95 px-3 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <MobileNav />
        {currentUser && (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-slate-900">{currentUser.orgName}</p>
            <p className="truncate text-xs text-slate-500">{workspaceLabel(currentUser.role)}</p>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {DEMO_MODE && <RoleSwitcher />}

        <div className="relative">
          <button
            ref={bellButton}
            onClick={() => setBellOpen((v) => !v)}
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
            aria-expanded={bellOpen}
            aria-haspopup="true"
            className="relative flex h-10 w-10 items-center justify-center rounded-md border border-border bg-white text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Bell className="h-4 w-4" aria-hidden />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary-700 px-1 text-[10px] font-semibold text-white" aria-hidden>
                {unreadCount}
              </span>
            )}
          </button>

          {bellOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setBellOpen(false)} aria-hidden />
              <div role="dialog" aria-label="Notifications" className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-border bg-white shadow-raised">
                <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-900">Notifications</div>
                <ul className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">You're all caught up.</li>}
                  {notifications.map((n) => (
                    <li key={n.id} className="border-b border-border last:border-b-0">
                      <button
                        onClick={() => openNotification(n)}
                        className={cn("flex w-full gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none", !n.read && "bg-info-bg/60")}
                      >
                        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-primary-700")} aria-hidden />
                        <span className="min-w-0">
                          <span className="block text-slate-800">{n.message}</span>
                          <span className="mt-0.5 block text-xs text-slate-500">{timeAgo(n.createdAt)}{!n.read && <span className="sr-only">, unread</span>}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-l border-border pl-2 sm:pl-3">
          <Avatar className="hidden h-9 w-9 sm:flex">
            <AvatarFallback className="bg-primary-50 text-xs font-semibold text-primary-800">{currentUser?.avatarInitials}</AvatarFallback>
          </Avatar>
          <div className="hidden text-sm leading-tight lg:block">
            <p className="font-medium text-slate-900">{currentUser?.name}</p>
            <p className="text-xs text-slate-500">{currentUser?.email}</p>
          </div>
          <button
            onClick={() => { logout(); navigate("/login"); }}
            title="Log out"
            aria-label="Log out"
            className="flex h-10 w-10 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LogOut className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </header>
  );
}
