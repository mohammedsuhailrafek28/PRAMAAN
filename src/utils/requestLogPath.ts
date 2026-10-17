const guestRoute = "/api/public/verify";
const guestRoutePattern = /\/api\/public\/verify(?:\/|$)/i;

export function sanitizeRequestLogPath(pathname: string) {
  const routeIndex = pathname.indexOf(guestRoute);
  if (routeIndex < 0) {
    try {
      if (guestRoutePattern.test(decodeURIComponent(pathname))) return "/api/public/verify/[redacted]";
    } catch {
      // A malformed encoding is not a reason to expose the original path.
      if (/%2fapi%2fpublic%2fverify(?:%2f|%3f|%23|$)/i.test(pathname)) return "/api/public/verify/[redacted]";
    }
    return pathname;
  }

  const boundary = pathname[routeIndex + guestRoute.length];
  if (boundary !== undefined && boundary !== "/" && boundary !== "?" && boundary !== "#") return pathname;

  // Redact the complete remainder, including malformed/encoded segments and query strings.
  return `${pathname.slice(0, routeIndex)}${guestRoute}/[redacted]`;
}
