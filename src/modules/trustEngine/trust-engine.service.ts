import { type Document, type Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { runInternalCrossCheck, statusFromProfile } from "./cross-check-engine.js";

/** The shared client or an interactive-transaction client. */
export type TrustDb = Pick<typeof prisma, "business" | "document">;

export const CROSS_CHECK_METHOD = "INTERNAL_METADATA_CHECK";

/** Runs the engine and also returns the exact document rows it assessed. */
export async function calculateBusinessTrustProfileWithInputs(businessId: string, db: TrustDb = prisma) {
  const business = await db.business.findUnique({
    where: { id: businessId },
    include: { user: true, documents: { where: { isCurrent: true } } }
  });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");

  return { profile: runInternalCrossCheck(business), documents: business.documents as Document[] };
}

export async function calculateBusinessTrustProfile(businessId: string, db: TrustDb = prisma) {
  return (await calculateBusinessTrustProfileWithInputs(businessId, db)).profile;
}

export async function calculateAndPersistBusinessTrustProfileWithInputs(businessId: string, db: TrustDb = prisma) {
  const { profile, documents } = await calculateBusinessTrustProfileWithInputs(businessId, db);
  const trustStatus = statusFromProfile(profile);

  await db.business.update({
    where: { id: businessId },
    data: {
      trustStatus,
      trustSummary: profile.summary as Prisma.InputJsonValue,
      lastCrossCheckedAt: new Date(profile.lastCalculatedAt)
    }
  });

  for (const document of profile.documentConfidence) {
    await db.document.update({
      where: { id: document.documentId },
      data: {
        evidenceStatus: document.status,
        confidence: document.confidence,
        confidenceReason: document.reason,
        crossCheckMethod: CROSS_CHECK_METHOD,
        checkedAt: new Date(profile.lastCalculatedAt),
        contradictionDetails: document.checks as Prisma.InputJsonValue
      }
    });
  }

  return { profile, trustStatus, documents };
}

export async function calculateAndPersistBusinessTrustProfile(businessId: string, db: TrustDb = prisma) {
  const { profile, trustStatus } = await calculateAndPersistBusinessTrustProfileWithInputs(businessId, db);
  return { profile, trustStatus };
}
