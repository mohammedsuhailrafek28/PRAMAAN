import type { DocumentType, EvidenceStatus, ReadinessLevel } from "@prisma/client";
import type { BusinessTrustProfile, ContradictionSeverity, TrustSummary } from "../trustEngine/trust-engine.types.js";

export type ReadinessPurpose =
  | "VENDOR_ONBOARDING"
  | "LOAN_APPLICATION_PREPARATION"
  | "GOVERNMENT_PROCUREMENT"
  | "GOVERNMENT_SCHEME_APPLICATION";

export type SupportedBusinessField =
  | "legalBusinessName"
  | "ownerName"
  | "gstin"
  | "pan"
  | "udyamNumber"
  | "address"
  | "turnoverBand"
  | "bankAccount"
  | "businessType";

export type RequirementCategory = "CLAIM" | "EVIDENCE" | "METRIC" | "CONSISTENCY";
export type RequirementStatus = "SATISFIED" | "PARTIALLY_SATISFIED" | "MISSING" | "BLOCKED" | "MANUAL_REVIEW" | "NOT_APPLICABLE";
export type ActionPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type ReadinessRequirement = {
  id: string;
  label: string;
  description: string;
  category: RequirementCategory;
  required: boolean;
  weight: number;
  field?: SupportedBusinessField;
  acceptedDocumentTypes?: DocumentType[];
  minimumEvidenceStatus?: EvidenceStatus;
  minimumConfidence?: number;
  minimumMetric?: {
    metric: keyof Omit<TrustSummary, "trustReadiness">;
    value: number;
  };
  blockingContradictionSeverities?: ContradictionSeverity[];
  blockOnExpiredEvidence?: boolean;
  blockOnRejectedEvidence?: boolean;
  manualReviewAllowed?: boolean;
};

export type BlockingRule = {
  id: string;
  code: string;
  message: string;
  severities?: ContradictionSeverity[];
  fields?: SupportedBusinessField[];
};

export type ReadinessScoringPolicy = {
  manualReviewScore: number;
  partialStatusScoreFloor: number;
};

export type ReadinessThresholds = {
  notReadyMax: number;
  earlyStageMax: number;
  partiallyReadyMax: number;
  mostlyReadyMax: number;
};

export type ReadinessProfileDefinition = {
  id: string;
  version: string;
  name: string;
  description: string;
  purpose: ReadinessPurpose;
  disclaimer: string;
  requirements: ReadinessRequirement[];
  blockingRules: BlockingRule[];
  scoring: ReadinessScoringPolicy;
  thresholds: ReadinessThresholds;
};

export type RequirementResult = {
  requirementId: string;
  label: string;
  status: RequirementStatus;
  score: number;
  weight: number;
  reason: string;
  currentEvidenceStatus?: EvidenceStatus;
  requiredEvidenceStatus?: EvidenceStatus;
  currentConfidence?: number;
  minimumConfidence?: number;
  relatedField?: SupportedBusinessField;
  relatedEvidenceIds: string[];
  blockingIssues: BlockingIssue[];
  nextAction: ReadinessNextAction | null;
};

export type BlockingIssue = {
  code: string;
  message: string;
  relatedFields: SupportedBusinessField[];
  requirementId?: string;
};

export type ReadinessNextAction = {
  priority: ActionPriority;
  requirementId: string;
  title: string;
  description: string;
  reason: string;
  expectedStatusChange: string;
};

export type ReadinessEvaluationResponse = {
  profile: Pick<ReadinessProfileDefinition, "id" | "version" | "name" | "purpose" | "description" | "disclaimer">;
  businessId: string;
  evaluationId?: string;
  evaluatedAt: string;
  trustProfileGeneratedAt?: string;
  result: {
    score: number;
    level: ReadinessLevel;
    blocked: boolean;
    satisfiedRequirements: number;
    partialRequirements: number;
    missingRequirements: number;
    totalApplicableRequirements: number;
  };
  requirements: RequirementResult[];
  blockingIssues: BlockingIssue[];
  nextActions: ReadinessNextAction[];
  limitations: string[];
};

export type ReadinessEvaluationInput = {
  definition: ReadinessProfileDefinition;
  trustProfile: BusinessTrustProfile;
};
