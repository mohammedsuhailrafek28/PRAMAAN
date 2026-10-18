// Formats disclosed Trust Profile fields (registered Trust View and secure
// links). Backend contract (5be69e6): each field is
// { value, status, evidenceStatus, source, lastCheckedAt, freshnessState }.
// A field only carries a status when the backend reported one.

import { backendFieldLabel } from "@/lib/fieldLabels";
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

const SUMMARY_METRICS: [string, string][] = [
  ["trustReadiness", "Trust readiness"],
  ["profileCompleteness", "Completeness"],
  ["evidenceStrength", "Evidence strength"],
  ["consistency", "Consistency"],
  ["freshness", "Freshness"],
];

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export function formatSharedField(key: string, raw: unknown): SharedField {
  const label = backendFieldLabel(key);
  const wrapped = isRecord(raw) && "value" in raw;
  const value = wrapped ? raw.value : raw;
  const meta = wrapped ? raw : {};

  // Trust summary is computed by Pramaan; the backend currently tags it
  // SELF_DECLARED / MSME_SUBMITTED, so no status or source is shown for it.
  if (key === "summary" && isRecord(value)) {
    return {
      key,
      label,
      value: typeof value.trustReadiness === "number" ? `${value.trustReadiness}% trust readiness` : "Summary",
      items: SUMMARY_METRICS.filter(([metric]) => typeof value[metric] === "number").map(([metric, metricLabel]) => ({ label: metricLabel, detail: `${value[metric]}%` })),
      lastCheckedAt: str(meta.lastCheckedAt),
      computed: true,
    };
  }

  return {
    key,
    label,
    value: toText(value),
    status: str(meta.status) ?? str(meta.evidenceStatus),
    source: str(meta.source),
    lastCheckedAt: str(meta.lastCheckedAt),
    freshnessState: str(meta.freshnessState),
  };
}

export function formatSharedFields(sharedFields: unknown): SharedField[] {
  if (!isRecord(sharedFields)) return [];
  return Object.entries(sharedFields).map(([key, value]) => formatSharedField(key, value));
}
