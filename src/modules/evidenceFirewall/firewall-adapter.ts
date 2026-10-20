import { createHash } from "node:crypto";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { disclosureItem } from "../../utils/disclosureCatalogue.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { AuditAction } from "@prisma/client";
import { evaluateConclusion } from "./evidence-firewall.js";
import { FIREWALL_LIMITATION } from "./firewall-policy.js";
import type { AuthorizationContext, ConclusionRequest, FirewallDecision } from "./firewall.types.js";

type PublicConclusion = {
  conclusion: {
    result: "CONFIRMED" | "NOT_CONFIRMED" | "NOT_DISCLOSABLE";
    basis: "INTERNAL_DETERMINISTIC_CHECKS" | "AUTHORIZATION";
    passportVersion: number | null;
    scopeLimited: true;
    limitations: readonly [string];
  };
};

type Scope = { fields: string[]; evidenceTypes: string[] };

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

function uniqueCanonical(value: unknown, kind: "FIELD" | "EVIDENCE"): string[] | null {
  if (!isStringArray(value)) return null;
  const result = [...value];
  if (new Set(result).size !== result.length || result.some((key) => !disclosureItem(key, kind))) return null;
  return result;
}

function readScope(value: unknown): Scope | null {
  if (!isObject(value) || !hasOwn(value, "fields") || !hasOwn(value, "evidenceTypes")) return null;
  const fields = uniqueCanonical(value.fields, "FIELD");
  const evidenceTypes = uniqueCanonical(value.evidenceTypes, "EVIDENCE");
  return fields && evidenceTypes ? { fields, evidenceTypes } : null;
}

function isSubset(child: Scope, parent: Scope) {
  return child.fields.every((key) => parent.fields.includes(key))
    && child.evidenceTypes.every((key) => parent.evidenceTypes.includes(key));
}

function canonicalRequest(value: unknown): ConclusionRequest | null {
  if (!isObject(value) || typeof value.kind !== "string") return null;
  if (value.kind === "FIELD_SUPPORTED_BY_EVIDENCE" || value.kind === "FIELD_NOT_CONTRADICTED") {
    return typeof value.field === "string" && disclosureItem(value.field, "FIELD") && Object.keys(value).every((key) => key === "kind" || key === "field")
      ? { kind: value.kind, field: value.field }
      : null;
  }
  if (value.kind === "EVIDENCE_CURRENT") {
    return typeof value.docType === "string" && disclosureItem(value.docType, "EVIDENCE") && Object.keys(value).every((key) => key === "kind" || key === "docType")
      ? { kind: "EVIDENCE_CURRENT", docType: value.docType }
      : null;
  }
  return null;
}

function iso(value: Date | null) { return value?.toISOString() ?? null; }

function assuranceContext(record: { status: string; authorizationExpiresAt: Date | null; authorizationScope: unknown } | null | undefined) {
  return record
    ? { assuranceStatus: record.status, authorizationExpiresAt: iso(record.authorizationExpiresAt), authorizationScope: record.authorizationScope }
    : { assuranceStatus: "UNVERIFIED", authorizationExpiresAt: null, authorizationScope: null };
}

function toPublicDecision(result: FirewallDecision): PublicConclusion {
  if (result.verdict === "NOT_DISCLOSABLE") {
    return { conclusion: { result: "NOT_DISCLOSABLE", basis: "AUTHORIZATION", passportVersion: null, scopeLimited: true, limitations: [FIREWALL_LIMITATION] } };
  }
  return {
    conclusion: {
      result: result.verdict === "SUPPORTED" ? "CONFIRMED" : "NOT_CONFIRMED",
      basis: "INTERNAL_DETERMINISTIC_CHECKS",
      passportVersion: result.snapshotVersion,
      scopeLimited: true,
      limitations: [FIREWALL_LIMITATION]
    }
  };
}

const deny = (): PublicConclusion => ({ conclusion: { result: "NOT_DISCLOSABLE", basis: "AUTHORIZATION", passportVersion: null, scopeLimited: true, limitations: [FIREWALL_LIMITATION] } });

async function consentContext(tx: any, actorId: string, consentRequestId: string, now: string, request: ConclusionRequest): Promise<{ input: any; audit: { businessId: string; actorId: string; consentRequestId: string } } | null> {
  const consent = await tx.consentRequest.findUnique({
    where: { id: consentRequestId },
    include: {
      requester: { select: { id: true, role: true, requesterAssurance: { select: { status: true, authorizationExpiresAt: true, authorizationScope: true } } } },
      approvedPassport: { select: { id: true, businessId: true, version: true, snapshotJson: true } }
    }
  });
  if (!consent || consent.requesterId !== actorId || !["BUYER", "BANK"].includes(consent.requester.role)) return null;
  const requested = readScope({ fields: consent.requestedFields, evidenceTypes: consent.requestedEvidenceTypes });
  const approved = readScope({ fields: consent.approvedFields, evidenceTypes: consent.approvedEvidenceTypes });
  if (!requested || !approved || !isSubset(approved, requested) || !consent.approvedPassport || consent.approvedPassport.businessId !== consent.businessId) return null;
  const authorization: AuthorizationContext = {
    channel: "CONSENT",
    status: consent.status,
    expiresAt: iso(consent.expiresAt),
    revokedAt: iso(consent.revokedAt),
    pinnedPassportId: consent.approvedPassportId,
    approvedFields: approved.fields,
    approvedEvidenceTypes: approved.evidenceTypes,
    requester: assuranceContext(consent.requester.requesterAssurance)
  };
  return {
    input: { snapshot: consent.approvedPassport.snapshotJson, snapshotPassportId: consent.approvedPassport.id, authorization, request, now },
    audit: { businessId: consent.businessId, actorId, consentRequestId }
  };
}

async function guestContext(tx: any, token: string, now: string, request: ConclusionRequest): Promise<{ input: any; audit: { businessId: string; actorId: string; accessGrantId: string } } | null> {
  if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const grant = await tx.accessGrant.findUnique({
    where: { tokenHash },
    include: {
      requester: { select: { id: true, role: true, requesterAssurance: { select: { status: true, authorizationExpiresAt: true, authorizationScope: true } } } },
      passport: { select: { id: true, businessId: true, version: true, snapshotJson: true } }
    }
  });
  if (!grant || !grant.passport || grant.passport.businessId !== grant.businessId) return null;
  const scope = readScope(grant.scopeJson);
  if (!scope) return null;
  const requester = grant.requester && ["BUYER", "BANK"].includes(grant.requester.role) ? assuranceContext(grant.requester.requesterAssurance) : null;
  const authorization: AuthorizationContext = {
    channel: "GUEST_LINK",
    status: grant.revokedAt || grant.status === "REVOKED" ? "REVOKED" : grant.status,
    expiresAt: iso(grant.expiresAt),
    revokedAt: iso(grant.revokedAt),
    pinnedPassportId: grant.passportId,
    approvedFields: scope.fields,
    approvedEvidenceTypes: scope.evidenceTypes,
    requester
  };
  return {
    input: { snapshot: grant.passport.snapshotJson, snapshotPassportId: grant.passport.id, authorization, request, now },
    // Unregistered guests have no user actor; the grant owner is the bounded
    // audit actor and the accessGrantId identifies the guest credential scope.
    audit: { businessId: grant.businessId, actorId: grant.createdByUserId, accessGrantId: grant.id }
  };
}

async function evaluate(loader: (tx: any, now: string, request: ConclusionRequest) => Promise<{ input: any; audit: { businessId: string; actorId: string; consentRequestId?: string; accessGrantId?: string } } | null>, request: ConclusionRequest) {
  const now = new Date().toISOString();
  try {
    return await prisma.$transaction(async (tx) => {
      const loaded = await loader(tx, now, request);
      if (!loaded) return deny();
      const decision = evaluateConclusion(loaded.input);
      await writeAuditLog({
        businessId: loaded.audit.businessId,
        actorId: loaded.audit.actorId,
        consentRequestId: loaded.audit.consentRequestId,
        accessGrantId: loaded.audit.accessGrantId,
        action: AuditAction.CONCLUSION_EVALUATED,
        metadata: { channel: loaded.input.authorization.channel, queryKind: request.kind, evaluatedAt: now },
        client: tx
      });
      return toPublicDecision(decision);
    });
  } catch {
    throw new ApiError(503, "FIREWALL_UNAVAILABLE", "Trust conclusion is temporarily unavailable.");
  }
}

export async function evaluateTrustConclusion(input: { channel: "CONSENT"; principalId: string; consentRequestId: string } | { channel: "GUEST_LINK"; token: string }, request: unknown): Promise<PublicConclusion> {
  const parsed = canonicalRequest(request);
  if (!parsed) throw new ApiError(400, "VALIDATION_ERROR", "Unsupported trust conclusion request.");
  if (input.channel === "CONSENT") return evaluate((tx, now, value) => consentContext(tx, input.principalId, input.consentRequestId, now, value), parsed);
  return evaluate((tx, now, value) => guestContext(tx, input.token, now, value), parsed);
}
