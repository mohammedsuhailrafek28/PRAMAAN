import { DocumentType } from "@prisma/client";

export type DisclosureKind = "FIELD" | "EVIDENCE";
export type DisclosureItem = { key: string; label: string; category: "IDENTITY" | "BUSINESS" | "COMPLIANCE" | "EVIDENCE"; sensitivity: "LOW" | "MEDIUM" | "HIGH"; kind: DisclosureKind; passportKey?: string; documentType?: DocumentType };

export const DISCLOSURE_CATALOGUE: readonly DisclosureItem[] = [
  { key: "legalBusinessName", label: "Legal business name", category: "IDENTITY", sensitivity: "LOW", kind: "FIELD", passportKey: "legalBusinessName" },
  { key: "ownerName", label: "Owner name", category: "IDENTITY", sensitivity: "MEDIUM", kind: "FIELD", passportKey: "ownerName" },
  { key: "gstin", label: "GSTIN", category: "COMPLIANCE", sensitivity: "MEDIUM", kind: "FIELD", passportKey: "gstin" },
  { key: "udyamNumber", label: "Udyam number", category: "COMPLIANCE", sensitivity: "MEDIUM", kind: "FIELD", passportKey: "udyamNumber" },
  { key: "address", label: "Business address", category: "BUSINESS", sensitivity: "MEDIUM", kind: "FIELD", passportKey: "address" },
  { key: "turnoverBand", label: "Turnover band", category: "BUSINESS", sensitivity: "HIGH", kind: "FIELD", passportKey: "turnoverBand" },
  { key: "summary", label: "Trust summary", category: "COMPLIANCE", sensitivity: "MEDIUM", kind: "FIELD", passportKey: "summary" },
  { key: DocumentType.GST_CERTIFICATE, label: "GST certificate evidence", category: "EVIDENCE", sensitivity: "MEDIUM", kind: "EVIDENCE", documentType: DocumentType.GST_CERTIFICATE },
  { key: DocumentType.UDYAM_CERTIFICATE, label: "Udyam certificate evidence", category: "EVIDENCE", sensitivity: "MEDIUM", kind: "EVIDENCE", documentType: DocumentType.UDYAM_CERTIFICATE },
  { key: DocumentType.BANK_STATEMENT, label: "Bank statement evidence", category: "EVIDENCE", sensitivity: "HIGH", kind: "EVIDENCE", documentType: DocumentType.BANK_STATEMENT }
] as const;

export const DISCLOSURE_FIELD_KEYS = DISCLOSURE_CATALOGUE.filter((item) => item.kind === "FIELD").map((item) => item.key);
export const DISCLOSURE_EVIDENCE_KEYS = DISCLOSURE_CATALOGUE.filter((item) => item.kind === "EVIDENCE").map((item) => item.key);

export function disclosureItem(key: string, kind?: DisclosureKind) { return DISCLOSURE_CATALOGUE.find((item) => item.key === key && (!kind || item.kind === kind)); }
export function validateDisclosureKeys(keys: string[], kind?: DisclosureKind) { return [...new Set(keys)].filter((key) => !disclosureItem(key, kind)); }
export function disclosureFieldValue(snapshot: unknown, key: string) {
  const value = (snapshot as Record<string, unknown> | null | undefined)?.[key];
  return value && typeof value === "object" && "value" in value ? (value as { value: unknown }).value : value;
}
