import { ReportType, UserRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { generate as generateTrustProfile } from "../passport/passport.service.js";
import { evaluateForMsme } from "../readinessEngine/readiness-engine.service.js";
import type { ReadinessEvaluationResponse } from "../readinessEngine/readiness-engine.types.js";
import { getReportTemplate } from "./report-template.registry.js";

export async function loadReportData(user: Express.User, reportType: ReportType) {
  if (user.role !== UserRole.MSME) throw new ApiError(403, "FORBIDDEN", "Only MSMEs can generate reports.");
  const business = await prisma.business.findUnique({
    where: { userId: user.id },
    include: { user: true, documents: true }
  });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");

  const template = getReportTemplate(reportType);
  const passport = await generateTrustProfile(user.id);
  const trustProfile = passport.snapshotJson as Record<string, any>;

  let readiness: ReadinessEvaluationResponse | null = null;
  let readinessEvaluationId: string | null = null;
  if (template.readinessProfileId) {
    readiness = await evaluateForMsme(user, template.readinessProfileId);
    readinessEvaluationId = readiness.evaluationId ?? null;
  }

  const auditLogs = await prisma.auditLog.findMany({
    where: { businessId: business.id },
    include: { actor: { select: { role: true, organizationName: true } } },
    orderBy: { createdAt: "asc" }
  });

  return { business, template, passport, trustProfile, readiness, readinessEvaluationId, auditLogs };
}
