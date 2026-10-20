import type { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

/** Either the shared client or an interactive-transaction client. */
export type AuditClient = Pick<typeof prisma, "auditLog">;
import { ApiError } from "../../utils/apiError.js";

export async function writeAuditLog(input: {
  businessId: string;
  actorId: string;
  action: AuditAction;
  consentRequestId?: string | null;
  accessGrantId?: string | null;
  onboardingAssignmentId?: string | null;
  metadata?: Prisma.InputJsonValue;
  dedupeWindowMs?: number;
  /** Pass a transaction client to make the audit row commit or roll back with the caller. */
  client?: AuditClient;
}) {
  const db = input.client ?? prisma;
  if (input.dedupeWindowMs) {
    const existing = await db.auditLog.findFirst({
      where: {
        businessId: input.businessId,
        actorId: input.actorId,
        action: input.action,
        consentRequestId: input.consentRequestId ?? null,
        accessGrantId: input.accessGrantId ?? null,
        createdAt: { gte: new Date(Date.now() - input.dedupeWindowMs) }
      },
      orderBy: { createdAt: "desc" }
    });
    if (existing) return existing;
  }
  return db.auditLog.create({
    data: {
      businessId: input.businessId,
      actorId: input.actorId,
      action: input.action,
      consentRequestId: input.consentRequestId,
      accessGrantId: input.accessGrantId,
      onboardingAssignmentId: input.onboardingAssignmentId,
      metadata: input.metadata
    }
  });
}

export async function listForOwner(userId: string) {
  const business = await prisma.business.findUnique({ where: { userId } });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");

  return prisma.auditLog.findMany({
    where: { businessId: business.id },
    orderBy: { createdAt: "desc" },
    include: {
      actor: { select: { id: true, name: true, role: true, organizationName: true } },
      consentRequest: {
        include: { requester: { select: { id: true, name: true, role: true, organizationName: true } } }
      }
    }
  });
}
