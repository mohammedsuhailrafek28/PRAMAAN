import type { ReadinessNextAction, RequirementResult } from "./readiness-engine.types.js";

const statusOrder = {
  BLOCKED: 0,
  MISSING: 1,
  PARTIALLY_SATISFIED: 2,
  MANUAL_REVIEW: 3,
  SATISFIED: 4,
  NOT_APPLICABLE: 5
} as const;

export function generateNextActions(results: RequirementResult[]) {
  const actions = new Map<string, ReadinessNextAction>();
  for (const result of results) {
    if (result.status === "SATISFIED" || result.status === "NOT_APPLICABLE") continue;
    const priority = result.status === "BLOCKED" ? "CRITICAL" : result.status === "MISSING" ? "HIGH" : "MEDIUM";
    const title =
      result.status === "BLOCKED"
        ? `Resolve blocker for ${result.label}`
        : result.status === "MISSING"
          ? `Add ${result.label.toLowerCase()}`
          : `Improve ${result.label.toLowerCase()}`;
    actions.set(result.requirementId, {
      priority,
      requirementId: result.requirementId,
      title,
      description: result.nextAction?.description ?? actionDescription(result),
      reason: result.reason,
      expectedStatusChange: `${result.status} -> PARTIALLY_SATISFIED or SATISFIED`
    });
  }

  return [...actions.values()].sort((a, b) => {
    const aResult = results.find((result) => result.requirementId === a.requirementId)!;
    const bResult = results.find((result) => result.requirementId === b.requirementId)!;
    return statusOrder[aResult.status] - statusOrder[bResult.status] || bResult.weight - aResult.weight;
  });
}

function actionDescription(result: RequirementResult) {
  if (result.status === "BLOCKED") return "Resolve the blocking issue before treating this readiness profile as ready for review.";
  if (result.status === "MISSING") return "Submit the missing claim or evidence required by this readiness profile.";
  if (result.status === "MANUAL_REVIEW") return "Review this requirement manually because the available evidence is incomplete or ambiguous.";
  return "Improve the supporting evidence or claim confidence for this requirement.";
}
