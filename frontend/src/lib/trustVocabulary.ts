// Single source of truth for how Pramaan states are worded and coloured.
//
// Truth rule: Pramaan cross-checks submitted claims and evidence against each
// other. It does not query GST, Udyam, bank, or other government systems, so
// nothing here may imply external verification unless the backend reports
// SOURCE_VERIFIED (which no current adapter produces).
//
// Colour rule: positive = current / cross-checked / active; neutral =
// self-declared / submitted / pending; warning = stale / expiring;
// negative = conflict / missing / declined / revoked / expired access.

import type { StatusIcon } from "@/components/shared/StatusPill";
import type { ConsentStatus, EvidenceLifecycleState, EvidenceStatus } from "@/types";

export type StatusTone = "positive" | "info" | "neutral" | "warning" | "negative";

export interface StatusDescriptor {
  label: string;
  tone: StatusTone;
  description: string;
  icon?: StatusIcon;
}

export const NOT_EXTERNALLY_VERIFIED =
  "Pramaan cross-checks submitted claims and evidence against each other. It does not query GST, Udyam, bank, or other government systems.";

const EVIDENCE_STATUS: Record<EvidenceStatus, StatusDescriptor> = {
  SELF_DECLARED: { label: "Self-declared", tone: "neutral", description: "Entered by the business. No supporting evidence has been checked." },
  DOCUMENT_SUBMITTED: { label: "Evidence submitted", tone: "neutral", icon: "clock", description: "Supporting evidence was submitted. Pramaan has not cross-checked it against other claims yet." },
  CROSS_CHECKED: { label: "Cross-checked", tone: "positive", description: "Consistent with the business's other claims and submitted evidence. Not externally verified." },
  SOURCE_VERIFIED: { label: "Source verified", tone: "positive", description: "Confirmed with an authoritative external source." },
  REJECTED: { label: "Conflict detected", tone: "negative", icon: "alert", description: "Pramaan's internal checks found a contradiction that needs review." },
  EXPIRED: { label: "Stale", tone: "warning", description: "The supporting evidence is past its expiry date." },
};

export const MISSING_EVIDENCE: StatusDescriptor = {
  label: "Missing",
  tone: "negative",
  icon: "dot",
  description: "No evidence of this type has been submitted.",
};

const LIFECYCLE_STATUS: Record<EvidenceLifecycleState, StatusDescriptor> = {
  CURRENT: { label: "Current", tone: "positive", description: "Latest version and within its validity period." },
  EXPIRING_SOON: { label: "Expiring soon", tone: "warning", icon: "clock", description: "Expires within 30 days. Upload a renewed document." },
  EXPIRED: { label: "Stale", tone: "warning", description: "Past its expiry date. Upload a current version." },
  CONFLICT: { label: "Conflict detected", tone: "negative", icon: "alert", description: "Internal checks found a contradiction involving this evidence." },
  NEEDS_ATTENTION: { label: "Needs attention", tone: "warning", description: "This evidence was replaced or rejected." },
};

const CONSENT_STATUS: Record<ConsentStatus, StatusDescriptor> = {
  pending: { label: "Awaiting decision", tone: "info", icon: "clock", description: "Nothing is shared until the business approves." },
  active: { label: "Access active", tone: "positive", description: "The verifier can open the approved items until access expires." },
  rejected: { label: "Declined", tone: "negative", description: "The business declined. Nothing was shared." },
  revoked: { label: "Revoked", tone: "negative", icon: "ban", description: "The business withdrew access." },
  expired: { label: "Expired", tone: "negative", icon: "clock", description: "The approved access period ended." },
};

const LINK_STATUS: Record<"ACTIVE" | "EXPIRED" | "REVOKED", StatusDescriptor> = {
  ACTIVE: { label: "Link active", tone: "positive", description: "Anyone with the link can open the shared items until it expires." },
  EXPIRED: { label: "Expired", tone: "negative", icon: "clock", description: "The link's access period ended." },
  REVOKED: { label: "Revoked", tone: "negative", icon: "ban", description: "The business withdrew this link." },
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

export function describeConsent(status: ConsentStatus): StatusDescriptor {
  return CONSENT_STATUS[status];
}

export function describeLink(status: "ACTIVE" | "EXPIRED" | "REVOKED"): StatusDescriptor {
  return LINK_STATUS[status];
}

/** Field freshness reported by the backend for disclosed snapshot fields. */
export function describeFreshness(state?: string | null): StatusDescriptor | undefined {
  if (state === "EXPIRED") return { label: "Stale", tone: "warning", description: "Based on evidence that had expired when this Trust Profile version was generated." };
  if (state === "CURRENT") return { label: "Current", tone: "positive", description: "Based on evidence that was within its validity period at this Trust Profile version." };
  return undefined;
}

/** Where a value came from, in plain language. Never implies external verification. */
export function describeSource(source?: string | null): string {
  if (!source || source === "MSME_SUBMITTED") return "Submitted by the business";
  if (source === "INTERNAL_DETERMINISTIC_CHECKS") return "Assessed by Pramaan's internal checks";
  return source;
}

/**
 * Mirrors backend `statusFromProfile`: any HIGH/CRITICAL contradiction makes
 * the overall result a conflict; otherwise the profile is cross-checked.
 */
export function overallStatusFromContradictions(contradictions: { severity: string }[]): EvidenceStatus {
  return contradictions.some((item) => item.severity === "HIGH" || item.severity === "CRITICAL") ? "REJECTED" : "CROSS_CHECKED";
}
