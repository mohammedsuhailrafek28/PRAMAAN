import { ReportType, UserRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { generate as generateTrustProfile } from "../passport/passport.service.js";
import { evaluateForMsmeFromTrustProfile } from "../readinessEngine/readiness-engine.service.js";
import type { ReadinessEvaluationResponse } from "../readinessEngine/readiness-engine.types.js";
import type { BusinessTrustProfile } from "../trustEngine/trust-engine.types.js";
import { getReportTemplate } from "./report-template.registry.js";

export async function loadReportData(user: Express.User, reportType: ReportType) {
  if (user.role !== UserRole.MSME) throw new ApiError(403, "FORBIDDEN", "Only MSMEs can generate reports.");
  const business = await prisma.business.findUnique({
    where: { userId: user.id }
  });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");

  const template = getReportTemplate(reportType);
  const passport = await generateTrustProfile(user.id);
  return loadReportDataFromPassport(user, business, template, passport);
}

/**
 * Complete report preparation from one selected Passport. This is intentionally
 * separate so readiness cannot silently fall back to live-document recomputation.
 */
export async function loadReportDataFromPassport(
  user: Express.User,
  business: Awaited<ReturnType<typeof prisma.business.findUnique>>,
  template: ReturnType<typeof getReportTemplate>,
  passport: Awaited<ReturnType<typeof generateTrustProfile>>
) {
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");
  const trustProfile = passport.snapshotJson as Record<string, any>;
  if (trustProfile.businessId !== business.id) {
    throw new ApiError(500, "INVALID_TRUST_PROFILE_SNAPSHOT", "Trust Profile snapshot does not belong to the business.");
  }
  const missing = ["snapshotSchema", "generatedAt", "summary", "fieldConfidence", "documentConfidence", "gaps", "contradictions", "limitations", "evidence"]
    .filter((key) => trustProfile[key] === undefined || trustProfile[key] === null);
  if (trustProfile.snapshotSchema !== 2) missing.unshift("snapshotSchema (schema 2 required)");
  if (missing.length) {
    throw new ApiError(422, "UNSUPPORTED_TRUST_PROFILE_SNAPSHOT", `Readiness report requires pinned Passport fields: ${[...new Set(missing)].join(", ")}.`);
  }

  let readiness: ReadinessEvaluationResponse | null = null;
  let readinessEvaluationId: string | null = null;
  if (template.readinessProfileId) {
    readiness = await evaluateForMsmeFromTrustProfile(user, template.readinessProfileId, trustProfile as BusinessTrustProfile);
    readinessEvaluationId = readiness.evaluationId ?? null;
  }

  const auditLogs = await prisma.auditLog.findMany({
    where: { businessId: business.id },
    include: { actor: { select: { role: true, organizationName: true } } },
    orderBy: { createdAt: "asc" }
  });

  return { business, template, passport, trustProfile, readiness, readinessEvaluationId, auditLogs };
}
