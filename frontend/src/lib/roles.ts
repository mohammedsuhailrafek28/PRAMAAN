// Role -> home route mapping, shared by login, register and route guards.
// Dependency-free so it can be unit-tested without the app runtime.

export type AppRole = "msme" | "buyer" | "bank";

export const ROLE_HOME: Record<AppRole, string> = {
  msme: "/msme/dashboard",
  buyer: "/buyer/dashboard",
  bank: "/bank/dashboard",
};

export function isAppRole(value: unknown): value is AppRole {
  return value === "msme" || value === "buyer" || value === "bank";
}

/** Where a signed-in user belongs. Always derived from the authenticated user, never from a UI tab. */
export function homeForRole(role: AppRole): string {
  return ROLE_HOME[role];
}

/** Safe parse of a `?role=` query value; anything unrecognised falls back to MSME. */
export function parseRoleParam(value: string | null | undefined): AppRole {
  return isAppRole(value) ? value : "msme";
}
