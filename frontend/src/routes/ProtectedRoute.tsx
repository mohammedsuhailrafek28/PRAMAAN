import { Navigate, Outlet } from "react-router-dom";

import { useAuthStore } from "@/store/authStore";
import type { Role } from "@/types";

interface ProtectedRouteProps {
  allow?: Role[];
}

/** Redirects to /login when no mock session exists (or the wrong role is active). */
export function ProtectedRoute({ allow }: ProtectedRouteProps) {
  const { currentUser, hydrating } = useAuthStore();

  if (hydrating) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Restoring your Pramaan session...</div>;

  if (!currentUser) return <Navigate to="/login" replace />;
  if (allow && !allow.includes(currentUser.role)) return <Navigate to="/login" replace />;

  return <Outlet />;
}
