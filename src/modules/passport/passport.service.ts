import { AuditAction, VerificationStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { maskPan } from "../../utils/fieldFilter.js";
import { writeAuditLog } from "../audit/audit.service.js";

export async function generate(userId: string) {
  const business = await prisma.business.findUnique({
    where: { userId },
    include: { passports: { orderBy: { version: "desc" }, take: 1 } }
  });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");
  if (business.verificationStatus !== VerificationStatus.VERIFIED) {
    throw new ApiError(422, "BUSINESS_NOT_VERIFIED", "Business must be mock-verified first.");
  }

  const version = (business.passports[0]?.version ?? 0) + 1;
  const generatedAt = new Date();
  const snapshot = {
    legalBusinessName: business.legalName,
    gstin: business.gstin,
    gstinVerified: true,
    udyamNumber: business.udyamNumber,
    udyamVerified: true,
    panMasked: maskPan(business.pan),
    address: business.address,
    turnoverBand: business.turnoverBand,
    bankVerificationStatus: "VERIFIED_SAMPLE_DOCUMENT_PRESENT",
    complianceStatus: "MOCK_VERIFIED",
    generatedAt: generatedAt.toISOString(),
    version
  };

  const passport = await prisma.passport.create({
    data: { businessId: business.id, version, generatedAt, snapshotJson: snapshot }
  });

  await writeAuditLog({
    businessId: business.id,
    actorId: userId,
    action: AuditAction.PASSPORT_GENERATED,
    metadata: { passportId: passport.id, version }
  });

  return passport;
}

export async function getMine(userId: string) {
  const business = await prisma.business.findUnique({ where: { userId } });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");

  const passport = await prisma.passport.findFirst({
    where: { businessId: business.id },
    orderBy: { version: "desc" }
  });
  if (!passport) throw new ApiError(404, "NOT_FOUND", "Trust Passport not generated yet.");

  return passport;
}
