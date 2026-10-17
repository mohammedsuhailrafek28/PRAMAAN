import { AuditAction, EvidenceStatus, UserRole, VerificationStatus, type DocumentType } from "@prisma/client";
import { unlink } from "node:fs/promises";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { calculateAndPersistBusinessTrustProfile } from "../trustEngine/trust-engine.service.js";
import { deriveEvidenceLifecycle, parseLifecycleDate } from "../evidence/evidence-lifecycle.service.js";

type BusinessInput = {
  legalName: string;
  gstin: string;
  udyamNumber: string;
  pan: string;
  address: string;
  turnoverBand: string;
};

type DocumentMetadata = { issuedAt?: string; expiresAt?: string; source?: string };

export function serializeDocument(document: any) {
  return {
    id: document.id,
    businessId: document.businessId,
    docType: document.docType,
    originalName: document.originalName,
    mimeType: document.mimeType,
    verifiedFlag: document.verifiedFlag,
    evidenceStatus: document.evidenceStatus,
    confidence: document.confidence,
    confidenceReason: document.confidenceReason,
    crossCheckMethod: document.crossCheckMethod,
    source: document.source,
    issuedAt: document.issuedAt,
    checkedAt: document.checkedAt,
    expiresAt: document.expiresAt,
    contradictionDetails: document.contradictionDetails,
    uploadedAt: document.uploadedAt,
    revision: document.revision,
    isCurrent: document.isCurrent,
    previousVersionId: document.previousVersionId,
    lifecycle: deriveEvidenceLifecycle(document)
  };
}

export async function upsertProfile(userId: string, input: BusinessInput) {
  const existing = await prisma.business.findUnique({ where: { userId } });
  const business = await prisma.business.upsert({
    where: { userId },
    create: {
      userId,
      ...input,
      verificationStatus: VerificationStatus.UNVERIFIED,
      trustStatus: EvidenceStatus.SELF_DECLARED,
      trustSummary: undefined,
      lastCrossCheckedAt: undefined
    },
    update: {
      ...input,
      verificationStatus: VerificationStatus.UNVERIFIED,
      trustStatus: EvidenceStatus.SELF_DECLARED,
      trustSummary: undefined,
      lastCrossCheckedAt: undefined
    }
  });

  await writeAuditLog({
    businessId: business.id,
    actorId: userId,
    action: existing ? AuditAction.BUSINESS_PROFILE_UPDATED : AuditAction.BUSINESS_PROFILE_CREATED,
    metadata: { submittedClaims: Object.keys(input) }
  });

  return business;
}

export async function getMine(userId: string) {
  const business = await prisma.business.findUnique({
    where: { userId },
    include: {
      documents: { orderBy: [{ docType: "asc" }, { revision: "desc" }] },
      passports: { orderBy: { version: "desc" }, take: 1 }
    }
  });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");
  const conciseTrustSummary = {
    trustStatus: business.trustStatus,
    trustSummary: business.trustSummary,
    lastCrossCheckedAt: business.lastCrossCheckedAt,
    sourceVerificationPerformed: false
  };
  return { ...business, documents: business.documents.map(serializeDocument), trustOs: conciseTrustSummary };
}

export async function lookupByGstin(gstin: string) {
  const business = await prisma.business.findUnique({
    where: { gstin: gstin.trim().toUpperCase() },
    select: { id: true, legalName: true, gstin: true, trustStatus: true }
  });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");
  return business;
}

export async function uploadDocument(
  userId: string,
  docType: DocumentType,
  file: Express.Multer.File | undefined,
  metadata: DocumentMetadata = {}
) {
  if (!file) throw new ApiError(400, "VALIDATION_ERROR", "Document file is required.");

  const allowedMimes = new Set(["application/pdf", "image/png", "image/jpeg"]);
  if (!allowedMimes.has(file.mimetype)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Only PDF, PNG, and JPEG files are supported.");
  }

  const business = await prisma.business.findUnique({ where: { userId } });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");

  let issuedAt: Date | undefined;
  let expiresAt: Date | undefined;
  try {
    issuedAt = parseLifecycleDate(metadata.issuedAt, "issuedAt");
    expiresAt = parseLifecycleDate(metadata.expiresAt, "expiresAt");
    if (issuedAt && expiresAt && expiresAt.getTime() < issuedAt.getTime()) {
      throw new ApiError(400, "VALIDATION_ERROR", "expiresAt cannot be earlier than issuedAt.");
    }
  } catch (error) {
    await removeUploadedFile(file.path);
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "VALIDATION_ERROR", error instanceof Error ? error.message : "Invalid lifecycle metadata.");
  }

  let document: any;
  try {
    const committed = await withDocumentRevisionRetry(() => prisma.$transaction(async (tx) => {
      const previous = await tx.document.findFirst({
        where: { businessId: business.id, docType, isCurrent: true },
        orderBy: { revision: "desc" }
      });

      await tx.document.updateMany({ where: { businessId: business.id, docType, isCurrent: true }, data: { isCurrent: false } });
      const created = await tx.document.create({
        data: {
          businessId: business.id,
          docType,
          filePath: file.path,
          originalName: file.originalname,
          mimeType: file.mimetype,
          evidenceStatus: EvidenceStatus.DOCUMENT_SUBMITTED,
          confidence: 45,
          confidenceReason: "A supported evidence file was submitted. Its contents were not parsed or externally verified.",
          issuedAt,
          expiresAt,
          source: metadata.source?.trim() || "MSME_SUBMITTED",
          revision: (previous?.revision ?? 0) + 1,
          isCurrent: true,
          previousVersionId: previous?.id
        }
      });

      await tx.auditLog.create({
        data: {
          businessId: business.id,
          actorId: userId,
          action: previous ? AuditAction.EVIDENCE_REPLACED : AuditAction.EVIDENCE_UPLOADED,
          metadata: {
            documentId: created.id,
            documentType: created.docType,
            evidenceStatus: created.evidenceStatus,
            revision: created.revision,
            replacedDocumentId: previous?.id
          }
        }
      });
      return { document: created };
    }, { maxWait: 1000, timeout: 3000 }));
    document = committed.document;
  } catch (error) {
    await removeUploadedFile(file.path);
    if (isRetryableDocumentRevisionError(error)) {
      throw new ApiError(503, "DOCUMENT_REVISION_BUSY", "Document revision is busy; please retry the upload.");
    }
    throw error;
  }

  return serializeDocument(document);
}

const DOCUMENT_REVISION_RETRIES = 6;

async function withDocumentRevisionRetry<T>(operation: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < DOCUMENT_REVISION_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableDocumentRevisionError(error) || attempt === DOCUMENT_REVISION_RETRIES - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw lastError;
}

function isRetryableDocumentRevisionError(error: unknown) {
  const candidate = error as { code?: string; message?: string };
  const message = candidate.message?.toLowerCase() ?? "";
  return candidate.code === "P1008" || candidate.code === "P2002" || candidate.code === "P2028" || candidate.code === "P2034"
    || message.includes("database is locked")
    || message.includes("sqlite_busy")
    || message.includes("write conflict")
    || message.includes("deadlock");
}

async function removeUploadedFile(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function crossCheck(user: Express.User) {
  if (user.role !== UserRole.MSME) {
    throw new ApiError(403, "FORBIDDEN", "Only MSMEs can cross-check a business profile.");
  }

  const business = await prisma.business.findUnique({ where: { userId: user.id } });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");

  const result = await calculateAndPersistBusinessTrustProfile(business.id);
  await writeAuditLog({
    businessId: business.id,
    actorId: user.id,
    action: AuditAction.BUSINESS_CROSS_CHECKED,
    metadata: {
      trustStatus: result.trustStatus,
      summary: result.profile.summary,
      gapCount: result.profile.gaps.length,
      contradictionCount: result.profile.contradictions.length,
      sourceVerificationPerformed: false
    }
  });
  for (const gap of result.profile.gaps) {
    await writeAuditLog({
      businessId: business.id,
      actorId: user.id,
      action: AuditAction.EVIDENCE_GAP_FOUND,
      metadata: gap
    });
  }
  for (const contradiction of result.profile.contradictions) {
    await writeAuditLog({
      businessId: business.id,
      actorId: user.id,
      action: AuditAction.CONTRADICTION_FOUND,
      metadata: contradiction
    });
  }

  return {
    trustStatus: result.trustStatus,
    profile: result.profile,
    metadata: {
      mode: "INTERNAL_CROSS_CHECK",
      deprecatedAlias: false,
      sourceVerificationPerformed: false
    }
  };
}

export async function verify(user: Express.User) {
  const result = await crossCheck(user);
  return {
    ...result,
    metadata: {
      ...result.metadata,
      deprecatedAlias: true,
      message: "POST /api/business/verify is retained as a backwards-compatible alias for internal cross-checking."
    }
  };
}
