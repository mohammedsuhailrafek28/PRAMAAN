import { type Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { runInternalCrossCheck, statusFromProfile } from "./cross-check-engine.js";

export async function calculateBusinessTrustProfile(businessId: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: { user: true, documents: true }
  });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");

  return runInternalCrossCheck(business);
}

export async function calculateAndPersistBusinessTrustProfile(businessId: string) {
  const profile = await calculateBusinessTrustProfile(businessId);
  const trustStatus = statusFromProfile(profile);

  await prisma.business.update({
    where: { id: businessId },
    data: {
      trustStatus,
      trustSummary: profile.summary as Prisma.InputJsonValue,
      lastCrossCheckedAt: new Date(profile.lastCalculatedAt)
    }
  });

  for (const document of profile.documentConfidence) {
    await prisma.document.update({
      where: { id: document.documentId },
      data: {
        evidenceStatus: document.status,
        confidence: document.confidence,
        confidenceReason: document.reason,
        crossCheckMethod: "INTERNAL_METADATA_CHECK",
        checkedAt: new Date(profile.lastCalculatedAt),
        contradictionDetails: document.checks as Prisma.InputJsonValue
      }
    });
  }

  return { profile, trustStatus };
}
