import type { DocumentType, EvidenceStatus } from "@prisma/client";

export type CheckResult = "PASSED" | "FAILED" | "WARNING" | "NOT_APPLICABLE";
export type GapSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ContradictionSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type TrustCheck = {
  type: string;
  result: CheckResult;
  reason: string;
};

export type DocumentConfidence = {
  documentId: string;
  documentType: DocumentType;
  status: EvidenceStatus;
  confidence: number;
  reason: string;
  checks: TrustCheck[];
};

export type FieldConfidence = {
  field: string;
  value: unknown;
  status: EvidenceStatus;
  confidence: number;
  reason: string;
  evidenceIds: string[];
  checks: TrustCheck[];
};

export type EvidenceGap = {
  field: string;
  severity: GapSeverity;
  message: string;
  requiredEvidenceTypes?: DocumentType[];
};

export type Contradiction = {
  field: string;
  claimedValue: string | null;
  evidenceValues: string[];
  severity: ContradictionSeverity;
  reason: string;
};

export type TrustSummary = {
  trustReadiness: number;
  profileCompleteness: number;
  evidenceStrength: number;
  consistency: number;
  freshness: number;
};

export type BusinessTrustProfile = {
  profileId?: string;
  businessId: string;
  generatedAt?: string;
  lastCalculatedAt: string;
  summary: TrustSummary;
  fieldConfidence: FieldConfidence[];
  documentConfidence: DocumentConfidence[];
  gaps: EvidenceGap[];
  contradictions: Contradiction[];
  limitations: string[];
  sourceVerificationPerformed: false;
};
