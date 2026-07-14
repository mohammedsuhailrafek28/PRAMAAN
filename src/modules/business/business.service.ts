import { AuditAction, EvidenceStatus, UserRole, VerificationStatus, type DocumentType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { calculateAndPersistBusinessTrustProfile } from "../trustEngine/trust-engine.service.js";

type BusinessInput = {
  legalName: string;
  gstin: string;
  udyamNumber: string;
  pan: string;
  address: string;
  turnoverBand: string;
};

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
      documents: true,
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
  return { ...business, trustOs: conciseTrustSummary };
}

export async function uploadDocument(
  userId: string,
  docType: DocumentType,
  file: Express.Multer.File | undefined
) {
  if (!file) throw new ApiError(400, "VALIDATION_ERROR", "Document file is required.");

  const allowedMimes = new Set(["application/pdf", "image/png", "image/jpeg"]);
  if (!allowedMimes.has(file.mimetype)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Only PDF, PNG, and JPEG files are supported.");
  }

  const business = await prisma.business.findUnique({ where: { userId } });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");

  const document = await prisma.document.create({
    data: {
      businessId: business.id,
      docType,
      filePath: file.path,
      originalName: file.originalname,
      mimeType: file.mimetype,
      evidenceStatus: EvidenceStatus.DOCUMENT_SUBMITTED,
      confidence: 45,
      confidenceReason: "A supported evidence file was submitted. Its contents were not parsed or externally verified."
    }
  });

  await writeAuditLog({
    businessId: business.id,
    actorId: userId,
    action: AuditAction.DOCUMENT_SUBMITTED,
    metadata: {
      documentId: document.id,
      documentType: document.docType,
      evidenceStatus: document.evidenceStatus
    }
  });

  return document;
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
