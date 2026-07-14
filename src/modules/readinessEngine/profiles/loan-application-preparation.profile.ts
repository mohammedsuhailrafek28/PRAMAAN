import { DocumentType, EvidenceStatus } from "@prisma/client";
import { defaultReadinessScoring, defaultReadinessThresholds } from "../readiness-profile.defaults.js";
import type { ReadinessProfileDefinition } from "../readiness-engine.types.js";

export const loanApplicationPreparationProfile: ReadinessProfileDefinition = {
  id: "loan-application-preparation",
  version: "1.0",
  name: "Loan Application Preparation",
  purpose: "LOAN_APPLICATION_PREPARATION",
  description: "Evaluates document and evidence preparation for approaching a lender.",
  disclaimer: "This score measures document and evidence preparation only. It does not assess creditworthiness, repayment capacity, or lender approval.",
  scoring: defaultReadinessScoring,
  thresholds: defaultReadinessThresholds,
  blockingRules: [
    { id: "loan_critical_contradiction", code: "CRITICAL_IDENTITY_CONTRADICTION", message: "A critical contradiction blocks loan-application preparation readiness.", severities: ["CRITICAL"], fields: ["pan", "gstin", "legalBusinessName"] },
    { id: "loan_high_pan_gstin", code: "HIGH_PAN_GSTIN_CONTRADICTION", message: "A high PAN/GSTIN identity contradiction blocks this preparation profile.", severities: ["HIGH"], fields: ["pan", "gstin"] }
  ],
  requirements: [
    { id: "loan_business_name", label: "Business name", description: "Business name claim is present.", category: "CLAIM", required: true, weight: 8, field: "legalBusinessName", minimumConfidence: 50 },
    { id: "loan_owner_name", label: "Owner name", description: "Owner name claim is present.", category: "CLAIM", required: true, weight: 7, field: "ownerName", minimumConfidence: 40 },
    { id: "loan_pan", label: "PAN identity", description: "PAN claim is internally checked.", category: "CLAIM", required: true, weight: 12, field: "pan", minimumEvidenceStatus: EvidenceStatus.CROSS_CHECKED, minimumConfidence: 60 },
    { id: "loan_gstin", label: "GSTIN identity", description: "GSTIN claim is internally checked where applicable.", category: "CLAIM", required: true, weight: 10, field: "gstin", minimumEvidenceStatus: EvidenceStatus.CROSS_CHECKED, minimumConfidence: 55 },
    { id: "loan_udyam", label: "Udyam identity", description: "Udyam claim is internally checked within current product scope.", category: "CLAIM", required: true, weight: 10, field: "udyamNumber", minimumEvidenceStatus: EvidenceStatus.CROSS_CHECKED, minimumConfidence: 55 },
    { id: "loan_address", label: "Address", description: "Registered address claim is present.", category: "CLAIM", required: true, weight: 7, field: "address", minimumConfidence: 40 },
    { id: "loan_bank_evidence", label: "Bank evidence", description: "Bank-statement evidence is submitted and not rejected or expired.", category: "EVIDENCE", required: true, weight: 14, acceptedDocumentTypes: [DocumentType.BANK_STATEMENT], minimumEvidenceStatus: EvidenceStatus.DOCUMENT_SUBMITTED, minimumConfidence: 40, blockOnExpiredEvidence: true, blockOnRejectedEvidence: true },
    { id: "loan_identity_evidence", label: "Business identity evidence", description: "GST or Udyam identity evidence is submitted.", category: "EVIDENCE", required: true, weight: 10, acceptedDocumentTypes: [DocumentType.GST_CERTIFICATE, DocumentType.UDYAM_CERTIFICATE], minimumEvidenceStatus: EvidenceStatus.DOCUMENT_SUBMITTED, minimumConfidence: 40 },
    { id: "loan_profile_completeness", label: "Profile completeness", description: "Profile completeness meets the lender-preparation minimum.", category: "METRIC", required: true, weight: 8, minimumMetric: { metric: "profileCompleteness", value: 70 } },
    { id: "loan_evidence_strength", label: "Evidence strength", description: "Evidence strength meets the lender-preparation minimum.", category: "METRIC", required: true, weight: 8, minimumMetric: { metric: "evidenceStrength", value: 55 } },
    { id: "loan_consistency", label: "Consistency", description: "Submitted claims meet the lender-preparation consistency minimum.", category: "METRIC", required: true, weight: 6, minimumMetric: { metric: "consistency", value: 70 } }
  ]
};
