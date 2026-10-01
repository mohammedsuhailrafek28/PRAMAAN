import type { Prisma } from "@prisma/client";
import { DISCLOSURE_FIELD_KEYS } from "./disclosureCatalogue.js";

export const allowedPassportFields = DISCLOSURE_FIELD_KEYS;

export type PassportField = string;

export function filterPassportFields(snapshot: Prisma.JsonValue, fields: string[]) {
  const source = snapshot as Record<string, unknown>;
  return fields.reduce<Record<string, unknown>>((acc, field) => {
    if (allowedPassportFields.includes(field) && field in source) {
      const raw = source[field];
      if (raw && typeof raw === "object" && "value" in raw) {
        const record = raw as Record<string, unknown>;
        const checks = Array.isArray(record.checks) ? record.checks : [];
        acc[field] = {
          value: record.value,
          status: record.evidenceStatus,
          evidenceStatus: record.evidenceStatus,
          source: "INTERNAL_DETERMINISTIC_CHECKS",
          lastCheckedAt: source.lastCalculatedAt,
          freshnessState: checks.some((check) => check && typeof check === "object" && (check as Record<string, unknown>).type === "EXPIRED_EVIDENCE") ? "EXPIRED" : "CURRENT"
        };
      } else {
        acc[field] = { value: raw, status: "SELF_DECLARED", evidenceStatus: "SELF_DECLARED", source: "MSME_SUBMITTED", lastCheckedAt: source.lastCalculatedAt, freshnessState: "CURRENT" };
      }
    }
    return acc;
  }, {});
}

export function maskPan(pan?: string | null) {
  if (!pan || pan.length < 5) return null;
  return `${pan.slice(0, 3)}XXXX${pan.slice(-1)}`;
}
