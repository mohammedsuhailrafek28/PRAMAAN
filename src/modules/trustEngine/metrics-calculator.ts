import { DocumentType } from "@prisma/client";
import type { Contradiction, DocumentConfidence, EvidenceGap, FieldConfidence, TrustSummary } from "./trust-engine.types.js";
import { requiredClaimFields } from "./rules/identity.rules.js";
import { requiredDocumentTypes } from "./rules/document.rules.js";
import { contradictionPenalties } from "./rules/consistency.rules.js";
import { freshness as freshnessRules } from "./rules/freshness.rules.js";

export const TRUST_READINESS_WEIGHTS = {
  PROFILE_COMPLETENESS: 0.3,
  EVIDENCE_STRENGTH: 0.35,
  CONSISTENCY: 0.25,
  FRESHNESS: 0.1
} as const;

function round(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function calculateProfileCompleteness(fieldConfidence: FieldConfidence[], documentConfidence: DocumentConfidence[]) {
  const presentClaims = requiredClaimFields.filter((field) => {
    const result = fieldConfidence.find((item) => item.field === field);
    return result?.value !== null && result?.value !== undefined && String(result.value).trim().length > 0;
  }).length;
  const presentDocuments = requiredDocumentTypes.filter((docType) =>
    documentConfidence.some((document) => document.documentType === docType)
  ).length;

  return round(((presentClaims + presentDocuments) / (requiredClaimFields.length + requiredDocumentTypes.length)) * 100);
}

export function calculateEvidenceStrength(fieldConfidence: FieldConfidence[], documentConfidence: DocumentConfidence[]) {
  const values = [...fieldConfidence.map((field) => field.confidence), ...documentConfidence.map((doc) => doc.confidence)];
  if (values.length === 0) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function calculateConsistency(contradictions: Contradiction[]) {
  const penalty = contradictions.reduce((sum, contradiction) => sum + contradictionPenalties[contradiction.severity], 0);
  return round(100 - penalty);
}

export function calculateFreshness(documentConfidence: DocumentConfidence[]) {
  if (documentConfidence.length === 0) return freshnessRules.NO_DOCUMENT_SCORE;
  const total = documentConfidence.reduce((sum, document) => {
    const expiryCheck = document.checks.find((check) => check.type === "EXPIRY");
    return sum + (expiryCheck?.result === "FAILED" ? freshnessRules.EXPIRED_DOCUMENT_SCORE : freshnessRules.CURRENT_DOCUMENT_SCORE);
  }, 0);
  return round(total / documentConfidence.length);
}

export function calculateTrustSummary(input: {
  fieldConfidence: FieldConfidence[];
  documentConfidence: DocumentConfidence[];
  contradictions: Contradiction[];
}) {
  const profileCompleteness = calculateProfileCompleteness(input.fieldConfidence, input.documentConfidence);
  const evidenceStrength = calculateEvidenceStrength(input.fieldConfidence, input.documentConfidence);
  const consistency = calculateConsistency(input.contradictions);
  const freshness = calculateFreshness(input.documentConfidence);
  const trustReadiness = round(
    TRUST_READINESS_WEIGHTS.PROFILE_COMPLETENESS * profileCompleteness +
      TRUST_READINESS_WEIGHTS.EVIDENCE_STRENGTH * evidenceStrength +
      TRUST_READINESS_WEIGHTS.CONSISTENCY * consistency +
      TRUST_READINESS_WEIGHTS.FRESHNESS * freshness
  );

  return {
    trustReadiness,
    profileCompleteness,
    evidenceStrength,
    consistency,
    freshness
  } satisfies TrustSummary;
}

export function calculateGaps(fieldConfidence: FieldConfidence[], documentConfidence: DocumentConfidence[]) {
  const gaps: EvidenceGap[] = [];
  for (const field of requiredClaimFields) {
    const result = fieldConfidence.find((item) => item.field === field);
    if (!result || result.value === null || result.value === undefined || String(result.value).trim().length === 0) {
      gaps.push({
        field,
        severity: "HIGH",
        message: `Required claim ${field} has not been submitted.`
      });
    }
  }

  for (const docType of requiredDocumentTypes) {
    if (!documentConfidence.some((document) => document.documentType === docType)) {
      gaps.push({
        field: fieldForDocumentType(docType),
        severity: "HIGH",
        message: `No ${docType} evidence has been submitted.`,
        requiredEvidenceTypes: [docType]
      });
    }
  }

  if (!fieldConfidence.some((field) => field.field === "bankAccount" && field.value)) {
    gaps.push({
      field: "bankAccount",
      severity: "HIGH",
      message: "No structured bank-account claim has been submitted.",
      requiredEvidenceTypes: [DocumentType.BANK_STATEMENT]
    });
  }

  return gaps;
}

function fieldForDocumentType(documentType: DocumentType) {
  if (documentType === DocumentType.GST_CERTIFICATE) return "gstin";
  if (documentType === DocumentType.UDYAM_CERTIFICATE) return "udyamNumber";
  return "bankAccount";
}
