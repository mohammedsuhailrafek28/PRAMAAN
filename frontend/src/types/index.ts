// Core domain types for Pramaan — consent-controlled, reusable business trust
// for Indian MSMEs. The services layer (src/services/api.ts) maps backend
// responses into these shapes; pages never read raw API payloads.

import type { DisclosureScope } from "@/lib/disclosure";

export type Role = "msme" | "buyer" | "bank";

import type { RequesterIdentity } from "@/lib/requesterIdentity";

export interface User {
  id: string;
  role: Role;
  name: string;
  orgName: string;
  email: string;
  avatarInitials: string;
  /** Buyers and banks only: how well Pramaan knows this account. Absent for MSMEs. */
  requesterIdentity?: RequesterIdentity;
}

export type EvidenceStatus = "SELF_DECLARED" | "DOCUMENT_SUBMITTED" | "CROSS_CHECKED" | "SOURCE_VERIFIED" | "REJECTED" | "EXPIRED";
export type EvidenceLifecycleState = "CURRENT" | "EXPIRING_SOON" | "EXPIRED" | "CONFLICT" | "NEEDS_ATTENTION";

export type DocumentType = "gst_certificate" | "udyam_certificate" | "bank_statement";

export interface EvidenceLifecycle {
  state: EvidenceLifecycleState;
  freshnessState: "CURRENT" | "EXPIRING_SOON" | "EXPIRED";
  conflict: boolean;
  needsAttention: boolean;
}

export interface BusinessDocument {
  id: string;
  type: DocumentType;
  label: string;
  fileName?: string;
  uploadedAt?: string;
  evidenceStatus?: EvidenceStatus;
  confidence?: number;
  confidenceReason?: string;
  source?: string;
  checkedAt?: string;
  expiresAt?: string;
  issuedAt?: string;
  revision?: number;
  isCurrent?: boolean;
  previousVersionId?: string;
  lifecycle?: EvidenceLifecycle;
}

export const TURNOVER_BANDS = [
  "Under ₹40 Lakh",
  "₹40 Lakh – ₹1.5 Cr",
  "₹1.5 Cr – ₹5 Cr",
  "₹5 Cr – ₹25 Cr",
  "Above ₹25 Cr",
] as const;

export interface Business {
  id: string;
  ownerId: string;
  legalName: string;
  gstin: string;
  udyamNumber: string;
  pan: string;
  address: string;
  /** Stored exactly as the backend holds it; may be a value outside TURNOVER_BANDS. */
  turnoverBand: string;
  trustStatus: EvidenceStatus;
  trustSummary?: TrustSummary;
  sourceVerificationPerformed: false;
  documents: BusinessDocument[];
  /** Timestamp of the most recent internal cross-check. */
  lastCrossCheckedAt?: string;
}

export interface TrustCheck {
  type: string;
  result: "PASSED" | "FAILED" | "WARNING" | "NOT_APPLICABLE" | string;
  reason: string;
}

/** Field-level result from the internal cross-check engine. */
export interface FieldCheck {
  field: string;
  value: unknown;
  status: EvidenceStatus;
  confidence: number;
  reason: string;
  checks: TrustCheck[];
}

/** Document-level result from the internal cross-check engine. */
export interface DocumentCheck {
  documentId: string;
  documentType: string;
  status: EvidenceStatus;
  confidence: number;
  reason: string;
  checks: TrustCheck[];
}

export interface EvidenceGap {
  field: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | string;
  message: string;
}

export interface Contradiction {
  field: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | string;
  reason: string;
}

export interface TrustSummary {
  trustReadiness: number;
  profileCompleteness: number;
  evidenceStrength: number;
  consistency: number;
  freshness: number;
}

/** The result of POST /business/cross-check, exactly as the engine reported it. */
export interface CrossCheckResult {
  trustStatus: EvidenceStatus;
  checkedAt: string;
  summary: TrustSummary;
  fields: FieldCheck[];
  documents: DocumentCheck[];
  gaps: EvidenceGap[];
  contradictions: Contradiction[];
  limitations: string[];
}

/** A versioned Trust Profile snapshot (backend: Passport table). */
export interface TrustProfile {
  id: string;
  businessId: string;
  version: number;
  generatedAt: string;
  lastCalculatedAt?: string;
  summary: TrustSummary;
  fields: FieldCheck[];
  documents: DocumentCheck[];
  gaps: EvidenceGap[];
  contradictions: Contradiction[];
  limitations: string[];
  sourceVerificationPerformed: false;
}

export type ConsentDurationHours = 24 | 168 | 720; // 24h / 7d / 30d

export const CONSENT_DURATION_LABELS: Record<ConsentDurationHours, string> = {
  24: "24 Hours",
  168: "7 Days",
  720: "30 Days",
};

export type ConsentStatus = "pending" | "active" | "rejected" | "revoked" | "expired";

export interface ConsentRequest {
  id: string;
  businessId: string;
  /** Only the identity already returned by GSTIN lookup (name + GSTIN). */
  businessName?: string;
  businessGstin?: string;
  requesterId: string;
  requesterName: string;
  requesterRole?: Extract<Role, "buyer" | "bank">;
  /** How well Pramaan knows the requester. Always present; defaults to UNVERIFIED. */
  requesterIdentity: RequesterIdentity;
  purpose?: string;
  requested: DisclosureScope;
  approved: DisclosureScope;
  /** Requested keys outside the canonical catalogue (pre-contract records); never approvable. */
  unsupportedRequested: string[];
  durationDays: number | null;
  status: ConsentStatus;
  requestedAt: string;
  approvedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
}

export interface AuditActor {
  identity?: RequesterIdentity;
  name?: string;
  organization?: string;
  role?: Role;
}

/** One audit row as recorded by the backend. Rendering lives in lib/auditEvents. */
export interface AuditLogEntry {
  id: string;
  /** Backend AuditAction value, kept verbatim so unknown events still render. */
  action: string;
  timestamp: string;
  actor?: AuditActor;
  requester?: AuditActor;
  /** Scope originally requested on the related consent (for "approved X of Y"). */
  requestScope?: DisclosureScope;
  consentId?: string;
  accessGrantId?: string;
  metadata?: Record<string, unknown>;
}

export interface Notification {
  id: string;
  userId: string;
  message: string;
  read: boolean;
  createdAt: string;
  relatedConsentId?: string;
}


export interface AccessGrant {
  id: string;
  recipientName?: string;
  recipientOrganization?: string;
  recipientEmail?: string;
  purpose: string;
  scope: DisclosureScope;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  lastAccessedAt?: string;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
  secureUrl?: string;
}

/** Evidence metadata disclosed under consent or a guest link (never the file). */
export interface SharedEvidence {
  docType: string;
  evidenceStatus: string;
  confidence: number;
  source?: string;
  issuedAt?: string;
  checkedAt?: string;
  expiresAt?: string;
  uploadedAt: string;
  lifecycle?: { state: string; freshnessState: string; conflict: boolean; needsAttention: boolean };
}

/** A single disclosed field, formatted for display with its check status. */
export interface SharedField {
  key: string;
  label: string;
  value: string;
  status?: string;
  /** e.g. INTERNAL_DETERMINISTIC_CHECKS or MSME_SUBMITTED (never external verification). */
  source?: string;
  lastCheckedAt?: string;
  /** CURRENT or EXPIRED, as of the pinned Trust Profile version. */
  freshnessState?: string;
  /** True for values Pramaan computes (Trust summary) rather than claims. */
  computed?: boolean;
  /** For composite values (e.g. Trust summary metrics). */
  items?: { label: string; status?: string; detail?: string }[];
}

export interface GuestVerificationView {
  grant: { id: string; purpose: string; recipientName?: string; recipientOrganization?: string; createdAt: string; expiresAt: string; profileVersion?: number };
  business: { legalName?: string; gstin?: string };
  fields: SharedField[];
  evidence: SharedEvidence[];
}

/** Discriminated result returned by the Trust View endpoint. */
export type TrustViewResult =
  | {
      state: "active";
      consentId: string;
      businessName: string;
      grantedAt?: string;
      expiresAt: string;
      purpose?: string;
      /** Version of the Trust Profile snapshot pinned when consent was approved. */
      profileVersion?: number;
      fields: SharedField[];
      evidence: SharedEvidence[];
    }
  | { state: "revoked"; consentId: string }
  | { state: "expired"; consentId: string }
  | { state: "not_found"; consentId: string }
  /** Consent exists but cannot be shown (not approved yet, or its pinned snapshot is missing). */
  | { state: "unavailable"; consentId: string; message: string };

/** Why a guest link cannot be opened. */
export type GuestLinkFailure = "revoked" | "expired" | "invalid" | "unavailable";

// ---- Readiness (backend: src/modules/readinessEngine) ----

export type ReadinessLevel = "NOT_READY" | "EARLY_STAGE" | "PARTIALLY_READY" | "MOSTLY_READY" | "READY_FOR_REVIEW" | "BLOCKED";
export type RequirementStatus = "SATISFIED" | "PARTIALLY_SATISFIED" | "MISSING" | "BLOCKED" | "MANUAL_REVIEW" | "NOT_APPLICABLE";

export interface ReadinessProfileSummary {
  id: string;
  version: string;
  name: string;
  purpose: string;
  description: string;
  disclaimer: string;
}

export interface ReadinessRequirementResult {
  requirementId: string;
  label: string;
  status: RequirementStatus;
  reason: string;
  blockingIssues: { code: string; message: string }[];
}

export interface ReadinessNextAction {
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  requirementId: string;
  title: string;
  description: string;
}

export interface ReadinessEvaluation {
  profile: ReadinessProfileSummary;
  evaluatedAt: string;
  result: {
    score: number;
    level: ReadinessLevel;
    blocked: boolean;
    satisfiedRequirements: number;
    partialRequirements: number;
    missingRequirements: number;
    totalApplicableRequirements: number;
  };
  requirements: ReadinessRequirementResult[];
  blockingIssues: { code: string; message: string }[];
  nextActions: ReadinessNextAction[];
  limitations: string[];
}

// ---- Reports (backend: src/modules/reportComposer) ----

export interface ReportType {
  reportType: string;
  displayName: string;
  description: string;
  disclaimer: string;
}

export interface ReportSummary {
  reportId: string;
  reportType: string;
  reportVersion: string;
  generatedAt: string;
  revokedAt?: string | null;
  headlineStatus?: string | null;
  score?: number | null;
  level?: string | null;
}
