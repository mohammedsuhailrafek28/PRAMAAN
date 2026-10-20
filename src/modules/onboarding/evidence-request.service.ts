import { AuditAction, OnboardingAssignmentStatus, UserRole, type Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { createNotification } from "../notifications/notifications.service.js";
import { effectiveStatus, enforceDisclosureAccess, getForRequester, requesterIdentitySummary } from "../requesterAssurance/assurance.service.js";
import { getPublishedPack, validatePackRequirements, type PackRequirement } from "./onboarding.registry.js";

export const EVIDENCE_REQUEST_STATUSES = ["OPEN", "RESPONDED", "RESOLVED", "INSUFFICIENT", "ACTION_REQUIRED"] as const;
export const EVIDENCE_REQUEST_KINDS = ["MISSING_EVIDENCE", "CLARIFICATION"] as const;
export const EVIDENCE_RESPONSE_TYPES = ["DOCUMENT_REFERENCE", "CLARIFICATION"] as const;
export const EVIDENCE_REVIEW_DECISIONS = ["RESOLVED", "INSUFFICIENT", "ACTION_REQUIRED"] as const;

type EvidenceRequestWithRelations = Prisma.EvidenceRequestGetPayload<{
  include: {
    assignment: { include: { business: { select: { id: true; userId: true; legalName: true; gstin: true } }; requester: { select: { id: true; name: true; role: true; organizationName: true } } } };
    requester: { select: { id: true; name: true; role: true; organizationName: true } };
    responses: { orderBy: { createdAt: "asc" } };
    events: { orderBy: { createdAt: "asc" } };
  }
}>;

const activeAssignmentStatuses = [OnboardingAssignmentStatus.ACCEPTED, OnboardingAssignmentStatus.IN_PROGRESS];

function isOneOf<T extends readonly string[]>(values: T, value: string): value is T[number] { return values.includes(value); }

async function assertRequesterActive(user: Express.User) {
  if (user.role !== UserRole.BUYER && user.role !== UserRole.BANK) throw new ApiError(403, "FORBIDDEN", "Only buyers and banks can review evidence requests.");
  const assurance = await getForRequester(user);
  if (!assurance || effectiveStatus(assurance) === "SUSPENDED") throw new ApiError(403, "REQUESTER_SUSPENDED", "Requester privileges are suspended.");
  return assurance;
}

async function load(id: string): Promise<EvidenceRequestWithRelations> {
  const request = await prisma.evidenceRequest.findUnique({
    where: { id },
    include: {
      assignment: { include: { business: { select: { id: true, userId: true, legalName: true, gstin: true } }, requester: { select: { id: true, name: true, role: true, organizationName: true } } } },
      requester: { select: { id: true, name: true, role: true, organizationName: true } },
      responses: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "asc" } }
    }
  });
  if (!request) throw new ApiError(404, "NOT_FOUND", "Evidence request not found.");
  return request;
}

function assertParticipant(user: Express.User, request: EvidenceRequestWithRelations) {
  const owner = request.assignment.business.userId === user.id;
  const requester = request.requesterId === user.id;
  if (!owner && !requester) throw new ApiError(403, "FORBIDDEN", "You cannot access this evidence request.");
  return { owner, requester };
}

async function safeResponse(request: EvidenceRequestWithRelations, user: Express.User) {
  const { owner } = assertParticipant(user, request);
  const assurance = await getForRequester(request.requester);
  return {
    id: request.id,
    assignmentId: request.assignmentId,
    requirement: { key: request.requirementKey, label: (request.requirementSnapshot as { label?: string }).label ?? request.requirementKey },
    requestKind: request.requestKind,
    reason: request.reason,
    status: request.status,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    business: { id: request.assignment.business.id, legalName: request.assignment.business.legalName, gstin: request.assignment.business.gstin },
    requester: { id: request.requester.id, organizationName: request.requester.organizationName, role: request.requester.role, identity: requesterIdentitySummary(request.requester, assurance) },
    responses: request.responses.map((response) => ({
      id: response.id,
      responseType: response.responseType,
      createdAt: response.createdAt,
      ...(response.responseType === "CLARIFICATION" ? { clarification: response.clarificationText } : { documentReferenced: true, ...(owner ? { documentType: (request.requirementSnapshot as { documentType?: string }).documentType } : {}) })
    })),
    history: request.events.map((event) => ({ action: event.action, fromStatus: event.fromStatus, toStatus: event.toStatus, createdAt: event.createdAt }))
  };
}

function parseRequirementSnapshot(requirement: PackRequirement): Prisma.InputJsonObject {
  return { key: requirement.key, label: requirement.label, kind: requirement.kind, documentType: requirement.documentType, required: requirement.required, description: requirement.description };
}

async function assertActiveAssignment(request: EvidenceRequestWithRelations["assignment"]) {
  if (!(activeAssignmentStatuses as readonly string[]).includes(request.status)) throw new ApiError(409, "ASSIGNMENT_NOT_ACTIVE", "Evidence requests are available only for accepted onboarding assignments.");
}

export async function create(user: Express.User, assignmentId: string, input: { requirementKey: string; requestKind: string; reason: string }) {
  await assertRequesterActive(user);
  const assignment = await prisma.onboardingPackAssignment.findUnique({ where: { id: assignmentId }, include: { business: { select: { id: true, userId: true, legalName: true, gstin: true } }, requester: { select: { id: true, name: true, role: true, organizationName: true } } } });
  if (!assignment || assignment.requesterId !== user.id) throw new ApiError(403, "FORBIDDEN", "Only the requesting institution can create an evidence request.");
  await assertActiveAssignment(assignment);
  if (!isOneOf(EVIDENCE_REQUEST_KINDS, input.requestKind)) throw new ApiError(400, "INVALID_REQUEST_KIND", "Unsupported evidence request kind.");
  const pack = getPublishedPack(assignment.packKey, assignment.packVersion);
  if (!pack) throw new ApiError(409, "INVALID_PACK", "The assigned onboarding pack is no longer available.");
  const requirement = validatePackRequirements(assignment.requirementsSnapshot).find((item) => item.key === input.requirementKey);
  if (!requirement || !pack.requirements.some((item) => item.key === requirement.key)) throw new ApiError(400, "INVALID_REQUIREMENT", "The requested requirement is not part of this published pack.");
  await enforceDisclosureAccess(user, [], [requirement.documentType], "REQUEST");
  const activeKey = `${assignmentId}:${requirement.key}`;
  const existing = await prisma.evidenceRequest.findUnique({ where: { activeKey } });
  if (existing) throw new ApiError(409, "CONFLICT", "An active evidence request already exists for this requirement.");
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 500) throw new ApiError(400, "INVALID_REASON", "Provide a concise reason for the request.");
  try {
    const created = await prisma.$transaction(async (tx) => {
      const request = await tx.evidenceRequest.create({ data: { assignmentId, businessId: assignment.businessId, requesterId: user.id, requirementKey: requirement.key, requirementSnapshot: parseRequirementSnapshot(requirement), requestKind: input.requestKind, reason, status: "OPEN", activeKey } });
    await tx.evidenceRequestEvent.create({ data: { requestId: request.id, actorId: user.id, action: "REQUESTED", toStatus: "OPEN", metadata: { requirementKey: requirement.key, requestKind: input.requestKind } } });
    await writeAuditLog({ client: tx, businessId: assignment.businessId, actorId: user.id, onboardingAssignmentId: assignment.id, action: AuditAction.EVIDENCE_GAP_FOUND, metadata: { workflow: "EVIDENCE_REQUEST", requestId: request.id, requirementKey: requirement.key, requestKind: input.requestKind } });
    await createNotification({ client: tx, userId: assignment.business.userId, relatedOnboardingAssignmentId: assignment.id, message: `A requester asked for follow-up on ${requirement.label}.` });
      return request;
    });
    return safeResponse(await load(created.id), user);
  } catch (error: any) {
    if (error?.code === "P2002") throw new ApiError(409, "CONFLICT", "An active evidence request already exists for this requirement.");
    throw error;
  }
}

export async function list(user: Express.User, scope: "incoming" | "outgoing") {
  if (scope === "outgoing") await assertRequesterActive(user);
  const where = scope === "incoming" ? { business: { userId: user.id } } : { requesterId: user.id };
  const requests = await prisma.evidenceRequest.findMany({ where, orderBy: { createdAt: "desc" }, include: { assignment: { include: { business: { select: { id: true, userId: true, legalName: true, gstin: true } }, requester: { select: { id: true, name: true, role: true, organizationName: true } } } }, requester: { select: { id: true, name: true, role: true, organizationName: true } }, responses: { orderBy: { createdAt: "asc" } }, events: { orderBy: { createdAt: "asc" } } } });
  if (scope === "incoming" && user.role !== UserRole.MSME) throw new ApiError(403, "FORBIDDEN", "Only MSMEs receive evidence requests.");
  return Promise.all(requests.map((request) => safeResponse(request, user)));
}

export async function detail(user: Express.User, id: string) {
  const request = await load(id);
  if (request.requesterId === user.id) await assertRequesterActive(user);
  return safeResponse(request, user);
}

export async function respond(user: Express.User, id: string, input: { responseType: string; documentId?: string; clarification?: string }) {
  const request = await load(id);
  const { owner } = assertParticipant(user, request);
  if (!owner) throw new ApiError(403, "FORBIDDEN", "Only the MSME owner can respond to an evidence request.");
  if (!isOneOf(["OPEN", "ACTION_REQUIRED"] as const, request.status)) throw new ApiError(409, "CONFLICT", "This evidence request is not awaiting a response.");
  if (!isOneOf(EVIDENCE_RESPONSE_TYPES, input.responseType)) throw new ApiError(400, "INVALID_RESPONSE_TYPE", "Unsupported evidence response type.");
  let documentId: string | null = null;
  let clarificationText: string | null = null;
  if (input.responseType === "DOCUMENT_REFERENCE") {
    if (!input.documentId) throw new ApiError(400, "DOCUMENT_REQUIRED", "Reference an existing MSME document.");
    const document = await prisma.document.findFirst({ where: { id: input.documentId, businessId: request.businessId } });
    if (!document || document.docType !== (request.requirementSnapshot as { documentType?: string }).documentType) throw new ApiError(400, "INVALID_DOCUMENT_REFERENCE", "The referenced document is not valid for this MSME requirement.");
    documentId = document.id;
  } else {
    clarificationText = input.clarification?.trim() ?? "";
    if (clarificationText.length < 5 || clarificationText.length > 1000) throw new ApiError(400, "INVALID_CLARIFICATION", "Provide a concise clarification.");
  }
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.evidenceRequest.updateMany({ where: { id, status: { in: ["OPEN", "ACTION_REQUIRED"] } }, data: { status: "RESPONDED" } });
    if (!result.count) throw new ApiError(409, "CONFLICT", "This evidence request changed before your response was saved.");
    await tx.evidenceRequestResponse.create({ data: { requestId: id, responderId: user.id, responseType: input.responseType, documentId, clarificationText } });
    await tx.evidenceRequestEvent.create({ data: { requestId: id, actorId: user.id, action: "RESPONDED", fromStatus: request.status, toStatus: "RESPONDED", metadata: { responseType: input.responseType } } });
    await writeAuditLog({ client: tx, businessId: request.businessId, actorId: user.id, onboardingAssignmentId: request.assignmentId, action: AuditAction.DOCUMENT_SUBMITTED, metadata: { workflow: "EVIDENCE_REQUEST", requestId: id, responseType: input.responseType } });
    await createNotification({ client: tx, userId: request.requesterId, relatedOnboardingAssignmentId: request.assignmentId, message: `The MSME responded to your ${request.requirementKey} follow-up.` });
    return true;
  });
  void updated;
  return safeResponse(await load(id), user);
}

export async function review(user: Express.User, id: string, input: { decision: string; note?: string }) {
  await assertRequesterActive(user);
  const request = await load(id);
  const { requester } = assertParticipant(user, request);
  if (!requester) throw new ApiError(403, "FORBIDDEN", "Only the requesting institution can review this evidence request.");
  if (request.status !== "RESPONDED") throw new ApiError(409, "CONFLICT", "Only a submitted response can be reviewed.");
  if (!isOneOf(EVIDENCE_REVIEW_DECISIONS, input.decision)) throw new ApiError(400, "INVALID_DECISION", "Unsupported evidence request decision.");
  const note = input.note?.trim();
  if (note && note.length > 500) throw new ApiError(400, "INVALID_NOTE", "Review notes must be concise.");
  await prisma.$transaction(async (tx) => {
    const result = await tx.evidenceRequest.updateMany({ where: { id, requesterId: user.id, status: "RESPONDED" }, data: { status: input.decision, ...(input.decision === "RESOLVED" || input.decision === "INSUFFICIENT" ? { activeKey: null } : {}) } });
    if (!result.count) throw new ApiError(409, "CONFLICT", "This evidence request changed before review was saved.");
    await tx.evidenceRequestEvent.create({ data: { requestId: id, actorId: user.id, action: input.decision, fromStatus: "RESPONDED", toStatus: input.decision, metadata: note ? { hasNote: true } : undefined } });
    await writeAuditLog({ client: tx, businessId: request.businessId, actorId: user.id, onboardingAssignmentId: request.assignmentId, action: input.decision === "RESOLVED" ? AuditAction.BUSINESS_CROSS_CHECKED : AuditAction.EVIDENCE_GAP_FOUND, metadata: { workflow: "EVIDENCE_REQUEST", requestId: id, decision: input.decision } });
    await createNotification({ client: tx, userId: request.assignment.business.userId, relatedOnboardingAssignmentId: request.assignmentId, message: `Your ${request.requirementKey} follow-up was marked ${input.decision.toLowerCase().replace("_", " ")}.` });
  });
  return safeResponse(await load(id), user);
}
