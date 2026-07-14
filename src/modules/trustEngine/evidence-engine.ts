import { EvidenceStatus, type Document } from "@prisma/client";
import type { DocumentConfidence, TrustCheck } from "./trust-engine.types.js";
import { supportedMimeTypes } from "./rules/document.rules.js";

export const DOCUMENT_CONFIDENCE = {
  SUBMITTED_FILE: 25,
  SUPPORTED_MIME: 15,
  REQUIRED_METADATA: 5,
  DUPLICATE_PENALTY: 10,
  EXPIRED_PENALTY: 30,
  MAX_WITHOUT_SOURCE: 45
} as const;

export function assessDocuments(documents: Document[], now = new Date()): DocumentConfidence[] {
  const docTypeCounts = documents.reduce<Record<string, number>>((acc, document) => {
    acc[document.docType] = (acc[document.docType] ?? 0) + 1;
    return acc;
  }, {});

  return documents.map((document) => {
    const checks: TrustCheck[] = [];
    let confidence = 0;

    checks.push({
      type: "FILE_EXISTS",
      result: document.filePath ? "PASSED" : "FAILED",
      reason: document.filePath
        ? "A file path was recorded for this submitted evidence."
        : "No file path was recorded for this evidence."
    });
    if (document.filePath) confidence += DOCUMENT_CONFIDENCE.SUBMITTED_FILE;

    const supportedMime = supportedMimeTypes.has(document.mimeType);
    checks.push({
      type: "FILE_TYPE",
      result: supportedMime ? "PASSED" : "FAILED",
      reason: supportedMime ? "Supported MIME type." : `Unsupported MIME type: ${document.mimeType}.`
    });
    if (supportedMime) confidence += DOCUMENT_CONFIDENCE.SUPPORTED_MIME;

    const hasMetadata = Boolean(document.originalName && document.mimeType && document.docType);
    checks.push({
      type: "REQUIRED_METADATA",
      result: hasMetadata ? "PASSED" : "FAILED",
      reason: hasMetadata ? "Required upload metadata is present." : "Upload metadata is incomplete."
    });
    if (hasMetadata) confidence += DOCUMENT_CONFIDENCE.REQUIRED_METADATA;

    const duplicate = (docTypeCounts[document.docType] ?? 0) > 1;
    checks.push({
      type: "DUPLICATE_EVIDENCE",
      result: duplicate ? "WARNING" : "PASSED",
      reason: duplicate
        ? "Multiple evidence records exist for this document type."
        : "No duplicate evidence of this document type was found."
    });
    if (duplicate) confidence -= DOCUMENT_CONFIDENCE.DUPLICATE_PENALTY;

    const expired = Boolean(document.expiresAt && document.expiresAt <= now);
    checks.push({
      type: "EXPIRY",
      result: document.expiresAt ? (expired ? "FAILED" : "PASSED") : "NOT_APPLICABLE",
      reason: document.expiresAt
        ? expired
          ? "The evidence expiry date has passed."
          : "The evidence expiry date has not passed."
        : "No expiry date is stored for this evidence type."
    });
    if (expired) confidence -= DOCUMENT_CONFIDENCE.EXPIRED_PENALTY;

    checks.push({
      type: "SOURCE_VERIFICATION",
      result: "NOT_APPLICABLE",
      reason: "No authoritative source adapter was used for this assessment."
    });

    const boundedConfidence = Math.max(0, Math.min(DOCUMENT_CONFIDENCE.MAX_WITHOUT_SOURCE, confidence));
    const status = expired ? EvidenceStatus.EXPIRED : EvidenceStatus.DOCUMENT_SUBMITTED;

    return {
      documentId: document.id,
      documentType: document.docType,
      status,
      confidence: boundedConfidence,
      reason:
        status === EvidenceStatus.EXPIRED
          ? "The file was submitted, but the stored expiry date has passed. Its contents were not externally verified or parsed."
          : "A supported evidence file was submitted. Its contents were not externally verified or parsed.",
      checks
    };
  });
}
