// Owner-facing evidence review: reads the owner's own current documents, extracts, reconciles and plans.
//
// Extracted values are computed from the stored file and returned only to the owning MSME; nothing extracted is
// persisted, logged, or put in a notification or audit row. The one exception is a short-lived in-memory result cache
// (see `ExtractionCache`) that exists so OCR is not repeated when the owner confirms a correction right after a review.
// Claims are changed only by an explicit owner confirmation that re-derives the value on the server.

import { AuditAction } from "@prisma/client";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { upsertProfile } from "../business/business.service.js";
import { deriveEvidenceLifecycle } from "../evidence/evidence-lifecycle.service.js";
import { PDF_LIMITS } from "./pdf-text.js";
import type { DocumentExtraction } from "./field-extractors.js";
import { extractDocumentHybrid } from "./hybrid-extractor.js";
import { planEvidenceChallenge, type CorrectableClaim, type PlanAction } from "./planner.js";
import { displayValue, type ClaimReconciliation } from "./reconciliation.js";

export const REVIEW_LIMITATIONS = [
  "Values were read from the text of the files you uploaded. Reading a document does not authenticate it.",
  "No government, GST, Udyam, bank, Account Aggregator or DigiLocker source was consulted.",
  "Scanned pages are read with local OCR (no document leaves this server). OCR can misread characters, so values read from scans are marked for you to check.",
  "Complex layouts, unusual fonts or poor scans may not be readable; in that case Pramaan says so instead of guessing.",
  "Nothing shown here is shared with any requester. Sharing still requires your separate consent.",
  "Existing Passport snapshots are not changed by this review."
] as const;

async function readStoredFile(filePath: string): Promise<Buffer | null> {
  const root = path.resolve(env.UPLOAD_DIR);
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null; // never read outside the upload directory
  try {
    const info = await stat(resolved);
    if (!info.isFile() || info.size > PDF_LIMITS.maxBytes) return null;
    return await readFile(resolved);
  } catch {
    return null;
  }
}

async function loadOwnerState(userId: string) {
  const business = await prisma.business.findUnique({
    where: { userId },
    include: { user: { select: { organizationName: true } }, documents: { where: { isCurrent: true }, orderBy: [{ docType: "asc" }, { revision: "desc" }] } }
  });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");
  return business;
}

/**
 * Short-lived, bounded, in-memory cache of STRUCTURED results (no page text), keyed by owner + document + file hash +
 * pipeline version, so a confirmed correction does not trigger a second OCR run. Entries expire and are never written to disk.
 * Trade-off: owner-only values live in process memory for up to the TTL; per-process, not shared across instances.
 */
const PIPELINE_VERSION = "hybrid-1";
class ExtractionCache {
  private readonly entries = new Map<string, { at: number; value: DocumentExtraction }>();
  constructor(private readonly ttlMs: number, private readonly max: number) {}
  get(key: string, now: number): DocumentExtraction | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (now - hit.at > this.ttlMs) { this.entries.delete(key); return null; }
    this.entries.delete(key); this.entries.set(key, hit); // refresh recency
    return hit.value;
  }
  set(key: string, value: DocumentExtraction, now: number) {
    this.entries.set(key, { at: now, value });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value as string);
  }
  clear() { this.entries.clear(); }
}
const extractionCache = new ExtractionCache(10 * 60 * 1000, 24);
export const clearExtractionCache = () => extractionCache.clear();

async function extractAll(businessId: string, documents: Array<{ id: string; docType: any; mimeType: string; filePath: string }>): Promise<DocumentExtraction[]> {
  const results: DocumentExtraction[] = [];
  for (const document of documents.slice(0, 6)) {
    const bytes = await readStoredFile(document.filePath);
    if (!bytes) {
      results.push({ documentId: document.id, docType: document.docType, status: "UNREADABLE", reason: "NO_EXTRACTABLE_TEXT", fields: [], pageCount: 0, engine: "HYBRID", ocrPages: 0, pages: [], table: null, needsReview: false, elapsedMs: null });
      continue;
    }
    const key = `${businessId}:${document.id}:${createHash("sha256").update(bytes).digest("hex")}:${PIPELINE_VERSION}`;
    const cached = extractionCache.get(key, Date.now());
    if (cached) { results.push(cached); continue; }
    const result = await extractDocumentHybrid({ documentId: document.id, docType: document.docType, mimeType: document.mimeType, bytes });
    // A degraded or busy result is not cached, so the next review can try the full pipeline again.
    if (result.engine === "HYBRID" && result.status !== "UNSUPPORTED") extractionCache.set(key, result, Date.now());
    results.push(result);
  }
  return results;
}

function serializeAction(action: PlanAction) {
  if (action.type === "SUBMIT_DOCUMENT") return action;
  const { proposedValue, ...rest } = action;
  return { ...rest, proposedDisplay: displayValue(action.claim, proposedValue) };
}

function serializeReconciliation(item: ClaimReconciliation) {
  return {
    claim: item.claim,
    status: item.status,
    declaredDisplay: displayValue(item.claim, item.declaredValue),
    summary: item.summary,
    crossDocumentConflict: item.crossDocumentConflict,
    needsOwnerReview: item.needsOwnerReview,
    comparisons: item.comparisons.map((comparison) => ({
      documentId: comparison.documentId,
      docType: comparison.docType,
      sourceField: comparison.sourceField,
      outcome: comparison.outcome,
      similarity: comparison.similarity,
      extractedDisplay: displayValue(item.claim === "bankAccount" ? "bankAccount" : item.claim, comparison.extractedValue),
      page: comparison.page,
      line: comparison.line,
      confidence: comparison.confidence,
      method: comparison.method,
      needsReview: comparison.needsReview
    }))
  };
}

export async function getReview(userId: string, now = new Date()) {
  const business = await loadOwnerState(userId);
  const extractions = await extractAll(business.id, business.documents);
  const { issues, reconciliations, plan } = planEvidenceChallenge({ business, organizationName: business.user.organizationName, documents: business.documents, extractions, now });
  return {
    generatedAt: now.toISOString(),
    sourceVerificationPerformed: false as const,
    limitations: REVIEW_LIMITATIONS,
    documents: business.documents.map((document) => {
      const extraction = extractions.find((item) => item.documentId === document.id);
      return {
        documentId: document.id,
        docType: document.docType,
        originalName: document.originalName,
        revision: document.revision,
        lifecycleState: deriveEvidenceLifecycle(document, now).state,
        extractionStatus: extraction?.status ?? "UNREADABLE",
        extractionReason: extraction?.reason ?? null,
        pageCount: extraction?.pageCount ?? 0,
        engine: extraction?.engine ?? "HYBRID",
        ocrPages: extraction?.ocrPages ?? 0,
        needsReview: extraction?.needsReview ?? false,
        pages: (extraction?.pages ?? []).map((page) => ({ page: page.page, method: page.method, ocrConfidence: page.ocrConfidence, rotationDegrees: page.rotationDegrees })),
        table: extraction?.table
          ? {
              rowCount: extraction.table.rowCount,
              balanceChecked: extraction.table.balanceChecked,
              balanceConsistent: extraction.table.balanceConsistent,
              reliable: extraction.table.reliable,
              // Amounts and narrations are the owner's own statement lines; a bounded preview is returned to the owner only.
              preview: extraction.table.rows.slice(0, 8).map((row) => ({ page: row.page, date: row.date, description: row.description.slice(0, 80), debit: row.debit, credit: row.credit, balance: row.balance, balanceCheck: row.balanceCheck, confidence: row.confidence }))
            }
          : null,
        fields: (extraction?.fields ?? []).map((field) => ({
          field: field.field,
          status: field.status,
          displayValue: displayValue(field.field, field.value),
          page: field.page,
          line: field.line,
          confidence: field.confidence,
          note: field.note,
          method: field.method,
          region: field.region,
          needsReview: field.needsReview,
          reviewReasons: field.reviewReasons
        }))
      };
    }),
    reconciliations: reconciliations.map(serializeReconciliation),
    issues,
    plan: { ...plan, actions: plan.actions.map(serializeAction) }
  };
}

export type CorrectionRequest = { claim: CorrectableClaim; sourceDocumentId: string | null; source: "DOCUMENT_TEXT" | "GSTIN_EMBEDDED_PAN" | "ACCOUNT_ORGANIZATION_NAME" };

/** Applies one owner-confirmed correction. The value is re-derived on the server; the client never supplies it. */
export async function confirmCorrection(userId: string, request: CorrectionRequest, now = new Date()) {
  const business = await loadOwnerState(userId);
  const extractions = await extractAll(business.id, business.documents);
  const { plan } = planEvidenceChallenge({ business, organizationName: business.user.organizationName, documents: business.documents, extractions, now });
  const action = plan.actions.find((item) => item.type === "CORRECT_CLAIM" && item.claim === request.claim && item.source === request.source && item.sourceDocumentId === request.sourceDocumentId);
  if (!action || action.type !== "CORRECT_CLAIM") {
    throw new ApiError(409, "CORRECTION_NOT_PROPOSED", "That correction is not currently proposed for your profile. Refresh the review and try again.");
  }
  // The client names which proposal it confirms; the value always comes from the server-side plan.
  await upsertProfile(userId, {
    legalName: business.legalName ?? "",
    gstin: business.gstin ?? "",
    udyamNumber: business.udyamNumber ?? "",
    pan: business.pan ?? "",
    address: business.address ?? "",
    turnoverBand: business.turnoverBand ?? "",
    [request.claim]: action.proposedValue
  });
  await writeAuditLog({
    businessId: business.id,
    actorId: userId,
    action: AuditAction.BUSINESS_PROFILE_UPDATED,
    metadata: { origin: "EVIDENCE_REVIEW_OWNER_CONFIRMED_CORRECTION", claim: request.claim, source: request.source }
  });
  return getReview(userId, now);
}
