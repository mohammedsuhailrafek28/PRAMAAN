// The three evidence slots an MSME maintains, derived from GET /business/me.
// A slot always exists, so missing evidence is an explicit state, never absent UI.

import type { EvidenceKey } from "@/lib/disclosure";
import { parseDate } from "@/lib/utils";
import type { Business, BusinessDocument, DocumentType, EvidenceLifecycleState, TrustProfile } from "@/types";

export type SlotState = "MISSING" | EvidenceLifecycleState;

export interface EvidenceSlot {
  type: DocumentType;
  key: EvidenceKey;
  label: string;
  /** Why this evidence matters, in plain language. */
  purpose: string;
  current?: BusinessDocument;
  /** Earlier versions, newest first. */
  history: BusinessDocument[];
  state: SlotState;
}

const SLOT_DEFINITIONS: { type: DocumentType; key: EvidenceKey; label: string; purpose: string }[] = [
  { type: "gst_certificate", key: "GST_CERTIFICATE", label: "GST certificate", purpose: "Supports your GSTIN and legal business name." },
  { type: "udyam_certificate", key: "UDYAM_CERTIFICATE", label: "Udyam certificate", purpose: "Supports your Udyam registration number." },
  { type: "bank_statement", key: "BANK_STATEMENT", label: "Bank statement", purpose: "Supports your business bank relationship and turnover." },
];

export const EVIDENCE_SLOT_TYPES = SLOT_DEFINITIONS.map((slot) => slot.type);

export function evidenceSlotLabel(type: DocumentType): string {
  return SLOT_DEFINITIONS.find((slot) => slot.type === type)?.label ?? type;
}

export function evidenceSlots(business: Business | null): EvidenceSlot[] {
  const documents = business?.documents ?? [];
  return SLOT_DEFINITIONS.map((definition) => {
    const ofType = documents.filter((doc) => doc.type === definition.type).sort((a, b) => (b.revision ?? 1) - (a.revision ?? 1));
    const current = ofType.find((doc) => doc.isCurrent !== false);
    const history = ofType.filter((doc) => doc !== current);
    const state: SlotState = current ? current.lifecycle?.state ?? "CURRENT" : "MISSING";
    return { ...definition, current, history, state };
  });
}

export interface EvidenceHealth {
  total: number;
  current: number;
  expiringSoon: number;
  stale: number;
  conflict: number;
  missing: number;
  other: number;
}

export function evidenceHealth(slots: EvidenceSlot[]): EvidenceHealth {
  const count = (state: SlotState) => slots.filter((slot) => slot.state === state).length;
  return {
    total: slots.length,
    current: count("CURRENT"),
    expiringSoon: count("EXPIRING_SOON"),
    stale: count("EXPIRED"),
    conflict: count("CONFLICT"),
    missing: count("MISSING"),
    other: count("NEEDS_ATTENTION"),
  };
}

/** True when claims or evidence changed after this Trust Profile version was generated. */
export function isTrustProfileOutdated(business: Business, profile: TrustProfile): boolean {
  const generated = parseDate(profile.generatedAt)?.getTime() ?? 0;
  const newerEvidence = business.documents.some((doc) => doc.isCurrent !== false && (parseDate(doc.uploadedAt)?.getTime() ?? 0) > generated);
  // Saving business details resets the backend status to SELF_DECLARED until the next cross-check.
  return newerEvidence || business.trustStatus === "SELF_DECLARED";
}
