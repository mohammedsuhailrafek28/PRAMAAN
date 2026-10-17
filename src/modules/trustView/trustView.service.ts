import { AuditAction, ConsentStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { filterPassportFields } from "../../utils/fieldFilter.js";
import { readPinnedEvidence } from "../evidence/pinned-evidence.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { expireIfNeeded } from "../consent/consent.service.js";
import { enforceDisclosureAccess, getForRequester, requesterIdentitySummary } from "../requesterAssurance/assurance.service.js";

export async function getTrustView(userId: string, consentRequestId: string) {
  const found = await prisma.consentRequest.findUnique({ where: { id: consentRequestId }, include: { business: { include: { user: true } }, requester: { select: { id: true, name: true, role: true, organizationName: true, email: true } } } });
  if (!found) throw new ApiError(404, "NOT_FOUND", "Consent request not found.");
  let consent: any = found;
  if (consent.requesterId !== userId) throw new ApiError(403, "FORBIDDEN", "Only the original requester can open this Trust View.");
  consent = await expireIfNeeded(consent);
  if (consent.status === ConsentStatus.REVOKED) throw new ApiError(410, "CONSENT_REVOKED", "Access has been revoked by the business.");
  if (consent.status === ConsentStatus.EXPIRED) throw new ApiError(410, "CONSENT_EXPIRED", "Access has expired.");
  if (consent.status !== ConsentStatus.APPROVED) throw new ApiError(403, "FORBIDDEN", "Consent is not approved.");
  if (!consent.approvedPassportId) throw new ApiError(409, "PROFILE_NOT_READY", "Consent is not pinned to a Trust Profile snapshot.");
  const passport = await prisma.passport.findUnique({ where: { id: consent.approvedPassportId } });
  if (!passport || passport.businessId !== consent.businessId) throw new ApiError(404, "NOT_FOUND", "Pinned Business Trust Profile not found.");
  const approvedFields = (consent.approvedFields ?? []) as string[];
  const evidenceTypes = ((consent.approvedEvidenceTypes ?? []) as string[]);
  const assurance = await enforceDisclosureAccess(consent.requester, approvedFields, evidenceTypes, "ACCESS");
  const sharedFields = filterPassportFields(passport.snapshotJson, approvedFields);
  // Evidence comes from the pinned snapshot only. Document rows are never read, so later uploads,
  // replacements, cross-checks or expiries cannot change what this consent disclosed.
  const { evidence, basis: evidenceBasis } = readPinnedEvidence(passport.snapshotJson, evidenceTypes);
  await writeAuditLog({ businessId: consent.businessId, actorId: userId, consentRequestId: consent.id, action: AuditAction.TRUST_VIEW_OPENED, dedupeWindowMs: 300000, metadata: { fields: Object.keys(sharedFields), evidenceTypes } });
  return { businessId: consent.businessId, consentId: consent.id, requesterIdentity: requesterIdentitySummary(consent.requester, assurance), sharedFields, metadata: { accessGrantedAt: consent.approvedAt, expiresAt: consent.expiresAt, purpose: consent.purpose, passportVersion: passport.version, evidenceBasis }, evidence };
}
