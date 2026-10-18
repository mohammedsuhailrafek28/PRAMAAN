import { AuditAction, DocumentType, OnboardingAssignmentStatus, UserRole, type Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { createNotification } from "../notifications/notifications.service.js";
import { effectiveStatus, enforceDisclosureAccess, getForRequester, requesterIdentitySummary } from "../requesterAssurance/assurance.service.js";
import { getPublishedPack, listPublishedPacks, validatePackRequirements, type PackRequirement } from "./onboarding.registry.js";

type AssignmentWithRelations = Prisma.OnboardingPackAssignmentGetPayload<{
  include: { business: { select: { id: true; userId: true; legalName: true; gstin: true } }; requester: { select: { id: true; name: true; role: true; organizationName: true } } }
}>;

const activeStatuses = [OnboardingAssignmentStatus.REQUESTED, OnboardingAssignmentStatus.ACCEPTED] as const;

function unique(values: string[]) { return [...new Set(values)]; }

function publicPack(pack: ReturnType<typeof getPublishedPack>) {
  if (!pack) throw new ApiError(404, "NOT_FOUND", "Published onboarding pack not found.");
  return { key: pack.key, version: pack.version, name: pack.name, audience: pack.audience, description: pack.description, requirements: pack.requirements };
}

function stateForDocument(document: { evidenceStatus: string; expiresAt: Date | null; contradictionDetails: Prisma.JsonValue | null } | undefined, now = new Date()) {
  if (!document) return "MISSING" as const;
  if (document.expiresAt && document.expiresAt <= now) return "EXPIRED" as const;
  if (document.evidenceStatus === "REJECTED") return "REJECTED" as const;
  if (document.contradictionDetails !== null) return "CONTRADICTED" as const;
  return "SUBMITTED" as const;
}

async function checklist(assignment: AssignmentWithRelations, owner: boolean) {
  const requirements = validatePackRequirements(assignment.requirementsSnapshot);
  const documents = await prisma.document.findMany({ where: { businessId: assignment.businessId, isCurrent: true }, select: { id: true, docType: true, evidenceStatus: true, expiresAt: true, contradictionDetails: true } });
  const byType = new Map(documents.map((document) => [document.docType, document]));
  return requirements.map((requirement) => {
    const document = byType.get(requirement.documentType);
    const detailedState = stateForDocument(document);
    const satisfied = detailedState === "SUBMITTED";
    return {
      key: requirement.key,
      label: requirement.label,
      kind: requirement.kind,
      required: requirement.required,
      description: requirement.description,
      status: owner ? detailedState : (satisfied ? "RECEIVED" : "OUTSTANDING"),
      ...(owner ? { evidenceStatus: document?.evidenceStatus ?? null } : {})
    };
  });
}

function isComplete(items: Array<{ required: boolean; status: string }>) {
  return items.filter((item) => item.required).every((item) => item.status === "SUBMITTED" || item.status === "RECEIVED");
}

async function maybeComplete(assignment: AssignmentWithRelations, owner: boolean) {
  const items = await checklist(assignment, owner);
  if (!isComplete(items) || !activeStatuses.includes(assignment.status as typeof activeStatuses[number])) return { assignment, items };
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.onboardingPackAssignment.updateMany({ where: { id: assignment.id, status: { in: [...activeStatuses] } }, data: { status: OnboardingAssignmentStatus.COMPLETED, completedAt: new Date(), activeKey: null } });
    if (!updated.count) return false;
    await writeAuditLog({ client: tx, businessId: assignment.businessId, actorId: assignment.business.userId, onboardingAssignmentId: assignment.id, action: AuditAction.ONBOARDING_PACK_COMPLETED, metadata: { packKey: assignment.packKey, packVersion: assignment.packVersion } });
    await createNotification({ client: tx, userId: assignment.requesterId, relatedOnboardingAssignmentId: assignment.id, message: `${assignment.business.legalName ?? "The business"} completed the ${assignment.packKey} checklist.` });
    return true;
  });
  if (!result) return { assignment, items };
  const refreshed = await load(assignment.id);
  return { assignment: refreshed, items };
}

async function load(id: string) {
  const assignment = await prisma.onboardingPackAssignment.findUnique({ where: { id }, include: { business: { select: { id: true, userId: true, legalName: true, gstin: true } }, requester: { select: { id: true, name: true, role: true, organizationName: true } } } });
  if (!assignment) throw new ApiError(404, "NOT_FOUND", "Onboarding request not found.");
  return assignment;
}

async function assertRequesterActive(requester: { id: string; role: UserRole; name?: string; organizationName?: string }) {
  if (requester.role !== UserRole.BUYER && requester.role !== UserRole.BANK) throw new ApiError(403, "FORBIDDEN", "Only buyers and banks can manage onboarding requests.");
  const assurance = await getForRequester(requester);
  if (!assurance || effectiveStatus(assurance) === "SUSPENDED") throw new ApiError(403, "REQUESTER_SUSPENDED", "Requester privileges are suspended.");
  return assurance;
}

function safeIdentity(assignment: AssignmentWithRelations, assurance: Awaited<ReturnType<typeof getForRequester>>) {
  return requesterIdentitySummary(assignment.requester, assurance);
}

async function responseFor(user: Express.User, input: AssignmentWithRelations) {
  const isOwner = input.business.userId === user.id;
  const isRequester = input.requesterId === user.id;
  if (!isOwner && !isRequester) throw new ApiError(403, "FORBIDDEN", "You cannot access this onboarding request.");
  if (isRequester) await assertRequesterActive(input.requester);
  const completed = await maybeComplete(input, isOwner);
  const assignment = completed.assignment;
  const assurance = await getForRequester(assignment.requester);
  return {
    id: assignment.id,
    pack: { key: assignment.packKey, version: assignment.packVersion },
    business: { id: assignment.business.id, legalName: assignment.business.legalName, gstin: assignment.business.gstin },
    requester: { id: assignment.requester.id, organizationName: assignment.requester.organizationName, role: assignment.requester.role, identity: safeIdentity(assignment, assurance) },
    purpose: assignment.purpose,
    status: assignment.status,
    createdAt: assignment.createdAt,
    acceptedAt: assignment.acceptedAt,
    declinedAt: assignment.declinedAt,
    cancelledAt: assignment.cancelledAt,
    completedAt: assignment.completedAt,
    checklist: completed.items
  };
}

export function listPacks() { return listPublishedPacks().map((pack) => publicPack(pack)); }

export function getPack(key: string, version?: string) { return publicPack(getPublishedPack(key, version)); }

export async function create(user: Express.User, input: { businessGstin: string; packKey: string; packVersion?: string; purpose: string }) {
  await assertRequesterActive(user);
  const pack = getPublishedPack(input.packKey, input.packVersion);
  if (!pack) throw new ApiError(404, "NOT_FOUND", "Published onboarding pack not found.");
  const requirements = validatePackRequirements(pack.requirements);
  // Optional high-sensitivity items are not requested by assignment creation. They remain
  // visible as optional checklist choices, while any later disclosure still goes through consent.
  await enforceDisclosureAccess(user, [], unique(requirements.filter((item) => item.required).map((item) => item.documentType)), "REQUEST");
  const business = await prisma.business.findUnique({ where: { gstin: input.businessGstin }, select: { id: true, userId: true, legalName: true, gstin: true } });
  if (!business) throw new ApiError(404, "NOT_FOUND", "No business found with this GSTIN.");
  const activeKey = `${business.id}:${user.id}:${pack.key}:${pack.version}`;
  const existing = await prisma.onboardingPackAssignment.findFirst({ where: { activeKey, status: { in: [...activeStatuses] } } });
  if (existing) throw new ApiError(409, "CONFLICT", "An active onboarding request already exists.");
  try {
    const assignment = await prisma.$transaction(async (tx) => {
      const created = await tx.onboardingPackAssignment.create({ data: { businessId: business.id, requesterId: user.id, packKey: pack.key, packVersion: pack.version, activeKey, requirementsSnapshot: requirements as unknown as Prisma.InputJsonValue, purpose: input.purpose.trim() } });
      await writeAuditLog({ client: tx, businessId: business.id, actorId: user.id, onboardingAssignmentId: created.id, action: AuditAction.ONBOARDING_PACK_ASSIGNED, metadata: { packKey: pack.key, packVersion: pack.version, purpose: input.purpose.trim() } });
      await createNotification({ client: tx, userId: business.userId, relatedOnboardingAssignmentId: created.id, message: `A requester sent a vendor onboarding checklist.` });
      return created;
    });
    return responseFor(user, await load(assignment.id));
  } catch (error: any) {
    if (error?.code === "P2002") throw new ApiError(409, "CONFLICT", "An active onboarding request already exists.");
    throw error;
  }
}

export async function list(user: Express.User, scope: "incoming" | "outgoing") {
  if (scope === "incoming") {
    if (user.role !== UserRole.MSME) throw new ApiError(403, "FORBIDDEN", "Only MSMEs receive incoming onboarding requests.");
    const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");
    const records = await prisma.onboardingPackAssignment.findMany({ where: { businessId: business.id }, orderBy: { createdAt: "desc" }, include: { business: { select: { id: true, userId: true, legalName: true, gstin: true } }, requester: { select: { id: true, name: true, role: true, organizationName: true } } } });
    return Promise.all(records.map((record) => responseFor(user, record)));
  }
  await assertRequesterActive(user);
  if (user.role !== UserRole.BUYER && user.role !== UserRole.BANK) throw new ApiError(403, "FORBIDDEN", "Only buyers and banks have outgoing onboarding requests.");
  const records = await prisma.onboardingPackAssignment.findMany({ where: { requesterId: user.id }, orderBy: { createdAt: "desc" }, include: { business: { select: { id: true, userId: true, legalName: true, gstin: true } }, requester: { select: { id: true, name: true, role: true, organizationName: true } } } });
  return Promise.all(records.map((record) => responseFor(user, record)));
}

export async function detail(user: Express.User, id: string) { return responseFor(user, await load(id)); }

async function transition(user: Express.User, id: string, next: "accept" | "decline" | "cancel") {
  const assignment = await load(id);
  const owner = assignment.business.userId === user.id;
  const requester = assignment.requesterId === user.id;
  if (next === "cancel") {
    if (!requester) throw new ApiError(403, "FORBIDDEN", "Only the requesting institution can cancel this request.");
    await assertRequesterActive(user);
  } else if (!owner) throw new ApiError(403, "FORBIDDEN", "Only the MSME owner can action this request.");
  const expected = next === "cancel" ? [...activeStatuses] : [OnboardingAssignmentStatus.REQUESTED];
  const status = next === "accept" ? OnboardingAssignmentStatus.ACCEPTED : next === "decline" ? OnboardingAssignmentStatus.DECLINED : OnboardingAssignmentStatus.CANCELLED;
  const timestampField = next === "accept" ? { acceptedAt: new Date() } : next === "decline" ? { declinedAt: new Date() } : { cancelledAt: new Date(), activeKey: null };
  const action = next === "accept" ? AuditAction.ONBOARDING_PACK_ACCEPTED : next === "decline" ? AuditAction.ONBOARDING_PACK_DECLINED : AuditAction.ONBOARDING_PACK_CANCELLED;
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.onboardingPackAssignment.updateMany({ where: { id, status: { in: expected } }, data: { status, ...timestampField } });
    if (!result.count) throw new ApiError(409, "CONFLICT", "This onboarding request has already been handled.");
    await writeAuditLog({ client: tx, businessId: assignment.businessId, actorId: user.id, onboardingAssignmentId: id, action, metadata: { packKey: assignment.packKey, packVersion: assignment.packVersion } });
    const recipient = next === "cancel" ? assignment.business.userId : assignment.requesterId;
    const message = next === "accept" ? `${assignment.business.legalName ?? "The business"} accepted your onboarding checklist.` : next === "decline" ? `${assignment.business.legalName ?? "The business"} declined your onboarding checklist.` : `${assignment.business.legalName ?? "The business"} onboarding request was cancelled.`;
    await createNotification({ client: tx, userId: recipient, relatedOnboardingAssignmentId: id, message });
    return tx.onboardingPackAssignment.findUniqueOrThrow({ where: { id }, include: { business: { select: { id: true, userId: true, legalName: true, gstin: true } }, requester: { select: { id: true, name: true, role: true, organizationName: true } } } });
  });
  return responseFor(user, updated);
}

export function accept(userId: string, id: string) { return transition({ id: userId, role: UserRole.MSME, email: "" }, id, "accept"); }
export function decline(userId: string, id: string) { return transition({ id: userId, role: UserRole.MSME, email: "" }, id, "decline"); }
export function cancel(user: Express.User, id: string) { return transition(user, id, "cancel"); }
