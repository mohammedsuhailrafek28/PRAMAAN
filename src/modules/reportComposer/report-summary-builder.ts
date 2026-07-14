import { ReportType } from "@prisma/client";
import type { ReadinessEvaluationResponse } from "../readinessEngine/readiness-engine.types.js";
import type { BusinessTrustProfile } from "../trustEngine/trust-engine.types.js";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function buildExecutiveSummary(input: {
  reportType: ReportType;
  trustProfile: BusinessTrustProfile;
  readiness?: ReadinessEvaluationResponse | null;
}) {
  if (!input.readiness) {
    const gaps = input.trustProfile.gaps.length;
    const contradictions = input.trustProfile.contradictions.length;
    return `Evidence-backed Business Trust Profile generated with trust readiness ${input.trustProfile.summary.trustReadiness}. It includes ${plural(gaps, "gap", "gaps")} and ${plural(contradictions, "contradiction", "contradictions")}. No authoritative source verification was performed.`;
  }

  const result = input.readiness.result;
  const profileName = input.readiness.profile.name.toLowerCase();
  if (result.blocked) {
    return `This business profile is currently BLOCKED for ${profileName} because one or more configured blocking issues affect mandatory requirements. The calculated preparation score ${result.score} is shown for transparency but does not override the blocker.`;
  }
  return `This business is ${result.level} for ${profileName}. ${plural(result.satisfiedRequirements, "requirement is", "requirements are")} satisfied, ${plural(result.partialRequirements, "requirement is", "requirements are")} partially satisfied, and ${plural(result.missingRequirements, "requirement is", "requirements are")} missing. No blocking issue was detected.`;
}

export function trustMetricExplanations(summary: BusinessTrustProfile["summary"]) {
  return [
    { key: "trustReadiness", label: "Trust Readiness", score: summary.trustReadiness, explanation: "Weighted summary of completeness, evidence strength, consistency, and freshness." },
    { key: "profileCompleteness", label: "Profile Completeness", score: summary.profileCompleteness, explanation: "Measures how many required business claims and evidence items are present." },
    { key: "evidenceStrength", label: "Evidence Strength", score: summary.evidenceStrength, explanation: "Measures how strongly submitted evidence supports the business claims." },
    { key: "consistency", label: "Consistency", score: summary.consistency, explanation: "Measures agreement between submitted claims and internally cross-checked values." },
    { key: "freshness", label: "Freshness", score: summary.freshness, explanation: "Measures whether time-sensitive evidence remains current where expiry metadata exists." }
  ];
}
