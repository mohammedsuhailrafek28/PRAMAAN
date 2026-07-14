import { DocumentType, EvidenceStatus } from "@prisma/client";
import { defaultReadinessScoring, defaultReadinessThresholds } from "../readiness-profile.defaults.js";
import type { ReadinessProfileDefinition } from "../readiness-engine.types.js";

export const governmentSchemeApplicationProfile: ReadinessProfileDefinition = {
  id: "government-scheme-application",
  version: "1.0",
  name: "Government Scheme Application Readiness",
  purpose: "GOVERNMENT_SCHEME_APPLICATION",
  description: "Evaluates whether core MSME evidence is organized for a generic scheme application.",
  disclaimer: "This profile does not determine eligibility for a specific government scheme. Actual scheme requirements must be checked separately.",
  scoring: defaultReadinessScoring,
  thresholds: defaultReadinessThresholds,
  blockingRules: [
    { id: "scheme_critical_contradiction", code: "CRITICAL_IDENTITY_CONTRADICTION", message: "A critical identity contradiction blocks scheme-application readiness.", severities: ["CRITICAL"], fields: ["pan", "gstin", "legalBusinessName"] }
  ],
  requirements: [
    { id: "scheme_business_name", label: "Business name", description: "Business name claim is present.", category: "CLAIM", required: true, weight: 10, field: "legalBusinessName", minimumConfidence: 45 },
    { id: "scheme_owner_name", label: "Owner name", description: "Owner name claim is present.", category: "CLAIM", required: true, weight: 8, field: "ownerName", minimumConfidence: 40 },
    { id: "scheme_pan", label: "PAN", description: "PAN claim is internally checked.", category: "CLAIM", required: true, weight: 12, field: "pan", minimumEvidenceStatus: EvidenceStatus.CROSS_CHECKED, minimumConfidence: 55 },
    { id: "scheme_udyam", label: "Udyam number", description: "Udyam claim is internally checked.", category: "CLAIM", required: true, weight: 14, field: "udyamNumber", minimumEvidenceStatus: EvidenceStatus.CROSS_CHECKED, minimumConfidence: 55 },
    { id: "scheme_address", label: "Registered address", description: "Registered address claim is present.", category: "CLAIM", required: true, weight: 8, field: "address", minimumConfidence: 40 },
    { id: "scheme_udyam_evidence", label: "Udyam evidence", description: "Udyam evidence is submitted.", category: "EVIDENCE", required: true, weight: 18, acceptedDocumentTypes: [DocumentType.UDYAM_CERTIFICATE], minimumEvidenceStatus: EvidenceStatus.DOCUMENT_SUBMITTED, minimumConfidence: 40 },
    { id: "scheme_identity_evidence", label: "Identity evidence", description: "PAN-supporting GST evidence or Udyam evidence is submitted.", category: "EVIDENCE", required: true, weight: 12, acceptedDocumentTypes: [DocumentType.GST_CERTIFICATE, DocumentType.UDYAM_CERTIFICATE], minimumEvidenceStatus: EvidenceStatus.DOCUMENT_SUBMITTED, minimumConfidence: 40 },
    { id: "scheme_profile_completeness", label: "Profile completeness", description: "Completeness meets the scheme-preparation minimum.", category: "METRIC", required: true, weight: 12, minimumMetric: { metric: "profileCompleteness", value: 70 } },
    { id: "scheme_gstin_optional", label: "GSTIN support", description: "Optional GSTIN claim and evidence may support some schemes.", category: "CLAIM", required: false, weight: 4, field: "gstin", minimumEvidenceStatus: EvidenceStatus.CROSS_CHECKED, minimumConfidence: 50, manualReviewAllowed: true },
    { id: "scheme_bank_optional", label: "Bank evidence", description: "Optional bank evidence may support some schemes.", category: "EVIDENCE", required: false, weight: 2, acceptedDocumentTypes: [DocumentType.BANK_STATEMENT], minimumEvidenceStatus: EvidenceStatus.DOCUMENT_SUBMITTED, minimumConfidence: 40, manualReviewAllowed: true }
  ]
};
