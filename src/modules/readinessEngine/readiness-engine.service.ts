import { AuditAction, UserRole, type Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { calculateAndPersistBusinessTrustProfile } from "../trustEngine/trust-engine.service.js";
import { getReadinessProfile, listReadinessProfiles } from "./readiness-profile.registry.js";
import { evaluateRequirement } from "./requirement-evaluator.js";
import { composeReadinessEvaluation } from "./readiness-profile-composer.js";
import type { BlockingIssue } from "./readiness-engine.types.js";

export { listReadinessProfiles };

export function getProfileDefinition(profileId: string) {
  return getReadinessProfile(profileId);
}

export async function evaluateForMsme(user: Express.User, profileId: string) {
  if (user.role !== UserRole.MSME) {
    throw new ApiError(403, "FORBIDDEN", "Only MSMEs can evaluate private readiness profiles.");
  }
  const business = await prisma.business.findUnique({ where: { userId: user.id } });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");

  const definition = getReadinessProfile(profileId);
  const { profile: trustProfile } = await calculateAndPersistBusinessTrustProfile(business.id);
  const requirements = definition.requirements.map((requirement) => evaluateRequirement(definition, requirement, trustProfile));
  const blockingIssues = collectBlockingIssues(definition, trustProfile, requirements);
  const evaluatedAt = new Date();
  const draft = composeReadinessEvaluation({
    definition,
    businessId: business.id,
    trustProfile,
    requirements,
    blockingIssues,
    evaluatedAt
  });

  const persisted = await prisma.readinessEvaluation.create({
    data: {
      businessId: business.id,
      profileId: definition.id,
      profileVersion: definition.version,
      score: draft.result.score,
      level: draft.result.level,
      blocked: draft.result.blocked,
      summaryJson: draft as Prisma.InputJsonValue,
      evaluatedAt
    }
  });

  const response = { ...draft, evaluationId: persisted.id };
  await prisma.readinessEvaluation.update({
    where: { id: persisted.id },
    data: { summaryJson: response as Prisma.InputJsonValue }
  });

  await writeAuditLog({
    businessId: business.id,
    actorId: user.id,
    action: AuditAction.READINESS_PROFILE_EVALUATED,
    metadata: {
      profileId: definition.id,
      profileVersion: definition.version,
      score: response.result.score,
      level: response.result.level,
      blocked: response.result.blocked,
      evaluationId: persisted.id
    }
  });
  if (response.result.blocked) {
    await writeAuditLog({
      businessId: business.id,
      actorId: user.id,
      action: AuditAction.READINESS_PROFILE_BLOCKED,
      metadata: {
        profileId: definition.id,
        profileVersion: definition.version,
        score: response.result.score,
        level: response.result.level,
        blocked: true,
        evaluationId: persisted.id,
        blockingIssues: response.blockingIssues
      }
    });
  }

  return response;
}

export async function latestForMsme(user: Express.User, profileId: string) {
  if (user.role !== UserRole.MSME) {
    throw new ApiError(403, "FORBIDDEN", "Only MSMEs can view private readiness evaluations.");
  }
  const business = await prisma.business.findUnique({ where: { userId: user.id } });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");
  getReadinessProfile(profileId);
  const evaluation = await prisma.readinessEvaluation.findFirst({
    where: { businessId: business.id, profileId },
    orderBy: { evaluatedAt: "desc" }
  });
  if (!evaluation) throw new ApiError(404, "NOT_FOUND", "No readiness evaluation found for this profile.");
  return evaluation;
}

export async function historyForMsme(user: Express.User) {
  if (user.role !== UserRole.MSME) {
    throw new ApiError(403, "FORBIDDEN", "Only MSMEs can view private readiness evaluations.");
  }
  const business = await prisma.business.findUnique({ where: { userId: user.id } });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");
  return prisma.readinessEvaluation.findMany({
    where: { businessId: business.id },
    orderBy: { evaluatedAt: "desc" }
  });
}

function collectBlockingIssues(
  definition: ReturnType<typeof getReadinessProfile>,
  trustProfile: Awaited<ReturnType<typeof calculateAndPersistBusinessTrustProfile>>["profile"],
  requirements: { blockingIssues: BlockingIssue[] }[]
) {
  const issues = requirements.flatMap((requirement) => requirement.blockingIssues);
  for (const rule of definition.blockingRules) {
    const matches = trustProfile.contradictions.filter((contradiction) => {
      const severityMatches = !rule.severities || rule.severities.includes(contradiction.severity);
      const fieldMatches = !rule.fields || rule.fields.includes(contradiction.field as never);
      return severityMatches && fieldMatches;
    });
    for (const match of matches) {
      issues.push({
        code: rule.code,
        message: rule.message || match.reason,
        relatedFields: [match.field as never]
      });
    }
  }
  const dedupe = new Map<string, BlockingIssue>();
  for (const issue of issues) dedupe.set(`${issue.code}:${issue.relatedFields.join(",")}:${issue.requirementId ?? ""}`, issue);
  return [...dedupe.values()];
}
