import { Navigate, Outlet } from "react-router-dom";

import { useAuthStore } from "@/store/authStore";
import { homeForRole } from "@/lib/roles";
import type { Role } from "@/types";

interface ProtectedRouteProps {
  allow?: Role[];
}

/** Sends signed-out users to /login, and signed-in users with the wrong role to their own home. */
export function ProtectedRoute({ allow }: ProtectedRouteProps) {
  const { currentUser, hydrating } = useAuthStore();

  if (hydrating) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Restoring your Pramaan session...</div>;

  if (!currentUser) return <Navigate to="/login" replace />;
  if (allow && !allow.includes(currentUser.role)) return <Navigate to={homeForRole(currentUser.role)} replace />;

  return <Outlet />;
}
