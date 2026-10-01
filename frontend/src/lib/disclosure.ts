// The canonical disclosure vocabulary, mirrored from the backend's
// src/utils/disclosureCatalogue.ts (committed by Codex in a834f0c).
// Keys and labels MUST stay identical: `npm run check:contract` fails if they
// drift. Registered consent and guest links both use this one list.

export type DisclosureKind = "FIELD" | "EVIDENCE";

export type FieldKey = "legalBusinessName" | "ownerName" | "gstin" | "udyamNumber" | "address" | "turnoverBand" | "summary";
export type EvidenceKey = "GST_CERTIFICATE" | "UDYAM_CERTIFICATE" | "BANK_STATEMENT";

export interface DisclosureItem<K extends string = string> {
  key: K;
  label: string;
  kind: DisclosureKind;
  /** Plain-language explanation of what the recipient sees. */
  description: string;
}

export const FIELD_DISCLOSURES: readonly DisclosureItem<FieldKey>[] = [
  { key: "legalBusinessName", label: "Legal business name", kind: "FIELD", description: "The registered name of the business." },
  { key: "ownerName", label: "Owner name", kind: "FIELD", description: "Name of the account owner." },
  { key: "gstin", label: "GSTIN", kind: "FIELD", description: "The GSTIN value only. No certificate details." },
  { key: "udyamNumber", label: "Udyam number", kind: "FIELD", description: "The Udyam registration number only. No certificate details." },
  { key: "address", label: "Business address", kind: "FIELD", description: "Registered business address." },
  { key: "turnoverBand", label: "Turnover band", kind: "FIELD", description: "Self-declared annual turnover range." },
  { key: "summary", label: "Trust summary", kind: "FIELD", description: "Trust readiness, completeness, evidence strength, consistency and freshness scores." },
];

export const EVIDENCE_DISCLOSURES: readonly DisclosureItem<EvidenceKey>[] = [
  { key: "GST_CERTIFICATE", label: "GST certificate evidence", kind: "EVIDENCE", description: "Check status, source and dates of the GST certificate as of the shared Trust Profile version. Never the file itself." },
  { key: "UDYAM_CERTIFICATE", label: "Udyam certificate evidence", kind: "EVIDENCE", description: "Check status, source and dates of the Udyam certificate as of the shared Trust Profile version. Never the file itself." },
  { key: "BANK_STATEMENT", label: "Bank statement evidence", kind: "EVIDENCE", description: "Check status, source and dates of the bank statement as of the shared Trust Profile version. Never the file itself." },
];

export const FIELD_KEYS = FIELD_DISCLOSURES.map((item) => item.key);
export const EVIDENCE_KEYS = EVIDENCE_DISCLOSURES.map((item) => item.key);

export function isFieldKey(key: string): key is FieldKey {
  return (FIELD_KEYS as string[]).includes(key);
}

export function isEvidenceKey(key: string): key is EvidenceKey {
  return (EVIDENCE_KEYS as string[]).includes(key);
}

export function disclosureItem(key: string): DisclosureItem | undefined {
  return FIELD_DISCLOSURES.find((item) => item.key === key) ?? EVIDENCE_DISCLOSURES.find((item) => item.key === key);
}

/** A requested/approved scope, split by disclosure kind. */
export interface DisclosureScope {
  fields: FieldKey[];
  evidence: EvidenceKey[];
}

export const EMPTY_SCOPE: DisclosureScope = { fields: [], evidence: [] };

export function scopeSize(scope: DisclosureScope): number {
  return scope.fields.length + scope.evidence.length;
}

/** Splits raw backend key arrays into canonical keys and anything unrecognised. */
export function parseScope(fields: unknown, evidence: unknown): { scope: DisclosureScope; unsupported: string[] } {
  const rawFields = Array.isArray(fields) ? fields.map(String) : [];
  const rawEvidence = Array.isArray(evidence) ? evidence.map(String) : [];
  return {
    scope: { fields: rawFields.filter(isFieldKey), evidence: rawEvidence.filter(isEvidenceKey) },
    unsupported: [...rawFields.filter((key) => !isFieldKey(key)), ...rawEvidence.filter((key) => !isEvidenceKey(key))],
  };
}

/** Items in `requested` that are not in `approved`. */
export function withheldScope(requested: DisclosureScope, approved: DisclosureScope): DisclosureScope {
  return {
    fields: requested.fields.filter((key) => !approved.fields.includes(key)),
    evidence: requested.evidence.filter((key) => !approved.evidence.includes(key)),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 fields", "1 evidence item", "3 fields and 1 evidence item". */
export function scopeCountPhrase(scope: DisclosureScope): string {
  const parts = [scope.fields.length ? plural(scope.fields.length, "field", "fields") : "", scope.evidence.length ? plural(scope.evidence.length, "evidence item", "evidence items") : ""].filter(Boolean);
  return parts.length ? parts.join(" and ") : "nothing";
}

/** "GSTIN and GST certificate evidence", "Legal business name, GSTIN and 2 more". */
export function scopeLabelPhrase(scope: DisclosureScope, max = 3): string {
  const labels = [...scope.fields, ...scope.evidence].map((key) => disclosureItem(key)?.label ?? key);
  if (labels.length === 0) return "nothing";
  if (labels.length <= max) return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `${labels.slice(0, max).join(", ")} and ${labels.length - max} more`;
}
