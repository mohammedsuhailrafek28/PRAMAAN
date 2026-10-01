// Core domain types for Pramaan — India's consent-based business trust
// infrastructure for MSMEs. These mirror the shape the real backend will
// eventually return, so the services layer can be swapped without touching
// the UI or these type definitions.

export type Role = "msme" | "buyer" | "bank";

export interface User {
  id: string;
  role: Role;
  name: string;
  orgName: string;
  email: string;
  avatarInitials: string;
}

export type VerificationStatus = "unverified" | "pending" | "verified" | "flagged";
export type EvidenceStatus = "SELF_DECLARED" | "DOCUMENT_SUBMITTED" | "CROSS_CHECKED" | "SOURCE_VERIFIED" | "REJECTED" | "EXPIRED";
export type EvidenceLifecycleState = "CURRENT" | "EXPIRING_SOON" | "EXPIRED" | "CONFLICT" | "NEEDS_ATTENTION";

export type DocumentType = "gst_certificate" | "udyam_certificate" | "bank_statement";

export interface BusinessDocument {
  type: DocumentType;
  label: string;
  uploaded: boolean;
  verified: boolean;
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
  lifecycle?: { state: EvidenceLifecycleState; freshnessState: "CURRENT" | "EXPIRING_SOON" | "EXPIRED"; conflict: boolean; needsAttention: boolean };
}

export type TurnoverBand =
  | "Under ₹40 Lakh"
  | "₹40 Lakh – ₹1.5 Cr"
  | "₹1.5 Cr – ₹5 Cr"
  | "₹5 Cr – ₹25 Cr"
  | "Above ₹25 Cr";

export interface Business {
  id: string;
  ownerId: string;
  legalName: string;
  gstin: string;
  udyamNumber: string;
  pan: string;
  address: string;
  turnoverBand: TurnoverBand;
  inviteCode: string;
  verificationStatus: VerificationStatus;
  trustStatus: EvidenceStatus;
  trustSummary?: TrustSummary;
  sourceVerificationPerformed: false;
  fieldVerification: {
    gstin: boolean;
    udyamNumber: boolean;
    pan: boolean;
  };
  documents: BusinessDocument[];
  verifiedAt?: string;
}

export interface TrustProfile {
  id: string;
  businessId: string;
  businessName?: string;
  version: number;
  generatedAt: string;
  complianceStatus: "Internally cross-checked" | "Review needed";
  bankVerificationStatus: string;
  summary: TrustSummary;
  sourceVerificationPerformed: false;
}

export interface TrustSummary {
  trustReadiness: number;
  profileCompleteness: number;
  evidenceStrength: number;
  consistency: number;
  freshness: number;
}

/** The set of fields a stakeholder can request / be granted consent for. */
export type ConsentField =
  | "legalName"
  | "gstin"
  | "udyamNumber"
  | "address"
  | "complianceStatus"
  | "turnoverBand"
  | "bankVerificationStatus";

export const CONSENT_FIELD_LABELS: Record<ConsentField, string> = {
  legalName: "Legal Business Name",
  gstin: "GSTIN",
  udyamNumber: "Udyam Number",
  address: "Registered Address",
  complianceStatus: "Compliance Status",
  turnoverBand: "Turnover Band",
  bankVerificationStatus: "Bank Verification Status",
};

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
  businessName?: string;
  requesterId: string;
  requesterName: string;
  requesterRole: Extract<Role, "buyer" | "bank">;
  purpose?: "Business Loan" | "Vendor Onboarding" | "Procurement" | "Custom";
  requestedFields: ConsentField[];
  approvedFields: ConsentField[];
  durationHours: ConsentDurationHours | null;
  status: ConsentStatus;
  requestedAt: string;
  approvedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  rejectedAt?: string;
}

export type AuditAction =
  | "business_verified"
  | "evidence_uploaded"
  | "evidence_replaced"
  | "trust_profile_generated"
  | "consent_requested"
  | "consent_approved"
  | "consent_rejected"
  | "consent_viewed"
  | "consent_revoked"
  | "consent_expired";

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  business_verified: "Business Verified",
  evidence_uploaded: "Evidence Uploaded",
  evidence_replaced: "Evidence Replaced",
  trust_profile_generated: "Trust Profile Generated",
  consent_requested: "Requested Access",
  consent_approved: "Approved Selected Fields",
  consent_rejected: "Rejected Request",
  consent_viewed: "Viewed Trust Profile",
  consent_revoked: "Revoked Access",
  consent_expired: "Access Expired",
};

export interface AuditLogEntry {
  id: string;
  businessId: string;
  timestamp: string;
  actor: string;
  action: AuditAction;
  consentId?: string;
  details?: string;
}

export interface Notification {
  id: string;
  userId: string;
  message: string;
  read: boolean;
  createdAt: string;
  relatedConsentId?: string;
}

export type ShareableField = "legalBusinessName" | "ownerName" | "gstin" | "udyamNumber" | "address" | "turnoverBand" | "summary";
export type ShareableEvidenceType = "GST_CERTIFICATE" | "UDYAM_CERTIFICATE" | "BANK_STATEMENT";

export interface AccessGrant {
  id: string;
  recipientName?: string;
  recipientOrganization?: string;
  recipientEmail?: string;
  purpose: string;
  scope: { fields: ShareableField[]; evidenceTypes: ShareableEvidenceType[] };
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  lastAccessedAt?: string;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
  secureUrl?: string;
}

export interface GuestVerificationView {
  grant: { id: string; purpose: string; recipientName?: string; recipientOrganization?: string; createdAt: string; expiresAt: string };
  business: { legalName?: string; gstin?: string };
  sharedFields: Record<string, unknown>;
  evidence: Array<{ docType: ShareableEvidenceType; originalName: string; mimeType: string; evidenceStatus: string; confidence: number; confidenceReason?: string; crossCheckMethod?: string; source?: string; issuedAt?: string; checkedAt?: string; expiresAt?: string; uploadedAt: string; lifecycle: { state: string; freshnessState: string; conflict: boolean; needsAttention: boolean } }>;
}

/** Discriminated result returned by the Dynamic Trust View endpoint. */
export type TrustViewResult =
  | {
      state: "active";
      consentId: string;
      businessName: string;
      grantedAt: string;
      expiresAt: string;
      purpose?: string;
      fields: Partial<Record<ConsentField, string>>;
      evidence?: Array<{ docType: string; evidenceStatus: string; confidence: number; source?: string; issuedAt?: string; expiresAt?: string; uploadedAt: string }>;
    }
  | { state: "revoked"; consentId: string }
  | { state: "expired"; consentId: string }
  | { state: "not_found"; consentId: string };
