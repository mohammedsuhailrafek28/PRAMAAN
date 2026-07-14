import type { Prisma } from "@prisma/client";

export const allowedPassportFields = [
  "legalBusinessName",
  "ownerName",
  "gstin",
  "udyamNumber",
  "pan",
  "address",
  "turnoverBand",
  "bankAccount",
  "summary",
  "fieldConfidence",
  "documentConfidence",
  "gaps",
  "contradictions",
  "limitations",
  "sourceVerificationPerformed",
  "lastCalculatedAt",
  "generatedAt",
  "version"
] as const;

export type PassportField = (typeof allowedPassportFields)[number];

export function filterPassportFields(snapshot: Prisma.JsonValue, fields: string[]) {
  const source = snapshot as Record<string, unknown>;
  return fields.reduce<Record<string, unknown>>((acc, field) => {
    if (allowedPassportFields.includes(field as PassportField) && field in source) {
      acc[field] = source[field];
    }
    return acc;
  }, {});
}

export function maskPan(pan?: string | null) {
  if (!pan || pan.length < 5) return null;
  return `${pan.slice(0, 3)}XXXX${pan.slice(-1)}`;
}
