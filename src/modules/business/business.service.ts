import { AuditAction, UserRole, VerificationStatus, type DocumentType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { runMockVerification } from "./verification.service.js";

type BusinessInput = {
  legalName: string;
  gstin: string;
  udyamNumber: string;
  pan: string;
  address: string;
  turnoverBand: string;
};

export async function upsertProfile(userId: string, input: BusinessInput) {
  return prisma.business.upsert({
    where: { userId },
    create: { userId, ...input, verificationStatus: VerificationStatus.UNVERIFIED },
    update: { ...input, verificationStatus: VerificationStatus.UNVERIFIED }
  });
}

export async function getMine(userId: string) {
  const business = await prisma.business.findUnique({
    where: { userId },
    include: { documents: true, passports: { orderBy: { version: "desc" }, take: 1 } }
  });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");
  return business;
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

  return prisma.document.create({
    data: {
      businessId: business.id,
      docType,
      filePath: file.path,
      originalName: file.originalname,
      mimeType: file.mimetype
    }
  });
}

export async function verify(user: Express.User) {
  if (user.role !== UserRole.MSME) {
    throw new ApiError(403, "FORBIDDEN", "Only MSMEs can verify a business profile.");
  }

  const business = await prisma.business.findUnique({ where: { userId: user.id } });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");

  const verification = await runMockVerification(business.id);
  await writeAuditLog({
    businessId: business.id,
    actorId: user.id,
    action: AuditAction.BUSINESS_VERIFIED,
    metadata: {
      verificationStatus: verification.verificationStatus,
      verificationMode: verification.metadata.verificationMode,
      fieldResults: verification.fieldResults
    }
  });

  return verification;
}
