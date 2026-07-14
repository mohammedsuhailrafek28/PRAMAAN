import type { ReadinessProfileDefinition, RequirementResult, BlockingIssue, ReadinessEvaluationResponse } from "./readiness-engine.types.js";
import type { BusinessTrustProfile } from "../trustEngine/trust-engine.types.js";
import { calculateReadinessScore, levelFromScore } from "./readiness-score-calculator.js";
import { generateNextActions } from "./readiness-action-generator.js";

export function composeReadinessEvaluation(input: {
  definition: ReadinessProfileDefinition;
  businessId: string;
  trustProfile: BusinessTrustProfile;
  requirements: RequirementResult[];
  blockingIssues: BlockingIssue[];
  evaluatedAt: Date;
  evaluationId?: string;
}): ReadinessEvaluationResponse {
  const score = calculateReadinessScore(input.requirements);
  const blocked = input.blockingIssues.length > 0 || input.requirements.some((requirement) => requirement.status === "BLOCKED");
  const level = levelFromScore(score, input.definition, blocked);
  const applicable = input.requirements.filter((requirement) => requirement.status !== "NOT_APPLICABLE");

  return {
    profile: {
      id: input.definition.id,
      version: input.definition.version,
      name: input.definition.name,
      purpose: input.definition.purpose,
      description: input.definition.description,
      disclaimer: input.definition.disclaimer
    },
    businessId: input.businessId,
    evaluationId: input.evaluationId,
    evaluatedAt: input.evaluatedAt.toISOString(),
    trustProfileGeneratedAt: input.trustProfile.generatedAt,
    result: {
      score,
      level,
      blocked,
      satisfiedRequirements: input.requirements.filter((requirement) => requirement.status === "SATISFIED").length,
      partialRequirements: input.requirements.filter((requirement) => requirement.status === "PARTIALLY_SATISFIED" || requirement.status === "MANUAL_REVIEW").length,
      missingRequirements: input.requirements.filter((requirement) => requirement.status === "MISSING").length,
      totalApplicableRequirements: applicable.length
    },
    requirements: input.requirements,
    blockingIssues: input.blockingIssues,
    nextActions: generateNextActions(input.requirements),
    limitations: [
      "No authoritative GST, Udyam, bank, Account Aggregator, DigiLocker, or government source was queried.",
      "This readiness profile is a preparation guide, not an approval, eligibility, creditworthiness, or acceptance decision.",
      input.definition.disclaimer
    ]
  };
}
