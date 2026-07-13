import { AuditAction, ConsentStatus, UserRole, type Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { allowedPassportFields } from "../../utils/fieldFilter.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { createNotification } from "../notifications/notifications.service.js";

function ensureFields(fields: string[]) {
  const invalid = fields.filter((field) => !allowedPassportFields.includes(field as never));
  if (invalid.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", `Unsupported passport fields: ${invalid.join(", ")}`);
  }
}

async function requireOwnedConsent(userId: string, consentId: string) {
  const consent = await prisma.consentRequest.findUnique({
    where: { id: consentId },
    include: { business: { include: { user: true } }, requester: true }
  });
  if (!consent) throw new ApiError(404, "NOT_FOUND", "Consent request not found.");
  if (consent.business.userId !== userId) {
    throw new ApiError(403, "FORBIDDEN", "Only the MSME owner can action this consent request.");
  }
  return consent;
}

export async function create(user: Express.User, input: { businessGstin: string; requestedFields: string[] }) {
  if (user.role !== UserRole.BUYER && user.role !== UserRole.BANK) {
    throw new ApiError(403, "FORBIDDEN", "Only buyers and banks can request access.");
  }
  ensureFields(input.requestedFields);

  const business = await prisma.business.findUnique({
    where: { gstin: input.businessGstin },
    include: { user: true }
  });
  if (!business) throw new ApiError(404, "NOT_FOUND", "No business found with this GSTIN.");

  const consent = await prisma.consentRequest.create({
    data: {
      requesterId: user.id,
      businessId: business.id,
      requestedFields: input.requestedFields as Prisma.InputJsonValue,
      status: ConsentStatus.PENDING
    },
    include: { requester: { select: { id: true, name: true, role: true, organizationName: true } } }
  });

  await writeAuditLog({
    businessId: business.id,
    actorId: user.id,
    consentRequestId: consent.id,
    action: AuditAction.CONSENT_REQUESTED,
    metadata: { requestedFields: input.requestedFields }
  });
  await createNotification({
    userId: business.userId,
    relatedConsentId: consent.id,
    message: `${consent.requester.organizationName} wants to view your Business Trust Profile.`
  });

  return consent;
}

export async function list(user: Express.User, scope: "incoming" | "outgoing") {
  if (scope === "incoming") {
    if (user.role !== UserRole.MSME) throw new ApiError(403, "FORBIDDEN", "Only MSMEs receive incoming requests.");
    const business = await prisma.business.findUnique({ where: { userId: user.id } });
    if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");
    return prisma.consentRequest.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: "desc" },
      include: { requester: { select: { id: true, name: true, role: true, organizationName: true } } }
    });
  }

  if (user.role !== UserRole.BUYER && user.role !== UserRole.BANK) {
    throw new ApiError(403, "FORBIDDEN", "Only buyers and banks have outgoing requests.");
  }
  return prisma.consentRequest.findMany({
    where: { requesterId: user.id },
    orderBy: { createdAt: "desc" },
    include: { business: true }
  });
}

export async function approve(userId: string, consentId: string, input: { approvedFields: string[]; durationDays: number }) {
  ensureFields(input.approvedFields);
  const consent = await requireOwnedConsent(userId, consentId);
  if (consent.status !== ConsentStatus.PENDING) {
    throw new ApiError(409, "CONFLICT", "Only pending requests can be approved.");
  }

  const requested = new Set(consent.requestedFields as string[]);
  const outsideRequested = input.approvedFields.filter((field) => !requested.has(field));
  if (outsideRequested.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Approved fields must be a subset of requested fields.");
  }

  const approvedAt = new Date();
  const expiresAt = new Date(approvedAt.getTime() + input.durationDays * 24 * 60 * 60 * 1000);
  const updated = await prisma.consentRequest.update({
    where: { id: consentId },
    data: {
      status: ConsentStatus.APPROVED,
      approvedFields: input.approvedFields as Prisma.InputJsonValue,
      durationDays: input.durationDays,
      approvedAt,
      expiresAt
    }
  });

  await writeAuditLog({
    businessId: consent.businessId,
    actorId: userId,
    consentRequestId: consentId,
    action: AuditAction.CONSENT_APPROVED,
    metadata: { approvedFields: input.approvedFields, durationDays: input.durationDays, expiresAt }
  });
  await createNotification({
    userId: consent.requesterId,
    relatedConsentId: consentId,
    message: `${consent.business.legalName} granted access to its Business Trust Profile.`
  });

  return updated;
}

export async function reject(userId: string, consentId: string) {
  const consent = await requireOwnedConsent(userId, consentId);
  if (consent.status !== ConsentStatus.PENDING) {
    throw new ApiError(409, "CONFLICT", "Only pending requests can be rejected.");
  }
  const updated = await prisma.consentRequest.update({
    where: { id: consentId },
    data: { status: ConsentStatus.REJECTED }
  });
  await writeAuditLog({
    businessId: consent.businessId,
    actorId: userId,
    consentRequestId: consentId,
    action: AuditAction.REJECTED
  });
  await createNotification({
    userId: consent.requesterId,
    relatedConsentId: consentId,
    message: `${consent.business.legalName} declined your Business Trust Profile request.`
  });
  return updated;
}

export async function revoke(userId: string, consentId: string) {
  const consent = await requireOwnedConsent(userId, consentId);
  if (consent.status !== ConsentStatus.APPROVED) {
    throw new ApiError(409, "CONFLICT", "Only active approved consent can be revoked.");
  }
  const updated = await prisma.consentRequest.update({
    where: { id: consentId },
    data: { status: ConsentStatus.REVOKED, revokedAt: new Date() }
  });
  await writeAuditLog({
    businessId: consent.businessId,
    actorId: userId,
    consentRequestId: consentId,
    action: AuditAction.CONSENT_REVOKED
  });
  await createNotification({
    userId: consent.requesterId,
    relatedConsentId: consentId,
    message: `${consent.business.legalName} revoked Business Trust Profile access.`
  });
  return updated;
}
