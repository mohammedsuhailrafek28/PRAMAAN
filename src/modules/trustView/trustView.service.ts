import { AuditAction, ConsentStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { filterPassportFields } from "../../utils/fieldFilter.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { createNotification } from "../notifications/notifications.service.js";

export async function getTrustView(userId: string, consentRequestId: string) {
  const consent = await prisma.consentRequest.findUnique({
    where: { id: consentRequestId },
    include: {
      business: { include: { user: true } },
      requester: { select: { id: true, name: true, role: true, organizationName: true } }
    }
  });

  if (!consent) throw new ApiError(404, "NOT_FOUND", "Consent request not found.");
  if (consent.requesterId !== userId) {
    throw new ApiError(403, "FORBIDDEN", "Only the original requester can open this Trust View.");
  }
  if (consent.status === ConsentStatus.REVOKED) {
    throw new ApiError(410, "CONSENT_REVOKED", "Access has been revoked by the business.");
  }
  if (consent.status !== ConsentStatus.APPROVED) {
    throw new ApiError(403, "FORBIDDEN", "Consent is not approved.");
  }
  if (!consent.expiresAt || consent.expiresAt <= new Date()) {
    await prisma.consentRequest.update({
      where: { id: consent.id },
      data: { status: ConsentStatus.EXPIRED }
    });
    await writeAuditLog({
      businessId: consent.businessId,
      actorId: userId,
      consentRequestId: consent.id,
      action: AuditAction.EXPIRED,
      metadata: { expiredAt: new Date().toISOString() }
    });
    await createNotification({
      userId,
      relatedConsentId: consent.id,
      message: `Business Trust Profile access for ${consent.business.legalName} has expired.`
    });
    throw new ApiError(410, "CONSENT_EXPIRED", "Access has expired.");
  }

  const passport = await prisma.passport.findFirst({
    where: { businessId: consent.businessId },
    orderBy: { version: "desc" }
  });
  if (!passport) throw new ApiError(404, "NOT_FOUND", "Business Trust Profile not generated yet.");

  const viewedAt = new Date();
  const approvedFields = (consent.approvedFields ?? []) as string[];
  const sharedFields = filterPassportFields(passport.snapshotJson, approvedFields);

  await writeAuditLog({
    businessId: consent.businessId,
    actorId: userId,
    consentRequestId: consent.id,
    action: AuditAction.TRUST_PROFILE_VIEWED,
    metadata: { viewedAt: viewedAt.toISOString(), fields: Object.keys(sharedFields) }
  });

  return {
    businessId: consent.businessId,
    consentId: consent.id,
    sharedFields,
    metadata: {
      accessGrantedAt: consent.approvedAt,
      expiresAt: consent.expiresAt,
      viewedAt
    }
  };
}
