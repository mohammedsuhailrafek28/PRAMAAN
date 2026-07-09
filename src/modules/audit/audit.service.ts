import type { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";

export async function writeAuditLog(input: {
  businessId: string;
  actorId: string;
  action: AuditAction;
  consentRequestId?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.auditLog.create({
    data: {
      businessId: input.businessId,
      actorId: input.actorId,
      action: input.action,
      consentRequestId: input.consentRequestId,
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
