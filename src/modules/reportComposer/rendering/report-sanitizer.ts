const controlChars = /[\u0000-\u001f\u007f]/g;

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(controlChars, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function text(value: unknown, fallback = "Not provided") {
  const normalized = String(value ?? "").trim();
  return escapeHtml(normalized || fallback);
}

export function safeFilename(value: unknown, fallback = "pramaan-report") {
  const base = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || fallback;
}

export function stripPath(filename: unknown) {
  const raw = String(filename ?? "").replace(/\\/g, "/");
  return raw.split("/").pop() ?? "";
}

export function safeJsonValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function maskSensitive(field: unknown, value: unknown) {
  const fieldName = String(field ?? "").toLowerCase();
  const raw = String(value ?? "");
  if (!raw) return "";

  if (fieldName.includes("bank") || fieldName.includes("account")) {
    return raw.length <= 4 ? "****" : `${"*".repeat(Math.max(4, raw.length - 4))}${raw.slice(-4)}`;
  }

  return raw;
}

export function clampScore(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
}
