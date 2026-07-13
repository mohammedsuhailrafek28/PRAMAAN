export const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const udyamRegex = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;

export const requiredClaimFields = [
  "legalBusinessName",
  "ownerName",
  "gstin",
  "pan",
  "udyamNumber",
  "address",
  "turnoverBand"
] as const;

export function normalizeIdentityValue(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(PRIVATE LIMITED|PVT LTD|PVT|LIMITED|LTD|LLP)\b/g, "")
    .trim();
}

export function panFromGstin(gstin: string | null | undefined) {
  if (!gstin || gstin.length < 12) return null;
  return gstin.slice(2, 12);
}
