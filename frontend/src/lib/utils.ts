import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names safely, resolving conflicts (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Parse an ISO timestamp, returning null for missing or invalid input. */
export function parseDate(iso?: string | null): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format an ISO date string into a short, readable timestamp ("—" if unknown). */
export function formatDateTime(iso?: string | null): string {
  const date = parseDate(iso);
  if (!date) return "—";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format an ISO date string into just the date ("—" if unknown). */
export function formatDate(iso?: string | null): string {
  const date = parseDate(iso);
  if (!date) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Human-readable relative time, e.g. "3 minutes ago". */
export function timeAgo(iso?: string | null): string {
  const date = parseDate(iso);
  if (!date) return "—";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Human-readable countdown until an ISO timestamp, or "Expired" if past. */
export function timeUntil(iso?: string | null): string {
  const date = parseDate(iso);
  if (!date) return "—";
  const ms = date.getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} left`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} left`;
}

/** "1 day", "7 days", "30 days". */
export function formatDurationDays(days?: number | null): string {
  if (!days) return "—";
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** Mask a PAN for display: ABCDE1234F -> ABCXXXXF (first 3, last 1). */
export function maskPan(pan?: string | null): string {
  if (!pan || pan.length < 5) return "—";
  return `${pan.slice(0, 3)}XXXX${pan.slice(-1)}`;
}
