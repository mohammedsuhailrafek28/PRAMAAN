const guestTokenPath = /\/api\/public\/verify\/[A-Za-z0-9_-]{40,}(?=[/?]|$)/;

export function sanitizeRequestLogPath(pathname: string) {
  return pathname.replace(guestTokenPath, "/api/public/verify/[redacted]");
}
