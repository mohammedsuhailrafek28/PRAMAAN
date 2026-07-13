import { EvidenceStatus, type Business, type Document, type User } from "@prisma/client";
import { assessDocuments } from "./evidence-engine.js";
import { calculateFieldConfidence } from "./confidence-calculator.js";
import { detectContradictions } from "./contradiction-detector.js";
import { calculateGaps, calculateTrustSummary } from "./metrics-calculator.js";
import type { BusinessTrustProfile } from "./trust-engine.types.js";

type BusinessContext = Business & { user: User; documents: Document[] };

export function runInternalCrossCheck(business: BusinessContext, now = new Date()): BusinessTrustProfile {
  const documentConfidence = assessDocuments(business.documents, now);
  const contradictions = detectContradictions(business);
  const fieldConfidence = calculateFieldConfidence(business, documentConfidence, contradictions);
  const gaps = calculateGaps(fieldConfidence, documentConfidence);
  const summary = calculateTrustSummary({ fieldConfidence, documentConfidence, contradictions });

  return {
    businessId: business.id,
    lastCalculatedAt: now.toISOString(),
    summary,
    fieldConfidence,
    documentConfidence,
    gaps,
    contradictions,
    limitations: [
      "No authoritative GST, Udyam, bank, Account Aggregator, DigiLocker, or government registry source was queried.",
      "Uploaded document contents were not parsed; only upload metadata and supported file type were assessed.",
      "Values rely on submitted business claims and submitted evidence records.",
      "Confidence comes from deterministic internal consistency checks and is not external verification."
    ],
    sourceVerificationPerformed: false
  };
}

export function statusFromProfile(profile: BusinessTrustProfile) {
  if (profile.contradictions.some((item) => item.severity === "HIGH" || item.severity === "CRITICAL")) {
    return EvidenceStatus.REJECTED;
  }
  return EvidenceStatus.CROSS_CHECKED;
}
