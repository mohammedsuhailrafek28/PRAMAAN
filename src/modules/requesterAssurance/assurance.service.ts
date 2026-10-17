import { UserRole, type Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { disclosureItem, type DisclosureItem } from "../../utils/disclosureCatalogue.js";

export const ASSURANCE_STATUS = ["UNVERIFIED", "ORG_REVIEWED", "AUTHORIZED", "SUSPENDED"] as const;
export type AssuranceStatus = (typeof ASSURANCE_STATUS)[number];

type AssuranceRecord = {
  id: string;
  userId: string;
  status: string;
  reviewedOrganizationName: string | null;
  reviewBasis: string | null;
  reviewedAt: Date | null;
  reviewerIdentifier: string | null;
  authorizationBasis: string | null;
  authorizationReference: string | null;
  authorizationScope: Prisma.JsonValue | null;
  authorizationExpiresAt: Date | null;
  suspensionReason: string | null;
  suspendedAt: Date | null;
};

type Requester = { id: string; role: UserRole; name?: string; organizationName?: string; email?: string };

function isRequesterRole(role: UserRole) {
  return role === UserRole.BUYER || role === UserRole.BANK;
}

function normalizedStatus(value: string): AssuranceStatus {
  return ASSURANCE_STATUS.includes(value as AssuranceStatus) ? value as AssuranceStatus : "UNVERIFIED";
}

export function effectiveStatus(assurance: AssuranceRecord, now = new Date()): AssuranceStatus {
  const status = normalizedStatus(assurance.status);
  if (status === "SUSPENDED") return "SUSPENDED";
  if (status === "AUTHORIZED" && assurance.authorizationExpiresAt && assurance.authorizationExpiresAt <= now) return "ORG_REVIEWED";
  return status;
}

function limitations(assurance: AssuranceRecord, status: AssuranceStatus, now = new Date()) {
  const result: string[] = [];
  if (status === "UNVERIFIED") result.push("Independent organizational review is required.");
  if (status === "ORG_REVIEWED") result.push("Requester authority has not been independently established.");
  if (normalizedStatus(assurance.status) === "AUTHORIZED" && assurance.authorizationExpiresAt && assurance.authorizationExpiresAt <= now) {
    result.push("Authorization has expired; HIGH-sensitivity disclosures are unavailable.");
  }
  if (status === "SUSPENDED") result.push("Requester privileges are suspended.");
  return result;
}

export function requesterIdentitySummary(requester: Requester, assurance: AssuranceRecord | null, now = new Date()) {
  const safeAssurance = assurance ?? {
    status: "UNVERIFIED",
    reviewedOrganizationName: null,
    reviewBasis: null,
    reviewedAt: null,
    authorizationExpiresAt: null,
    suspensionReason: null
  } as AssuranceRecord;
  const status = effectiveStatus(safeAssurance, now);
  return {
    status,
    displayName: requester.organizationName ?? requester.name ?? "Requester",
    reviewBasis: safeAssurance.reviewBasis,
    reviewedAt: safeAssurance.reviewedAt,
    authorizationExpiresAt: safeAssurance.authorizationExpiresAt,
    limitations: limitations(safeAssurance, status, now)
  };
}

export async function ensureForUser(userId: string): Promise<AssuranceRecord> {
  return prisma.requesterAssurance.upsert({
    where: { userId },
    create: { userId, status: "UNVERIFIED" },
    update: {},
    select: {
      id: true, userId: true, status: true, reviewedOrganizationName: true, reviewBasis: true,
      reviewedAt: true, reviewerIdentifier: true, authorizationBasis: true, authorizationReference: true,
      authorizationScope: true, authorizationExpiresAt: true, suspensionReason: true, suspendedAt: true
    }
  });
}

export async function getForRequester(user: Requester) {
  if (!isRequesterRole(user.role)) return null;
  return ensureForUser(user.id);
}

function sensitiveItems(fields: string[], evidenceTypes: string[]) {
  return [...fields, ...evidenceTypes].map((key) => disclosureItem(key)).filter((item): item is DisclosureItem => item?.sensitivity === "HIGH");
}

export function requiresIndependentAuthorization(fields: string[], evidenceTypes: string[]) {
  return sensitiveItems(fields, evidenceTypes).length > 0;
}

function authorizedScopeAllows(assurance: AssuranceRecord, fields: string[], evidenceTypes: string[]) {
  if (!assurance.authorizationScope || typeof assurance.authorizationScope !== "object" || Array.isArray(assurance.authorizationScope)) return false;
  const scope = assurance.authorizationScope as { fields?: unknown; evidenceTypes?: unknown };
  const allowedFields = new Set(Array.isArray(scope.fields) ? scope.fields.filter((item): item is string => typeof item === "string") : []);
  const allowedEvidence = new Set(Array.isArray(scope.evidenceTypes) ? scope.evidenceTypes.filter((item): item is string => typeof item === "string") : []);
  return fields.every((field) => !disclosureItem(field)?.sensitivity || disclosureItem(field)?.sensitivity !== "HIGH" || allowedFields.has(field))
    && evidenceTypes.every((type) => !disclosureItem(type)?.sensitivity || disclosureItem(type)?.sensitivity !== "HIGH" || allowedEvidence.has(type));
}

export async function enforceDisclosureAccess(user: Requester, fields: string[], evidenceTypes: string[], phase: "REQUEST" | "APPROVAL" | "ACCESS") {
  if (!isRequesterRole(user.role)) return null;
  const assurance = await ensureForUser(user.id);
  const status = effectiveStatus(assurance);
  if (status === "SUSPENDED") throw new ApiError(403, "REQUESTER_SUSPENDED", "Requester privileges are suspended.");
  const sensitive = sensitiveItems(fields, evidenceTypes);
  if (!sensitive.length) return assurance;
  if (status !== "AUTHORIZED" || !authorizedScopeAllows(assurance, fields, evidenceTypes)) {
    throw new ApiError(403, "REQUESTER_ASSURANCE_REQUIRED", `Requester assurance does not permit HIGH-sensitivity disclosures during ${phase.toLowerCase()}.`);
  }
  return assurance;
}

function cleanReference(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim().length < 6 || value.trim().length > 240) throw new Error(`${label} must be a non-sensitive independent reference.`);
  const normalized = value.trim();
  if (/self[- ]?(attest|declared|upload)|uploaded[- ]letter|email[- ]domain|domain[- ]match|same[- ]domain/i.test(normalized)) {
    throw new Error(`${label} cannot rely on self-attestation or email-domain matching.`);
  }
  return normalized;
}

function assertOperator(operatorId: unknown, target: { id: string; email: string }) {
  if (typeof operatorId !== "string" || operatorId.trim().length < 3 || operatorId.trim().length > 120) throw new Error("operatorId is required.");
  if (operatorId.trim().toLowerCase() === target.id.toLowerCase() || operatorId.trim().toLowerCase() === target.email.toLowerCase()) throw new Error("Requester cannot operate on its own assurance.");
  return operatorId.trim();
}

export type AssuranceOperatorInput = {
  action: "review" | "authorize" | "suspend" | "re-review";
  userId: string;
  operatorId: string;
  organizationName?: string;
  reviewBasis?: string;
  authorizationBasis?: string;
  authorizationReference?: string;
  authorizationScope?: { fields: string[]; evidenceTypes: string[] };
  authorizationExpiresAt?: string;
  suspensionReason?: string;
};

export async function applyOperatorTransition(input: AssuranceOperatorInput) {
  const target = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, email: true, role: true, organizationName: true } });
  if (!target || !isRequesterRole(target.role)) throw new Error("Target must be an existing BUYER or BANK requester.");
  const operatorId = assertOperator(input.operatorId, target);
  const current = await ensureForUser(target.id);
  const currentStatus = normalizedStatus(current.status);
  const now = new Date();
  let nextStatus: AssuranceStatus;
  let data: Record<string, unknown>;

  if (input.action === "suspend") {
    if (currentStatus === "SUSPENDED") throw new Error("Requester is already suspended.");
    if (typeof input.suspensionReason !== "string" || input.suspensionReason.trim().length < 6) throw new Error("A suspension reason is required.");
    nextStatus = "SUSPENDED";
    data = { status: nextStatus, suspensionReason: input.suspensionReason.trim(), suspendedAt: now };
  } else if (input.action === "review" || input.action === "re-review") {
    if (input.action === "review" && currentStatus !== "UNVERIFIED" && currentStatus !== "SUSPENDED") throw new Error("Review is only valid for UNVERIFIED or SUSPENDED requesters; use re-review for an existing reviewed record.");
    const reviewBasis = cleanReference(input.reviewBasis, "reviewBasis");
    const reviewedOrganizationName = typeof input.organizationName === "string" && input.organizationName.trim().length >= 2 ? input.organizationName.trim() : target.organizationName;
    nextStatus = "ORG_REVIEWED";
    data = { status: nextStatus, reviewedOrganizationName, reviewBasis, reviewedAt: now, reviewerIdentifier: operatorId, authorizationBasis: null, authorizationReference: null, authorizationScope: null, authorizationExpiresAt: null, suspensionReason: null, suspendedAt: null };
  } else {
    if (currentStatus !== "ORG_REVIEWED" && currentStatus !== "AUTHORIZED") throw new Error("Authorization requires ORG_REVIEWED status.");
    const authorizationBasis = cleanReference(input.authorizationBasis, "authorizationBasis");
    const authorizationReference = cleanReference(input.authorizationReference, "authorizationReference");
    if (!input.authorizationScope || !Array.isArray(input.authorizationScope.fields) || !Array.isArray(input.authorizationScope.evidenceTypes) || (!input.authorizationScope.fields.length && !input.authorizationScope.evidenceTypes.length)) throw new Error("Authorization scope is required.");
    const expires = new Date(input.authorizationExpiresAt ?? "");
    if (Number.isNaN(expires.getTime()) || expires <= now) throw new Error("Authorization expiry must be a future timestamp.");
    const invalidScope = [...input.authorizationScope.fields, ...input.authorizationScope.evidenceTypes].filter((key) => !disclosureItem(key));
    if (invalidScope.length) throw new Error(`Authorization scope contains unsupported disclosure: ${invalidScope.join(", ")}`);
    nextStatus = "AUTHORIZED";
    data = { status: nextStatus, authorizationBasis, authorizationReference, authorizationScope: input.authorizationScope as Prisma.InputJsonValue, authorizationExpiresAt: expires, suspensionReason: null, suspendedAt: null };
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.requesterAssurance.update({ where: { userId: target.id }, data: data as Prisma.RequesterAssuranceUpdateInput });
    await tx.requesterAssuranceEvent.create({ data: { userId: target.id, operatorId, action: input.action.toUpperCase(), previousStatus: currentStatus, newStatus: nextStatus, metadata: { reviewedOrganizationName: updated.reviewedOrganizationName, reviewBasis: updated.reviewBasis, authorizationReference: updated.authorizationReference, authorizationExpiresAt: updated.authorizationExpiresAt, suspensionReason: updated.suspensionReason } } });
    return updated;
  });
}

export async function listHistory(userId: string) {
  return prisma.requesterAssuranceEvent.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { id: true, operatorId: true, action: true, previousStatus: true, newStatus: true, metadata: true, createdAt: true } });
}
