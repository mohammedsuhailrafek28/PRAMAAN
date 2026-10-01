// Single source of truth for how Pramaan states are worded in the UI.
//
// Truth rule: Pramaan cross-checks submitted claims and evidence against each
// other. It does not query GST, Udyam, bank, or other government systems, so
// nothing here may imply external verification unless the backend reports
// SOURCE_VERIFIED (which no current adapter produces).

import type { EvidenceLifecycleState, EvidenceStatus } from "@/types";

export type StatusTone = "verified" | "pending" | "warning" | "danger" | "neutral";

export interface StatusDescriptor {
  label: string;
  tone: StatusTone;
  description: string;
}

export const NOT_EXTERNALLY_VERIFIED =
  "Pramaan cross-checks submitted claims and evidence against each other. It does not query GST, Udyam, bank, or other government systems.";

const EVIDENCE_STATUS: Record<EvidenceStatus, StatusDescriptor> = {
  SELF_DECLARED: {
    label: "Self-declared",
    tone: "neutral",
    description: "Entered by the business. No supporting evidence has been checked.",
  },
  DOCUMENT_SUBMITTED: {
    label: "Evidence submitted",
    tone: "pending",
    description: "Supporting evidence was submitted but has not been cross-checked yet.",
  },
  CROSS_CHECKED: {
    label: "Cross-checked",
    tone: "verified",
    description: "Consistent with the business's other claims and submitted evidence. Not externally verified.",
  },
  SOURCE_VERIFIED: {
    label: "Source verified",
    tone: "verified",
    description: "Confirmed with an authoritative external source.",
  },
  REJECTED: {
    label: "Conflict detected",
    tone: "danger",
    description: "Pramaan's internal checks found a contradiction that needs review.",
  },
  EXPIRED: {
    label: "Expired",
    tone: "warning",
    description: "The supporting evidence is past its expiry date.",
  },
};

export const MISSING_EVIDENCE: StatusDescriptor = {
  label: "Missing",
  tone: "neutral",
  description: "No evidence of this type has been submitted.",
};

const LIFECYCLE_STATUS: Record<EvidenceLifecycleState, StatusDescriptor> = {
  CURRENT: { label: "Current", tone: "verified", description: "This is the latest version and it is within its validity period." },
  EXPIRING_SOON: { label: "Expiring soon", tone: "warning", description: "Expires within 30 days. Upload a renewed document." },
  EXPIRED: { label: "Stale", tone: "warning", description: "This document has expired. Upload a current version." },
  CONFLICT: { label: "Conflict detected", tone: "danger", description: "Internal checks found a contradiction involving this evidence." },
  NEEDS_ATTENTION: { label: "Needs attention", tone: "warning", description: "This evidence was replaced or rejected." },
};

export function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function describeEvidenceStatus(status?: string | null): StatusDescriptor {
  if (!status) return MISSING_EVIDENCE;
  return EVIDENCE_STATUS[status as EvidenceStatus] ?? { label: humanize(status), tone: "neutral", description: "Status reported by Pramaan." };
}

export function describeLifecycle(state?: string | null): StatusDescriptor {
  if (!state) return MISSING_EVIDENCE;
  return LIFECYCLE_STATUS[state as EvidenceLifecycleState] ?? { label: humanize(state), tone: "neutral", description: "Lifecycle state reported by Pramaan." };
}

/**
 * Mirrors backend `statusFromProfile`: any HIGH/CRITICAL contradiction makes
 * the overall result a conflict; otherwise the profile is cross-checked.
 */
export function overallStatusFromContradictions(contradictions: { severity: string }[]): EvidenceStatus {
  return contradictions.some((item) => item.severity === "HIGH" || item.severity === "CRITICAL") ? "REJECTED" : "CROSS_CHECKED";
}
