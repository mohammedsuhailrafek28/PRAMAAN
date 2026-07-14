import { DocumentType, EvidenceStatus, type Business, type Document, type User } from "@prisma/client";
import type { Contradiction, DocumentConfidence, FieldConfidence, TrustCheck } from "./trust-engine.types.js";
import { gstinRegex, panRegex, udyamRegex } from "./rules/identity.rules.js";

export const FIELD_CONFIDENCE = {
  SELF_DECLARED_BASE: 20,
  REQUIRED_PRESENT: 5,
  VALID_SYNTAX: 15,
  RELEVANT_DOCUMENT_SUBMITTED: 20,
  GSTIN_PAN_INTERNAL_MATCH: 15,
  CONTRADICTION_PENALTY_HIGH: 35,
  CONTRADICTION_PENALTY_MEDIUM: 20,
  EXPIRED_EVIDENCE_PENALTY: 20,
  MAX_WITHOUT_SOURCE: 70
} as const;

type BusinessContext = Business & { user: User; documents: Document[] };

const fieldDocumentMap: Record<string, DocumentType[]> = {
  gstin: [DocumentType.GST_CERTIFICATE],
  udyamNumber: [DocumentType.UDYAM_CERTIFICATE],
  bankAccount: [DocumentType.BANK_STATEMENT]
};

function docIdsForField(field: string, documents: Document[]) {
  const requiredTypes = fieldDocumentMap[field] ?? [];
  return documents.filter((document) => requiredTypes.includes(document.docType)).map((document) => document.id);
}

function hasCurrentDocument(field: string, documentConfidence: DocumentConfidence[]) {
  const requiredTypes = fieldDocumentMap[field] ?? [];
  return documentConfidence.some(
    (document) => requiredTypes.includes(document.documentType) && document.status !== EvidenceStatus.EXPIRED
  );
}

function hasExpiredDocument(field: string, documentConfidence: DocumentConfidence[]) {
  const requiredTypes = fieldDocumentMap[field] ?? [];
  return documentConfidence.some(
    (document) => requiredTypes.includes(document.documentType) && document.status === EvidenceStatus.EXPIRED
  );
}

function contradictionPenalty(field: string, contradictions: Contradiction[]) {
  const contradiction = contradictions.find((item) => item.field === field || item.field === "businessName" && field === "legalBusinessName");
  if (!contradiction) return 0;
  if (contradiction.severity === "HIGH" || contradiction.severity === "CRITICAL") {
    return FIELD_CONFIDENCE.CONTRADICTION_PENALTY_HIGH;
  }
  return FIELD_CONFIDENCE.CONTRADICTION_PENALTY_MEDIUM;
}

function evaluateField(input: {
  field: string;
  value: unknown;
  syntaxValid?: boolean;
  internalMatch?: boolean;
  business: BusinessContext;
  documentConfidence: DocumentConfidence[];
  contradictions: Contradiction[];
  customChecks?: TrustCheck[];
}): FieldConfidence {
  const checks: TrustCheck[] = [];
  let confidence = 0;
  const hasValue = input.value !== null && input.value !== undefined && String(input.value).trim().length > 0;

  checks.push({
    type: "CLAIM_PRESENT",
    result: hasValue ? "PASSED" : "FAILED",
    reason: hasValue ? "The business submitted this claim." : "The business has not submitted this claim."
  });
  if (hasValue) confidence += FIELD_CONFIDENCE.SELF_DECLARED_BASE + FIELD_CONFIDENCE.REQUIRED_PRESENT;

  if (input.syntaxValid !== undefined) {
    checks.push({
      type: "FORMAT",
      result: input.syntaxValid ? "PASSED" : "FAILED",
      reason: input.syntaxValid ? "The value matches the internal format rule." : "The value does not match the internal format rule."
    });
    if (input.syntaxValid) confidence += FIELD_CONFIDENCE.VALID_SYNTAX;
  }

  const currentDocument = hasCurrentDocument(input.field, input.documentConfidence);
  if ((fieldDocumentMap[input.field] ?? []).length > 0) {
    checks.push({
      type: "SUPPORTING_DOCUMENT",
      result: currentDocument ? "PASSED" : "FAILED",
      reason: currentDocument
        ? "A relevant submitted document exists for this claim."
        : "No current relevant submitted document exists for this claim."
    });
    if (currentDocument) confidence += FIELD_CONFIDENCE.RELEVANT_DOCUMENT_SUBMITTED;
  }

  if (input.internalMatch !== undefined) {
    checks.push({
      type: "INTERNAL_CONSISTENCY",
      result: input.internalMatch ? "PASSED" : "FAILED",
      reason: input.internalMatch
        ? "The claim agrees with another submitted identifier."
        : "The claim conflicts with another submitted identifier."
    });
    if (input.internalMatch) confidence += FIELD_CONFIDENCE.GSTIN_PAN_INTERNAL_MATCH;
  }

  if (hasExpiredDocument(input.field, input.documentConfidence)) {
    confidence -= FIELD_CONFIDENCE.EXPIRED_EVIDENCE_PENALTY;
    checks.push({
      type: "EXPIRED_EVIDENCE",
      result: "WARNING",
      reason: "At least one supporting evidence item for this claim is expired."
    });
  }

  confidence -= contradictionPenalty(input.field, input.contradictions);
  checks.push(...(input.customChecks ?? []));
  checks.push({
    type: "SOURCE_VERIFICATION",
    result: "NOT_APPLICABLE",
    reason: "No authoritative source adapter was used for this field."
  });

  const boundedConfidence = Math.max(0, Math.min(FIELD_CONFIDENCE.MAX_WITHOUT_SOURCE, confidence));
  const status =
    !hasValue
      ? EvidenceStatus.SELF_DECLARED
      : input.syntaxValid === false || contradictionPenalty(input.field, input.contradictions) > 0
        ? EvidenceStatus.REJECTED
        : input.syntaxValid === true || input.internalMatch === true
          ? EvidenceStatus.CROSS_CHECKED
          : currentDocument
            ? EvidenceStatus.DOCUMENT_SUBMITTED
            : EvidenceStatus.SELF_DECLARED;

  return {
    field: input.field,
    value: input.value,
    status,
    confidence: boundedConfidence,
    reason: reasonForStatus(status, boundedConfidence),
    evidenceIds: docIdsForField(input.field, input.business.documents),
    checks
  };
}

function reasonForStatus(status: EvidenceStatus, confidence: number) {
  if (status === EvidenceStatus.CROSS_CHECKED) {
    return `Internal deterministic checks support this claim with confidence ${confidence}. No source verification was performed.`;
  }
  if (status === EvidenceStatus.DOCUMENT_SUBMITTED) {
    return `Submitted evidence supports this claim with confidence ${confidence}, but contents were not source verified.`;
  }
  if (status === EvidenceStatus.REJECTED) {
    return `Internal deterministic checks found a format issue or contradiction. Confidence is ${confidence}.`;
  }
  return `This claim is self-declared with confidence ${confidence}.`;
}

export function calculateFieldConfidence(
  business: BusinessContext,
  documentConfidence: DocumentConfidence[],
  contradictions: Contradiction[]
) {
  const panMatchesGstin = business.pan && business.gstin ? business.pan === business.gstin.slice(2, 12) : undefined;
  const panMasked = business.pan && business.pan.length >= 5 ? `${business.pan.slice(0, 3)}XXXX${business.pan.slice(-1)}` : null;

  return [
    evaluateField({ field: "legalBusinessName", value: business.legalName, business, documentConfidence, contradictions }),
    evaluateField({ field: "ownerName", value: business.user.name, business, documentConfidence, contradictions }),
    evaluateField({
      field: "gstin",
      value: business.gstin,
      syntaxValid: Boolean(business.gstin && gstinRegex.test(business.gstin)),
      business,
      documentConfidence,
      contradictions
    }),
    evaluateField({
      field: "pan",
      value: panMasked,
      syntaxValid: Boolean(business.pan && panRegex.test(business.pan)),
      internalMatch: panMatchesGstin,
      business,
      documentConfidence,
      contradictions
    }),
    evaluateField({
      field: "udyamNumber",
      value: business.udyamNumber,
      syntaxValid: Boolean(business.udyamNumber && udyamRegex.test(business.udyamNumber)),
      business,
      documentConfidence,
      contradictions
    }),
    evaluateField({ field: "address", value: business.address, business, documentConfidence, contradictions }),
    evaluateField({ field: "turnoverBand", value: business.turnoverBand, business, documentConfidence, contradictions }),
    evaluateField({
      field: "bankAccount",
      value: null,
      business,
      documentConfidence,
      contradictions,
      customChecks: [
        {
          type: "STRUCTURED_BANK_METADATA",
          result: "NOT_APPLICABLE",
          reason: "The current system stores bank statement files but not extracted bank-account metadata."
        }
      ]
    })
  ];
}
