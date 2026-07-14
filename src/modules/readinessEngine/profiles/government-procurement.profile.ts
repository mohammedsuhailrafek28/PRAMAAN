import { DocumentType, EvidenceStatus } from "@prisma/client";
import { defaultReadinessScoring, defaultReadinessThresholds } from "../readiness-profile.defaults.js";
import type { ReadinessProfileDefinition } from "../readiness-engine.types.js";

export const governmentProcurementProfile: ReadinessProfileDefinition = {
  id: "government-procurement",
  version: "1.0",
  name: "Government Procurement Readiness",
  purpose: "GOVERNMENT_PROCUREMENT",
  description: "Evaluates preparation for a generic government-procurement onboarding process.",
  disclaimer: "This is a general preparation profile and does not represent eligibility for any specific tender or procurement portal.",
  scoring: defaultReadinessScoring,
  thresholds: defaultReadinessThresholds,
  blockingRules: [
    { id: "procurement_identity_contradiction", code: "HIGH_IDENTITY_CONTRADICTION", message: "A high or critical identity contradiction blocks procurement readiness.", severities: ["HIGH", "CRITICAL"], fields: ["pan", "gstin", "legalBusinessName"] }
  ],
  requirements: [
    { id: "proc_business_name", label: "Business name", description: "Business name claim is present.", category: "CLAIM", required: true, weight: 8, field: "legalBusinessName", minimumConfidence: 50 },
    { id: "proc_pan", label: "PAN", description: "PAN claim is internally checked.", category: "CLAIM", required: true, weight: 10, field: "pan", minimumEvidenceStatus: EvidenceStatus.CROSS_CHECKED, minimumConfidence: 55 },
    { id: "proc_gstin", label: "GSTIN", description: "GSTIN claim is internally checked.", category: "CLAIM", required: true, weight: 10, field: "gstin", minimumEvidenceStatus: EvidenceStatus.CROSS_CHECKED, minimumConfidence: 55 },
    { id: "proc_udyam", label: "Udyam number", description: "Udyam claim is internally checked.", category: "CLAIM", required: true, weight: 10, field: "udyamNumber", minimumEvidenceStatus: EvidenceStatus.CROSS_CHECKED, minimumConfidence: 55 },
    { id: "proc_address", label: "Registered address", description: "Registered address claim is present.", category: "CLAIM", required: true, weight: 8, field: "address", minimumConfidence: 45 },
    { id: "proc_bank_evidence", label: "Bank evidence", description: "Bank evidence is submitted.", category: "EVIDENCE", required: true, weight: 10, acceptedDocumentTypes: [DocumentType.BANK_STATEMENT], minimumEvidenceStatus: EvidenceStatus.DOCUMENT_SUBMITTED, minimumConfidence: 40 },
    { id: "proc_gst_evidence", label: "GST evidence", description: "GST evidence is submitted.", category: "EVIDENCE", required: true, weight: 10, acceptedDocumentTypes: [DocumentType.GST_CERTIFICATE], minimumEvidenceStatus: EvidenceStatus.DOCUMENT_SUBMITTED, minimumConfidence: 40 },
    { id: "proc_udyam_evidence", label: "Udyam evidence", description: "Udyam evidence is submitted.", category: "EVIDENCE", required: true, weight: 10, acceptedDocumentTypes: [DocumentType.UDYAM_CERTIFICATE], minimumEvidenceStatus: EvidenceStatus.DOCUMENT_SUBMITTED, minimumConfidence: 40 },
    { id: "proc_profile_completeness", label: "Profile completeness", description: "Completeness meets the procurement-preparation minimum.", category: "METRIC", required: true, weight: 8, minimumMetric: { metric: "profileCompleteness", value: 75 } },
    { id: "proc_evidence_strength", label: "Evidence strength", description: "Evidence strength meets the procurement-preparation minimum.", category: "METRIC", required: true, weight: 8, minimumMetric: { metric: "evidenceStrength", value: 60 } },
    { id: "proc_consistency", label: "Consistency", description: "Consistency meets the procurement-preparation minimum.", category: "METRIC", required: true, weight: 5, minimumMetric: { metric: "consistency", value: 75 } },
    { id: "proc_freshness", label: "Freshness", description: "Evidence freshness meets the procurement-preparation minimum.", category: "METRIC", required: true, weight: 3, minimumMetric: { metric: "freshness", value: 60 } }
  ]
};
