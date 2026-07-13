import { AuditAction, type Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { calculateAndPersistBusinessTrustProfile } from "../trustEngine/trust-engine.service.js";
import { composeGeneratedTrustProfile } from "../trustEngine/trust-profile-composer.js";

export async function generate(userId: string) {
  const business = await prisma.business.findUnique({
    where: { userId },
    include: { passports: { orderBy: { version: "desc" }, take: 1 } }
  });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");
  if (!business.legalName && !business.gstin && !business.pan && !business.udyamNumber) {
    throw new ApiError(422, "INSUFFICIENT_BUSINESS_DATA", "Submit business claims before generating a Business Trust Profile.");
  }

  const version = (business.passports[0]?.version ?? 0) + 1;
  const generatedAt = new Date();
  const { profile } = await calculateAndPersistBusinessTrustProfile(business.id);

  const passport = await prisma.passport.create({
    data: { businessId: business.id, version, generatedAt, snapshotJson: {} }
  });
  const snapshot = composeGeneratedTrustProfile({
    profileId: passport.id,
    generatedAt,
    version,
    profile
  });
  const updatedPassport = await prisma.passport.update({
    where: { id: passport.id },
    data: { snapshotJson: snapshot as Prisma.InputJsonValue }
  });

  await writeAuditLog({
    businessId: business.id,
    actorId: userId,
    action: AuditAction.TRUST_PROFILE_GENERATED,
    metadata: { profileId: passport.id, version, summary: profile.summary, sourceVerificationPerformed: false }
  });

  return updatedPassport;
}

export async function getMine(userId: string) {
  const business = await prisma.business.findUnique({ where: { userId } });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");

  const passport = await prisma.passport.findFirst({
    where: { businessId: business.id },
    orderBy: { version: "desc" }
  });
  if (!passport) throw new ApiError(404, "NOT_FOUND", "Business Trust Profile not generated yet.");

  return passport;
}
