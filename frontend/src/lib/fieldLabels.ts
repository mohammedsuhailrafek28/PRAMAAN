// Human labels for backend field keys and document types. Display only; the
// backend decides what is shareable. When Codex publishes the canonical
// disclosure contract (docs/FINALS_BUILD.md, decision D3), this file must be
// reconciled with it.

import { humanize } from "@/lib/trustVocabulary";

const BACKEND_FIELD_LABELS: Record<string, string> = {
  legalBusinessName: "Legal business name",
  businessName: "Business name",
  ownerName: "Owner name",
  gstin: "GSTIN",
  udyamNumber: "Udyam number",
  pan: "PAN",
  address: "Registered address",
  turnoverBand: "Turnover band",
  bankAccount: "Bank account",
  summary: "Trust readiness summary",
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
  return BACKEND_FIELD_LABELS[key] ?? humanize(key);
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  GST_CERTIFICATE: "GST certificate",
  UDYAM_CERTIFICATE: "Udyam certificate",
  BANK_STATEMENT: "Bank statement",
};

export function documentTypeLabel(type: string): string {
  return DOCUMENT_TYPE_LABELS[type.toUpperCase()] ?? humanize(type);
}

/**
 * Current backend behaviour (src/modules/trustView/trustView.service.ts):
 * approving some fields also discloses metadata of the matching current
 * evidence (type, file name, status, dates, source). Shown to the MSME so
 * the approval is honest until D3 makes evidence disclosure explicit.
 */
export const IMPLIED_EVIDENCE_BY_BACKEND_FIELD: Record<string, string> = {
  gstin: "GST_CERTIFICATE",
  udyamNumber: "UDYAM_CERTIFICATE",
  bankAccount: "BANK_STATEMENT",
  documentConfidence: "BANK_STATEMENT",
};

/** Evidence source as entered by the MSME; the backend default is MSME_SUBMITTED. */
export function sourceLabel(source?: string | null): string {
  if (!source || source === "MSME_SUBMITTED") return "Submitted by the business";
  return source;
}
