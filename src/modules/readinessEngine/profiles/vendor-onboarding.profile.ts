import { DocumentType, EvidenceStatus } from "@prisma/client";
import { defaultReadinessScoring, defaultReadinessThresholds } from "../readiness-profile.defaults.js";
import type { ReadinessProfileDefinition } from "../readiness-engine.types.js";

export const vendorOnboardingProfile: ReadinessProfileDefinition = {
  id: "vendor-onboarding",
  version: "1.0",
  name: "Vendor Onboarding Readiness",
  purpose: "VENDOR_ONBOARDING",
  description: "Evaluates whether submitted claims and evidence are organized for a typical B2B vendor onboarding process.",
  disclaimer: "This is a preparation profile. Final buyer requirements vary by institution, buyer policy, and jurisdiction.",
  scoring: defaultReadinessScoring,
  thresholds: defaultReadinessThresholds,
  blockingRules: [
    {
      id: "vendor_identity_contradiction",
      code: "HIGH_IDENTITY_CONTRADICTION",
      message: "A high or critical identity contradiction blocks vendor-onboarding readiness.",
      severities: ["HIGH", "CRITICAL"],
      fields: ["pan", "gstin", "legalBusinessName"]
    }
  ],
  requirements: [
    { id: "vendor_business_name", label: "Business name", description: "Business name claim is present.", category: "CLAIM", required: true, weight: 12, field: "legalBusinessName", minimumConfidence: 50 },
    { id: "vendor_owner_name", label: "Owner name", description: "Owner name claim is present.", category: "CLAIM", required: true, weight: 8, field: "ownerName", minimumConfidence: 40 },
    { id: "vendor_pan", label: "PAN evidence", description: "PAN claim is internally checked where possible.", category: "CLAIM", required: true, weight: 14, field: "pan", minimumEvidenceStatus: EvidenceStatus.CROSS_CHECKED, minimumConfidence: 55 },
    { id: "vendor_gstin", label: "GSTIN evidence", description: "GSTIN claim has syntax support and submitted GST evidence.", category: "CLAIM", required: true, weight: 14, field: "gstin", minimumEvidenceStatus: EvidenceStatus.CROSS_CHECKED, minimumConfidence: 55 },
    { id: "vendor_address", label: "Registered address", description: "Registered address claim is present.", category: "CLAIM", required: true, weight: 8, field: "address", minimumConfidence: 40 },
    { id: "vendor_bank_evidence", label: "Bank-account evidence", description: "A supported bank-statement evidence file is submitted.", category: "EVIDENCE", required: true, weight: 14, acceptedDocumentTypes: [DocumentType.BANK_STATEMENT], minimumEvidenceStatus: EvidenceStatus.DOCUMENT_SUBMITTED, minimumConfidence: 40 },
    { id: "vendor_gst_evidence", label: "GST evidence", description: "A supported GST certificate evidence file is submitted.", category: "EVIDENCE", required: true, weight: 10, acceptedDocumentTypes: [DocumentType.GST_CERTIFICATE], minimumEvidenceStatus: EvidenceStatus.DOCUMENT_SUBMITTED, minimumConfidence: 40 },
    { id: "vendor_evidence_strength", label: "Evidence strength", description: "Evidence strength meets the vendor onboarding minimum.", category: "METRIC", required: true, weight: 10, minimumMetric: { metric: "evidenceStrength", value: 45 } },
    { id: "vendor_consistency", label: "Consistency", description: "Submitted claims are sufficiently consistent.", category: "METRIC", required: true, weight: 10, minimumMetric: { metric: "consistency", value: 65 } },
    { id: "vendor_udyam_optional", label: "Udyam support", description: "Optional Udyam claim and evidence improve preparation.", category: "CLAIM", required: false, weight: 4, field: "udyamNumber", minimumEvidenceStatus: EvidenceStatus.CROSS_CHECKED, minimumConfidence: 45, manualReviewAllowed: true }
  ]
};
