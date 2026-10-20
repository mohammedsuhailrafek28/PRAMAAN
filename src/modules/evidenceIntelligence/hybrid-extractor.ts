// Entry point of the document-understanding pipeline.
//
// Order of preference: the hybrid worker (embedded text + selective OCR + layout/table reconstruction) -> the original
// dependency-free PDF parser as a degraded fallback when the worker cannot run -> an explicit "unsupported" result.
// A fallback result is labelled `engine: "LEGACY"` so the owner and the operators can see it was produced in degraded mode.

import type { DocumentType } from "@prisma/client";
import { extractDomainFields } from "./domain-extraction.js";
import { extractDocumentLegacy, SUPPORTED_EXTRACTION_TYPES, type DocumentExtraction } from "./field-extractors.js";
import { PDF_LIMITS } from "./pdf-text.js";
import { runWorker, type WorkerKind } from "./worker-client.js";

export type HybridInput = { documentId: string; docType: DocumentType; mimeType: string; bytes: Buffer };

const hasPdfHeader = (bytes: Buffer) => bytes.subarray(0, 1024).includes("%PDF-");
const isPng = (bytes: Buffer) => bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const isJpeg = (bytes: Buffer) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

function blank(input: HybridInput, status: DocumentExtraction["status"], reason: string): DocumentExtraction {
  return { documentId: input.documentId, docType: input.docType, status, reason, fields: [], pageCount: 0, engine: "HYBRID", ocrPages: 0, pages: [], table: null, needsReview: false, elapsedMs: null };
}

export async function extractDocumentHybrid(input: HybridInput): Promise<DocumentExtraction> {
  if (!SUPPORTED_EXTRACTION_TYPES.has(input.docType)) return blank(input, "UNSUPPORTED", "TYPE_NOT_SUPPORTED");
  if (input.bytes.length > PDF_LIMITS.maxBytes) return blank(input, "REJECTED", "TOO_LARGE");
  // The client-supplied MIME type is never trusted; the bytes decide what the file is.
  let kind: WorkerKind;
  if (input.mimeType === "application/pdf") {
    if (!hasPdfHeader(input.bytes)) return blank(input, "UNSUPPORTED", "NOT_A_PDF");
    kind = "pdf";
  } else if (input.mimeType === "image/png") {
    if (!isPng(input.bytes)) return blank(input, "UNSUPPORTED", "NOT_AN_IMAGE");
    kind = "png";
  } else if (input.mimeType === "image/jpeg") {
    if (!isJpeg(input.bytes)) return blank(input, "UNSUPPORTED", "NOT_AN_IMAGE");
    kind = "jpeg";
  } else {
    return blank(input, "UNSUPPORTED", "NOT_A_PDF");
  }

  const run = await runWorker(input.bytes, kind);
  if (run) return extractDomainFields({ documentId: input.documentId, docType: input.docType, output: run.output, wallMs: run.wallMs });
  if (kind === "pdf") { const legacy = extractDocumentLegacy(input); return { ...legacy, reason: legacy.reason ?? "WORKER_UNAVAILABLE_FALLBACK" }; }
  return blank(input, "UNSUPPORTED", "WORKER_UNAVAILABLE");
}
