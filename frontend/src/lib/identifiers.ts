// Business identifier schemas. Inputs are trimmed and upper-cased *before*
// validation, so lowercase typing is accepted and the submitted value is the
// canonical form (CSS `uppercase` alone only changes how it looks).

import { z } from "zod";

export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
export const UDYAM_PATTERN = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function normalizeIdentifier(value: string): string {
  return value.trim().toUpperCase();
}

const identifier = (pattern: RegExp, message: string) => z.string().trim().toUpperCase().regex(pattern, message);

export const gstinSchema = identifier(GSTIN_PATTERN, "GSTIN must be a valid 15-character GSTIN");
export const udyamSchema = identifier(UDYAM_PATTERN, "Format: UDYAM-XX-00-0000000");
export const panSchema = identifier(PAN_PATTERN, "PAN must be 10 characters, e.g. ABCDE1234F");
