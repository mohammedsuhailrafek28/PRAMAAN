import { createHash, randomBytes } from "node:crypto";
import { AccessGrantStatus, AuditAction, type Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/apiError.js";
import { filterPassportFields } from "../../utils/fieldFilter.js";
import { validateDisclosureKeys } from "../../utils/disclosureCatalogue.js";
import { deriveEvidenceLifecycle } from "../evidence/evidence-lifecycle.service.js";
import { writeAuditLog } from "../audit/audit.service.js";

const purposes = new Set(["Business verification", "Loan application", "Vendor onboarding", "Procurement", "Other"]);

export type GrantScope = { fields: string[]; evidenceTypes: string[] };

function tokenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function validateScope(scope: GrantScope) {
  const fields = [...new Set(scope.fields)];
  const evidenceTypes = [...new Set(scope.evidenceTypes)];
  const invalidFields = validateDisclosureKeys(fields, "FIELD");
  const invalidEvidence = validateDisclosureKeys(evidenceTypes, "EVIDENCE");
  if (invalidFields.length || invalidEvidence.length || (!fields.length && !evidenceTypes.length)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Scope contains unsupported or empty fields.");
  }
  return { fields, evidenceTypes };
}

function toPublicGrant(grant: any, includeLink = false, token?: string) {
  return {
    id: grant.id,
    recipientName: grant.recipientName,
    recipientOrganization: grant.recipientOrganization,
    recipientEmail: grant.recipientEmail,
    purpose: grant.purpose,
    scope: grant.scopeJson,
    createdAt: grant.createdAt,
    expiresAt: grant.expiresAt,
    revokedAt: grant.revokedAt,
    lastAccessedAt: grant.lastAccessedAt,
    status: grant.revokedAt ? "REVOKED" : grant.expiresAt <= new Date() ? "EXPIRED" : "ACTIVE",
    ...(includeLink && token ? { secureUrl: `${env.PUBLIC_APP_URL}/verify/${token}` } : {})
  };
}

export async function create(user: Express.User, input: {
  recipientName?: string; recipientOrganization?: string; recipientEmail?: string; purpose: string;
  scope: GrantScope; durationHours?: number; expiresAt?: string;
}) {
  if (user.role !== "MSME") throw new ApiError(403, "FORBIDDEN", "Only MSMEs can create external access links.");
  if (!purposes.has(input.purpose)) throw new ApiError(400, "VALIDATION_ERROR", "Unsupported sharing purpose.");
  const scope = validateScope(input.scope);
  const business = await prisma.business.findUnique({ where: { userId: user.id } });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");
  const passport = await prisma.passport.findFirst({ where: { businessId: business.id }, orderBy: { version: "desc" } });
  if (!passport) throw new ApiError(409, "PROFILE_NOT_READY", "Business Trust Profile has not been generated yet.");

  const expiresAt = input.expiresAt
    ? new Date(input.expiresAt)
    : new Date(Date.now() + (input.durationHours ?? 168) * 60 * 60 * 1000);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date() || expiresAt.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) {
    throw new ApiError(400, "VALIDATION_ERROR", "Expiry must be a valid future date within one year.");
  }

  const token = randomBytes(32).toString("base64url");
  const grant = await prisma.accessGrant.create({
    data: {
      businessId: business.id,
      createdByUserId: user.id,
      recipientName: input.recipientName?.trim() || undefined,
      recipientOrganization: input.recipientOrganization?.trim() || undefined,
      recipientEmail: input.recipientEmail?.trim() || undefined,
      purpose: input.purpose,
      scopeJson: scope as Prisma.InputJsonValue,
      passportId: passport.id,
      tokenHash: tokenDigest(token),
      expiresAt
    }
  });
  await writeAuditLog({ businessId: business.id, actorId: user.id, accessGrantId: grant.id, action: AuditAction.GUEST_LINK_CREATED, metadata: { purpose: grant.purpose, scope } });
  return toPublicGrant(grant, true, token);
}

export async function list(userId: string) {
  const business = await prisma.business.findUnique({ where: { userId } });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");
  const grants = await prisma.accessGrant.findMany({ where: { businessId: business.id }, orderBy: { createdAt: "desc" } });
  await Promise.all(grants.filter((grant) => grant.status === AccessGrantStatus.ACTIVE && grant.expiresAt <= new Date()).map((grant) => prisma.accessGrant.updateMany({ where: { id: grant.id, status: AccessGrantStatus.ACTIVE }, data: { status: AccessGrantStatus.EXPIRED } })));
  return grants.map((grant) => toPublicGrant({ ...grant, status: grant.status === AccessGrantStatus.ACTIVE && grant.expiresAt <= new Date() ? AccessGrantStatus.EXPIRED : grant.status }));
}

export async function revoke(userId: string, id: string) {
  const business = await prisma.business.findUnique({ where: { userId } });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");
  const grant = await prisma.accessGrant.findUnique({ where: { id } });
  if (!grant || grant.businessId !== business.id) throw new ApiError(404, "NOT_FOUND", "Access grant not found.");
  if (grant.revokedAt) return toPublicGrant(grant);
  const updated = await prisma.accessGrant.update({ where: { id }, data: { status: AccessGrantStatus.REVOKED, revokedAt: new Date() } });
  await writeAuditLog({ businessId: business.id, actorId: userId, accessGrantId: id, action: AuditAction.GUEST_LINK_REVOKED, metadata: { revokedAt: updated.revokedAt?.toISOString() } });
  return toPublicGrant(updated);
}

function safeEvidence(document: any) {
  const lifecycle = deriveEvidenceLifecycle(document);
  return {
    docType: document.docType,
    evidenceStatus: document.evidenceStatus,
    confidence: document.confidence,
    crossCheckMethod: document.crossCheckMethod,
    source: document.source,
    issuedAt: document.issuedAt,
    checkedAt: document.checkedAt,
    expiresAt: document.expiresAt,
    uploadedAt: document.uploadedAt,
    lifecycle
  };
}

export async function resolveGuest(token: string) {
  if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) throw new ApiError(404, "INVALID_ACCESS_LINK", "This access link is not valid.");
  const grant = await prisma.accessGrant.findUnique({ where: { tokenHash: tokenDigest(token) }, include: { business: { include: { passports: true, documents: { where: { isCurrent: true }, orderBy: { uploadedAt: "desc" } } } } } });
  if (!grant) throw new ApiError(404, "INVALID_ACCESS_LINK", "This access link is not valid.");
  if (grant.revokedAt || grant.status === AccessGrantStatus.REVOKED) throw new ApiError(410, "ACCESS_REVOKED", "This access link was revoked by the business.");
  if (grant.expiresAt <= new Date()) {
    await prisma.accessGrant.updateMany({ where: { id: grant.id, status: AccessGrantStatus.ACTIVE }, data: { status: AccessGrantStatus.EXPIRED } });
    await writeAuditLog({ businessId: grant.businessId, actorId: grant.createdByUserId, accessGrantId: grant.id, action: AuditAction.GUEST_LINK_EXPIRED, dedupeWindowMs: 86400000, metadata: { expiredAt: grant.expiresAt.toISOString() } });
    throw new ApiError(410, "ACCESS_EXPIRED", "This access link has expired.");
  }

  const scope = grant.scopeJson as GrantScope;
  const snapshot = grant.business.passports?.find((item) => item.id === grant.passportId)?.snapshotJson;
  if (!snapshot) throw new ApiError(410, "PROFILE_SNAPSHOT_UNAVAILABLE", "The pinned Trust Profile snapshot is unavailable.");
  const fields = filterPassportFields(snapshot, scope.fields);
  const evidence = grant.business.documents.filter((document) => scope.evidenceTypes.includes(document.docType)).map(safeEvidence);
  const viewedAt = new Date();
  await prisma.accessGrant.update({ where: { id: grant.id }, data: { lastAccessedAt: viewedAt } });
  await writeAuditLog({ businessId: grant.businessId, actorId: grant.createdByUserId, accessGrantId: grant.id, action: AuditAction.GUEST_LINK_OPENED, dedupeWindowMs: 300000, metadata: { accessType: "guest", viewedAt: viewedAt.toISOString(), fields: Object.keys(fields), evidenceTypes: evidence.map((item) => item.docType) } });
  return {
    grant: { id: grant.id, purpose: grant.purpose, recipientName: grant.recipientName, recipientOrganization: grant.recipientOrganization, createdAt: grant.createdAt, expiresAt: grant.expiresAt },
    business: {
      legalName: scope.fields.includes("legalBusinessName") ? grant.business.legalName : undefined,
      gstin: scope.fields.includes("gstin") ? grant.business.gstin : undefined
    },
    sharedFields: fields,
    evidence
  };
}
