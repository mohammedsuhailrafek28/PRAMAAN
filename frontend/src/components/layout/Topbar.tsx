import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, LogOut } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { RoleSwitcher } from "@/components/layout/RoleSwitcher";
import { useAuthStore } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";
import { timeAgo, cn } from "@/lib/utils";

const PAGE_TITLES: Record<string, string> = {
  "/msme/dashboard": "Dashboard",
  "/msme/verification": "Business Verification",
  "/msme/trust-profile": "Verification Profile",
  "/msme/consent-requests": "Consent Requests",
  "/msme/audit-log": "Audit Log",
  "/msme/settings": "Settings",
  "/buyer/dashboard": "Buyer Dashboard",
  "/buyer/settings": "Settings",
  "/bank/dashboard": "Bank / NBFC Dashboard",
  "/bank/settings": "Settings",
};

export function Topbar() {
  const { currentUser, logout } = useAuthStore();
  const { notifications, loadNotifications, markNotificationRead } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [bellOpen, setBellOpen] = useState(false);

  useEffect(() => {
    if (currentUser) loadNotifications(currentUser.id);
  }, [currentUser, loadNotifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const title = PAGE_TITLES[location.pathname] ?? "Pramaan";

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-white px-6">
      <h1 className="text-lg font-semibold text-slate-900">{title}</h1>

      <div className="flex items-center gap-3">
        <RoleSwitcher />

        <div className="relative">
          <button
            onClick={() => setBellOpen((v) => !v)}
            className="relative flex h-9 w-9 items-center justify-center rounded-md border border-border bg-white text-slate-600 hover:bg-surface"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary-600 text-[10px] font-semibold text-white">
                {unreadCount}
              </span>
            )}
          </button>

          {bellOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setBellOpen(false)} />
              <div className="absolute right-0 z-50 mt-2 w-80 rounded-md border border-border bg-white shadow-panel">
                <div className="border-b border-border px-4 py-2.5 text-sm font-semibold text-slate-800">
                  Notifications
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 && (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No notifications yet.
                    </p>
                  )}
                  {notifications.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => markNotificationRead(n.id)}
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 border-b border-border px-4 py-2.5 text-left text-sm last:border-b-0 hover:bg-surface",
                        !n.read && "bg-primary-50/60"
                      )}
                    >
                      <span className="text-slate-700">{n.message}</span>
                      <span className="text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-l border-border pl-3">
          <Avatar>
            <AvatarFallback>{currentUser?.avatarInitials}</AvatarFallback>
          </Avatar>
          <div className="hidden text-sm leading-tight lg:block">
            <p className="font-medium text-slate-800">{currentUser?.name}</p>
            <p className="text-xs text-muted-foreground">{currentUser?.orgName}</p>
          </div>
          <button
            onClick={() => {
              logout();
              navigate("/login");
            }}
            title="Log out"
            className="ml-1 flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-surface hover:text-slate-800"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
