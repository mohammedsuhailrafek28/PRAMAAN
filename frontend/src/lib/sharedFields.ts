// Formats values disclosed from a Trust Profile snapshot (registered Trust View
// and guest links) without inventing status: a field only carries a status
// when the snapshot itself recorded one.

import { backendFieldLabel, documentTypeLabel } from "@/lib/fieldLabels";
import type { SharedField } from "@/types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not provided";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "Structured value";
}

function formatSummary(summary: UnknownRecord): SharedField["items"] {
  const metrics: [string, string][] = [
    ["trustReadiness", "Trust readiness"],
    ["profileCompleteness", "Profile completeness"],
    ["evidenceStrength", "Evidence strength"],
    ["consistency", "Consistency"],
    ["freshness", "Freshness"],
  ];
  return metrics
    .filter(([key]) => typeof summary[key] === "number")
    .map(([key, label]) => ({ label, detail: `${summary[key]}%` }));
}

export function formatSharedField(key: string, raw: unknown): SharedField {
  const label = backendFieldLabel(key);

  if (key === "summary" && isRecord(raw)) {
    const readiness = typeof raw.trustReadiness === "number" ? `${raw.trustReadiness}% trust readiness` : "Summary";
    return { key, label, value: readiness, items: formatSummary(raw) };
  }

  if (key === "documentConfidence" && Array.isArray(raw)) {
    return {
      key,
      label,
      value: `${raw.length} document${raw.length === 1 ? "" : "s"} checked`,
      items: raw.filter(isRecord).map((doc) => ({
        label: documentTypeLabel(String(doc.documentType ?? "Document")),
        status: typeof doc.status === "string" ? doc.status : undefined,
        detail: typeof doc.reason === "string" ? doc.reason : undefined,
      })),
    };
  }

  if (Array.isArray(raw)) {
    return {
      key,
      label,
      value: `${raw.length} item${raw.length === 1 ? "" : "s"}`,
      items: raw.map((item) =>
        isRecord(item)
          ? {
              label: backendFieldLabel(String(item.field ?? item.type ?? "Item")),
              status: typeof item.status === "string" ? item.status : undefined,
              detail: String(item.message ?? item.reason ?? toText(item.value)),
            }
          : { label: toText(item) }
      ),
    };
  }

  // Snapshot claim shape: { value, evidenceStatus, confidence, confidenceReason, ... }
  if (isRecord(raw) && "value" in raw) {
    return {
      key,
      label,
      value: toText(raw.value),
      status: typeof raw.evidenceStatus === "string" ? raw.evidenceStatus : undefined,
      reason: typeof raw.confidenceReason === "string" ? raw.confidenceReason : undefined,
    };
  }

  return { key, label, value: toText(raw) };
}

export function formatSharedFields(sharedFields: unknown): SharedField[] {
  if (!isRecord(sharedFields)) return [];
  return Object.entries(sharedFields).map(([key, value]) => formatSharedField(key, value));
}

