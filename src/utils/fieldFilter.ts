import type { Prisma } from "@prisma/client";
import { DISCLOSURE_FIELD_KEYS, disclosureFieldValue } from "./disclosureCatalogue.js";

export const allowedPassportFields = DISCLOSURE_FIELD_KEYS;

export type PassportField = string;

export function filterPassportFields(snapshot: Prisma.JsonValue, fields: string[]) {
  const source = snapshot as Record<string, unknown>;
  return fields.reduce<Record<string, unknown>>((acc, field) => {
    if (allowedPassportFields.includes(field) && field in source) {
      acc[field] = disclosureFieldValue(snapshot, field);
    }
    return acc;
  }, {});
}

export function maskPan(pan?: string | null) {
  if (!pan || pan.length < 5) return null;
  return `${pan.slice(0, 3)}XXXX${pan.slice(-1)}`;
}
