// Read-model helpers for presenting one Trust Profile snapshot.

import type { FieldCheck, TrustProfile } from "@/types";

/** Snapshot fields in the order a reader expects, with display rules. */
export const TRUST_FIELDS: { field: string; label: string; mono?: boolean; mask?: boolean }[] = [
  { field: "legalBusinessName", label: "Legal business name" },
  { field: "ownerName", label: "Owner name" },
  { field: "gstin", label: "GSTIN", mono: true },
  { field: "udyamNumber", label: "Udyam number", mono: true },
  { field: "pan", label: "PAN", mono: true, mask: true },
  { field: "address", label: "Business address" },
  { field: "turnoverBand", label: "Turnover band" },
  { field: "bankAccount", label: "Bank account" },
];

export const SUMMARY_METRICS: { key: "profileCompleteness" | "evidenceStrength" | "consistency" | "freshness"; label: string; hint: string }[] = [
  { key: "profileCompleteness", label: "Completeness", hint: "Required claims and evidence present" },
  { key: "evidenceStrength", label: "Evidence strength", hint: "Support level across submitted evidence" },
  { key: "consistency", label: "Consistency", hint: "Penalised by detected contradictions" },
  { key: "freshness", label: "Freshness", hint: "Share of evidence that is not expired" },
];

/**
 * Same rule the backend uses for disclosed fields (src/utils/fieldFilter.ts):
 * a field is stale when one of its checks reports EXPIRED_EVIDENCE.
 */
export function fieldFreshness(check: FieldCheck): "CURRENT" | "EXPIRED" {
  return check.checks.some((item) => item.type === "EXPIRED_EVIDENCE") ? "EXPIRED" : "CURRENT";
}

export function fieldValueText(value: unknown, mask = false): string {
  if (value === null || value === undefined || value === "") return "Not provided";
  const text = typeof value === "string" ? value : typeof value === "number" ? String(value) : "Provided";
  return mask && text.length >= 5 ? `${text.slice(0, 3)}XXXX${text.slice(-1)}` : text;
}

export function checkCounts(profile: TrustProfile) {
  const evaluated = profile.fields.filter((field) => field.value !== null && field.value !== undefined && field.value !== "");
  return {
    total: profile.fields.length,
    provided: evaluated.length,
    crossChecked: profile.fields.filter((field) => field.status === "CROSS_CHECKED" || field.status === "SOURCE_VERIFIED").length,
    conflicts: profile.contradictions.length,
    gaps: profile.gaps.length,
  };
}
