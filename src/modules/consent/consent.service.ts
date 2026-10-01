import { AuditAction, ConsentStatus, UserRole, type Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { validateDisclosureKeys } from "../../utils/disclosureCatalogue.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { createNotification } from "../notifications/notifications.service.js";

type ConsentInput = { businessGstin: string; requestedFields: string[]; requestedEvidenceTypes?: string[]; purpose?: string };
type ApprovalInput = { approvedFields: string[]; approvedEvidenceTypes?: string[]; durationDays: number };
const unique = (values: string[] = []) => [...new Set(values)];

function validateInput(fields: string[], evidenceTypes: string[]) {
  const invalid = [...validateDisclosureKeys(fields, "FIELD"), ...validateDisclosureKeys(evidenceTypes, "EVIDENCE")];
  if (invalid.length) throw new ApiError(400, "VALIDATION_ERROR", `Unsupported disclosures: ${invalid.join(", ")}`);
  if (!fields.length && !evidenceTypes.length) throw new ApiError(400, "VALIDATION_ERROR", "At least one field or evidence type is required.");
}

export async function expireIfNeeded(consent: any) {
  if (consent.status !== ConsentStatus.APPROVED || !consent.expiresAt || consent.expiresAt > new Date()) return consent;
  const result = await prisma.consentRequest.updateMany({ where: { id: consent.id, status: ConsentStatus.APPROVED }, data: { status: ConsentStatus.EXPIRED } });
  if (result.count) {
    await writeAuditLog({ businessId: consent.businessId, actorId: consent.business?.userId ?? consent.requesterId, consentRequestId: consent.id, action: AuditAction.CONSENT_EXPIRED, metadata: { expiredAt: consent.expiresAt.toISOString() } });
    await createNotification({ userId: consent.requesterId, relatedConsentId: consent.id, message: `${consent.business?.legalName ?? "Business"} Business Trust Profile access has expired.` });
  }
  return { ...consent, status: ConsentStatus.EXPIRED };
}

async function loadConsent(id: string) {
  const consent = await prisma.consentRequest.findUnique({ where: { id }, include: { business: { include: { user: true } }, requester: true } });
  if (!consent) throw new ApiError(404, "NOT_FOUND", "Consent request not found.");
  return expireIfNeeded(consent);
}

async function requireOwnedConsent(userId: string, id: string) {
  const consent = await loadConsent(id);
  if (consent.business.userId !== userId) throw new ApiError(403, "FORBIDDEN", "Only the MSME owner can action this consent request.");
  return consent;
}

function publicConsent(consent: any) {
  return { id: consent.id, requester: consent.requester && { id: consent.requester.id, name: consent.requester.name, role: consent.requester.role, organizationName: consent.requester.organizationName }, business: consent.business && { id: consent.business.id, legalName: consent.business.legalName, gstin: consent.business.gstin }, requestedFields: consent.requestedFields, requestedEvidenceTypes: consent.requestedEvidenceTypes, purpose: consent.purpose, approvedFields: consent.approvedFields, approvedEvidenceTypes: consent.approvedEvidenceTypes, status: consent.status, durationDays: consent.durationDays, approvedAt: consent.approvedAt, expiresAt: consent.expiresAt, revokedAt: consent.revokedAt, createdAt: consent.createdAt };
}

export async function create(user: Express.User, input: ConsentInput) {
  if (user.role !== UserRole.BUYER && user.role !== UserRole.BANK) throw new ApiError(403, "FORBIDDEN", "Only buyers and banks can request access.");
  const requestedFields = unique(input.requestedFields); const requestedEvidenceTypes = unique(input.requestedEvidenceTypes);
  validateInput(requestedFields, requestedEvidenceTypes);
  const business = await prisma.business.findUnique({ where: { gstin: input.businessGstin }, include: { user: true } });
  if (!business) throw new ApiError(404, "NOT_FOUND", "No business found with this GSTIN.");
  const consent = await prisma.consentRequest.create({ data: { requesterId: user.id, businessId: business.id, requestedFields: requestedFields as Prisma.InputJsonValue, requestedEvidenceTypes: requestedEvidenceTypes as Prisma.InputJsonValue, purpose: input.purpose }, include: { requester: true, business: true } });
  await writeAuditLog({ businessId: business.id, actorId: user.id, consentRequestId: consent.id, action: AuditAction.CONSENT_REQUESTED, metadata: { requestedFields, requestedEvidenceTypes, purpose: input.purpose } });
  await createNotification({ userId: business.userId, relatedConsentId: consent.id, message: `${consent.requester.organizationName} wants to view your Business Trust Profile.` });
  return publicConsent(consent);
}

export async function list(user: Express.User, scope: "incoming" | "outgoing") {
  if (scope === "incoming" && user.role !== UserRole.MSME) throw new ApiError(403, "FORBIDDEN", "Only MSMEs receive incoming requests.");
  if (scope === "outgoing" && user.role !== UserRole.BUYER && user.role !== UserRole.BANK) throw new ApiError(403, "FORBIDDEN", "Only buyers and banks have outgoing requests.");
  const business = scope === "incoming" ? await prisma.business.findUnique({ where: { userId: user.id } }) : null;
  if (scope === "incoming" && !business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");
  const records = await prisma.consentRequest.findMany({ where: scope === "incoming" ? { businessId: business!.id } : { requesterId: user.id }, orderBy: { createdAt: "desc" }, include: { requester: { select: { id: true, name: true, role: true, organizationName: true } }, business: { select: { id: true, legalName: true, gstin: true, userId: true } } } });
  return Promise.all(records.map(async (record) => publicConsent(await expireIfNeeded(record))));
}

export async function approve(userId: string, id: string, input: ApprovalInput) {
  const approvedFields = unique(input.approvedFields); const approvedEvidenceTypes = unique(input.approvedEvidenceTypes);
  validateInput(approvedFields, approvedEvidenceTypes);
  const consent = await requireOwnedConsent(userId, id);
  if (consent.status !== ConsentStatus.PENDING) throw new ApiError(409, "CONFLICT", "Only pending requests can be approved.");
  const requestedFields = new Set(consent.requestedFields as string[]); const requestedEvidence = new Set((consent.requestedEvidenceTypes as string[]) ?? []);
  if (approvedFields.some((field) => !requestedFields.has(field)) || approvedEvidenceTypes.some((type) => !requestedEvidence.has(type))) throw new ApiError(400, "VALIDATION_ERROR", "Approved disclosures must be a subset of requested disclosures.");
  const passport = await prisma.passport.findFirst({ where: { businessId: consent.businessId }, orderBy: { version: "desc" } });
  if (!passport) throw new ApiError(409, "PROFILE_NOT_READY", "Business Trust Profile has not been generated yet.");
  const approvedAt = new Date(); const expiresAt = new Date(approvedAt.getTime() + input.durationDays * 86400000);
  const updatedResult = await prisma.consentRequest.updateMany({ where: { id, status: ConsentStatus.PENDING }, data: { status: ConsentStatus.APPROVED, approvedFields: approvedFields as Prisma.InputJsonValue, approvedEvidenceTypes: approvedEvidenceTypes as Prisma.InputJsonValue, approvedPassportId: passport.id, durationDays: input.durationDays, approvedAt, expiresAt } });
  if (!updatedResult.count) throw new ApiError(409, "CONFLICT", "Only pending requests can be approved.");
  const updated = await prisma.consentRequest.findUniqueOrThrow({ where: { id }, include: { requester: true, business: true } });
  await writeAuditLog({ businessId: consent.businessId, actorId: userId, consentRequestId: id, action: AuditAction.CONSENT_APPROVED, metadata: { approvedFields, approvedEvidenceTypes, durationDays: input.durationDays, expiresAt } });
  await createNotification({ userId: consent.requesterId, relatedConsentId: id, message: `${consent.business.legalName} granted access to its Business Trust Profile.` });
  return publicConsent(updated);
}

export async function reject(userId: string, id: string) {
  const consent = await requireOwnedConsent(userId, id); if (consent.status !== ConsentStatus.PENDING) throw new ApiError(409, "CONFLICT", "Only pending requests can be rejected.");
  const updatedResult = await prisma.consentRequest.updateMany({ where: { id, status: ConsentStatus.PENDING }, data: { status: ConsentStatus.REJECTED } });
  if (!updatedResult.count) throw new ApiError(409, "CONFLICT", "Only pending requests can be rejected.");
  const updated = await prisma.consentRequest.findUniqueOrThrow({ where: { id }, include: { requester: true, business: true } });
  await writeAuditLog({ businessId: consent.businessId, actorId: userId, consentRequestId: id, action: AuditAction.CONSENT_REJECTED });
  await createNotification({ userId: consent.requesterId, relatedConsentId: id, message: `${consent.business.legalName} declined your Business Trust Profile request.` }); return publicConsent(updated);
}

export async function revoke(userId: string, id: string) {
  const consent = await requireOwnedConsent(userId, id); if (consent.status !== ConsentStatus.APPROVED) throw new ApiError(409, "CONFLICT", "Only active approved consent can be revoked.");
  const updatedResult = await prisma.consentRequest.updateMany({ where: { id, status: ConsentStatus.APPROVED }, data: { status: ConsentStatus.REVOKED, revokedAt: new Date() } });
  if (!updatedResult.count) throw new ApiError(409, "CONFLICT", "Only active approved consent can be revoked.");
  const updated = await prisma.consentRequest.findUniqueOrThrow({ where: { id }, include: { requester: true, business: true } });
  await writeAuditLog({ businessId: consent.businessId, actorId: userId, consentRequestId: id, action: AuditAction.CONSENT_REVOKED });
  await createNotification({ userId: consent.requesterId, relatedConsentId: id, message: `${consent.business.legalName} revoked Business Trust Profile access.` }); return publicConsent(updated);
}
