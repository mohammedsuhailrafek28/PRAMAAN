import { Outlet } from "react-router-dom";

import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";

/** Shared shell for every authenticated screen: sidebar + topbar + content. */
export function AppLayout() {
  return (
    <div className="flex h-screen w-full bg-slate-50">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-800 focus:shadow-raised"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto px-4 py-6 focus:outline-none sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
