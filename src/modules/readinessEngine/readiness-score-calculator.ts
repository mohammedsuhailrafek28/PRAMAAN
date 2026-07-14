import { ReadinessLevel } from "@prisma/client";
import type { ReadinessProfileDefinition, RequirementResult } from "./readiness-engine.types.js";

export function calculateReadinessScore(results: RequirementResult[]) {
  const applicable = results.filter((result) => result.status !== "NOT_APPLICABLE");
  const totalWeight = applicable.reduce((sum, result) => sum + result.weight, 0);
  if (totalWeight <= 0) {
    throw new Error("Readiness profile has zero applicable requirement weight.");
  }
  const weighted = applicable.reduce((sum, result) => sum + result.score * result.weight, 0) / totalWeight;
  return Math.max(0, Math.min(100, Math.round(weighted)));
}

export function levelFromScore(score: number, definition: ReadinessProfileDefinition, blocked: boolean) {
  if (blocked) return ReadinessLevel.BLOCKED;
  if (score <= definition.thresholds.notReadyMax) return ReadinessLevel.NOT_READY;
  if (score <= definition.thresholds.earlyStageMax) return ReadinessLevel.EARLY_STAGE;
  if (score <= definition.thresholds.partiallyReadyMax) return ReadinessLevel.PARTIALLY_READY;
  if (score <= definition.thresholds.mostlyReadyMax) return ReadinessLevel.MOSTLY_READY;
  return ReadinessLevel.READY_FOR_REVIEW;
}
