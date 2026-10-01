// Human labels for backend keys and document types. Disclosure keys always
// use the canonical catalogue label (lib/disclosure); the table below only
// covers non-disclosable keys that appear in check results and audit metadata.

import { disclosureItem } from "@/lib/disclosure";
import { humanize } from "@/lib/trustVocabulary";

const BACKEND_FIELD_LABELS: Record<string, string> = {
  businessName: "Business name",
  pan: "PAN",
  bankAccount: "Bank account",
  fieldConfidence: "All field check results",
  documentConfidence: "Evidence check results (all documents)",
  gaps: "Evidence gaps",
  contradictions: "Contradictions",
  limitations: "Limitations",
  sourceVerificationPerformed: "External verification performed",
  lastCalculatedAt: "Last calculated",
  generatedAt: "Generated",
  version: "Trust Profile version",
};

export function backendFieldLabel(key: string): string {
  return disclosureItem(key)?.label ?? BACKEND_FIELD_LABELS[key] ?? humanize(key);
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  GST_CERTIFICATE: "GST certificate",
  UDYAM_CERTIFICATE: "Udyam certificate",
  BANK_STATEMENT: "Bank statement",
};

export function documentTypeLabel(type: string): string {
  return DOCUMENT_TYPE_LABELS[type.toUpperCase()] ?? humanize(type);
}

/** Evidence source as entered by the MSME; the backend default is MSME_SUBMITTED. */
export function sourceLabel(source?: string | null): string {
  if (!source || source === "MSME_SUBMITTED") return "Submitted by the business";
  return source;
}
