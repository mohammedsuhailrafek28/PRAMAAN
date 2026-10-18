import { safeJsonValue } from "./report-sanitizer.js";

export function formatDateTime(value: unknown) {
  if (!value) return "Not provided";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

export function humanize(value: unknown) {
  return String(value ?? "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || "Not provided";
}

export function asArray(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as Array<Record<string, any>> : [];
}

export function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => safeJsonValue(item)).filter(Boolean) : [];
}

export function percentWidth(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0%";
  return `${Math.max(0, Math.min(100, Math.round(number)))}%`;
}
