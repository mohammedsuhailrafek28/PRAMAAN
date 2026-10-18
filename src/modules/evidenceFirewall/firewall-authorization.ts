// Authorisation for a conclusion request. Pure; never reads the snapshot.
// Canonical parity: the assurance rule mirrors requesterAssurance/assurance.service.ts `enforceDisclosureAccess`
// evaluated over the grant's FULL scope, as getTrustView and guest redemption do.

import { disclosureItem } from "../../utils/disclosureCatalogue.js";
import type { AuthorizationContext, ConclusionRequest, FirewallPolicy } from "./firewall.types.js";

export type RequiredItems = { fields: string[]; evidenceTypes: string[] };

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const parseTime = (value: unknown): number | null => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : null);
const ASSURANCE = ["UNVERIFIED", "ORG_REVIEWED", "AUTHORIZED", "SUSPENDED"];
const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

/** The items a request depends on (D2: the field AND every supporting evidence type), or null when malformed. */
export function requiredItems(request: ConclusionRequest, policy: FirewallPolicy): RequiredItems | null {
  if (!request || typeof request !== "object") return null;
  if (request.kind === "EVIDENCE_CURRENT") {
    return typeof request.docType === "string" && disclosureItem(request.docType, "EVIDENCE") ? { fields: [], evidenceTypes: [request.docType] } : null;
  }
  if (request.kind === "FIELD_SUPPORTED_BY_EVIDENCE" || request.kind === "FIELD_NOT_CONTRADICTED") {
    if (typeof request.field !== "string" || !disclosureItem(request.field, "FIELD")) return null;
    const evidenceTypes = request.kind === "FIELD_SUPPORTED_BY_EVIDENCE" && has(policy.fieldEvidence, request.field) ? [...policy.fieldEvidence[request.field]] : [];
    return { fields: [request.field], evidenceTypes };
  }
  return null;
}

/** Mirrors assurance.service `effectiveStatus`: an expired AUTHORIZED record is only ORG_REVIEWED; unknown is UNVERIFIED. */
export function effectiveAssuranceStatus(status: unknown, authorizationExpiresAt: unknown, nowMs: number): string {
  const normalized = typeof status === "string" && ASSURANCE.includes(status) ? status : "UNVERIFIED";
  if (normalized === "SUSPENDED") return "SUSPENDED";
  if (normalized === "AUTHORIZED" && authorizationExpiresAt !== null && authorizationExpiresAt !== undefined) {
    const expires = parseTime(authorizationExpiresAt);
    if (expires === null || expires <= nowMs) return "ORG_REVIEWED"; // an unparsable expiry fails closed
  }
  return normalized;
}

const isHigh = (key: string) => disclosureItem(key)?.sensitivity === "HIGH";

/** Mirrors `enforceDisclosureAccess` for a requester over a scope. true = permitted. */
export function assurancePermits(requester: AuthorizationContext["requester"], channel: AuthorizationContext["channel"], scope: RequiredItems, nowMs: number): boolean {
  const high = [...scope.fields, ...scope.evidenceTypes].some(isHigh);
  if (!requester) return channel === "GUEST_LINK" && !high; // creation guard: HIGH guest links need a registered requester
  if (typeof requester !== "object") return false;
  const status = effectiveAssuranceStatus(requester.assuranceStatus, requester.authorizationExpiresAt, nowMs);
  if (status === "SUSPENDED") return false;
  if (!high) return true;
  if (status !== "AUTHORIZED") return false;
  const granted = requester.authorizationScope;
  if (!granted || typeof granted !== "object" || Array.isArray(granted)) return false;
  const { fields, evidenceTypes } = granted as { fields?: unknown; evidenceTypes?: unknown };
  const allowedFields = new Set(Array.isArray(fields) ? fields.filter((item): item is string => typeof item === "string") : []);
  const allowedEvidence = new Set(Array.isArray(evidenceTypes) ? evidenceTypes.filter((item): item is string => typeof item === "string") : []);
  return scope.fields.every((field) => !isHigh(field) || allowedFields.has(field)) && scope.evidenceTypes.every((type) => !isHigh(type) || allowedEvidence.has(type));
}

/** true only when every authorisation condition holds; any malformed input is a denial. */
export function isAuthorized(authorization: AuthorizationContext, snapshotPassportId: string, required: RequiredItems | null, nowIso: string): boolean {
  const nowMs = parseTime(nowIso);
  if (nowMs === null || required === null || !authorization || typeof authorization !== "object") return false;
  if (authorization.channel !== "CONSENT" && authorization.channel !== "GUEST_LINK") return false;
  const live = authorization.channel === "CONSENT" ? "APPROVED" : "ACTIVE";
  if (authorization.status !== live) return false;
  if (authorization.revokedAt !== null && authorization.revokedAt !== undefined) return false;
  if (authorization.expiresAt === null || authorization.expiresAt === undefined) {
    if (authorization.channel === "GUEST_LINK") return false;
  } else {
    const expires = parseTime(authorization.expiresAt);
    if (expires === null || expires <= nowMs) return false;
  }
  if (typeof snapshotPassportId !== "string" || !snapshotPassportId || authorization.pinnedPassportId !== snapshotPassportId) return false;
  if (!isStringArray(authorization.approvedFields) || !isStringArray(authorization.approvedEvidenceTypes)) return false;
  const approvedFields = new Set(authorization.approvedFields);
  const approvedEvidence = new Set(authorization.approvedEvidenceTypes);
  if (!required.fields.every((field) => approvedFields.has(field)) || !required.evidenceTypes.every((type) => approvedEvidence.has(type))) return false;
  return assurancePermits(authorization.requester, authorization.channel, { fields: authorization.approvedFields, evidenceTypes: authorization.approvedEvidenceTypes }, nowMs);
}
