import { EvidenceStatus } from "@prisma/client";
import type { BusinessTrustProfile, DocumentConfidence, FieldConfidence } from "../trustEngine/trust-engine.types.js";
import { evidenceStatusRank } from "./readiness-profile.defaults.js";
import type {
  BlockingIssue,
  ReadinessProfileDefinition,
  ReadinessRequirement,
  RequirementResult,
  RequirementStatus
} from "./readiness-engine.types.js";

function scoreFromConfidence(current = 0, minimum = 0, floor: number) {
  if (minimum <= 0) return current > 0 ? 100 : 0;
  return Math.max(floor, Math.min(99, Math.round((current / minimum) * 100)));
}

function statusRank(status?: EvidenceStatus) {
  if (!status) return 0;
  return evidenceStatusRank[status] ?? 0;
}

function findField(profile: BusinessTrustProfile, field?: string): FieldConfidence | undefined {
  if (!field) return undefined;
  return profile.fieldConfidence.find((candidate) => candidate.field === field);
}

function findDocuments(profile: BusinessTrustProfile, requirement: ReadinessRequirement): DocumentConfidence[] {
  const accepted = requirement.acceptedDocumentTypes ?? [];
  return profile.documentConfidence.filter((document) => accepted.includes(document.documentType));
}

function fieldHasValue(field?: FieldConfidence) {
  return field?.value !== null && field?.value !== undefined && String(field.value).trim().length > 0;
}

export function evaluateRequirement(
  definition: ReadinessProfileDefinition,
  requirement: ReadinessRequirement,
  trustProfile: BusinessTrustProfile
): RequirementResult {
  if (requirement.category === "METRIC" && requirement.minimumMetric) {
    return evaluateMetricRequirement(definition, requirement, trustProfile);
  }
  if (requirement.category === "CONSISTENCY") {
    return evaluateConsistencyRequirement(definition, requirement, trustProfile);
  }
  if (requirement.category === "EVIDENCE") {
    return evaluateEvidenceRequirement(definition, requirement, trustProfile);
  }
  return evaluateClaimRequirement(definition, requirement, trustProfile);
}

function baseResult(requirement: ReadinessRequirement): RequirementResult {
  return {
    requirementId: requirement.id,
    label: requirement.label,
    status: "MISSING",
    score: 0,
    weight: requirement.weight,
    reason: requirement.description,
    requiredEvidenceStatus: requirement.minimumEvidenceStatus,
    minimumConfidence: requirement.minimumConfidence,
    relatedField: requirement.field,
    relatedEvidenceIds: [],
    blockingIssues: [],
    nextAction: null
  };
}

function evaluateClaimRequirement(
  definition: ReadinessProfileDefinition,
  requirement: ReadinessRequirement,
  trustProfile: BusinessTrustProfile
) {
  const result = baseResult(requirement);
  const field = findField(trustProfile, requirement.field);
  result.currentEvidenceStatus = field?.status;
  result.currentConfidence = field?.confidence;
  result.relatedEvidenceIds = field?.evidenceIds ?? [];

  if (!fieldHasValue(field)) {
    result.status = requirement.required ? "MISSING" : "NOT_APPLICABLE";
    result.reason = requirement.required ? `${requirement.label} is required but missing.` : `${requirement.label} is optional and absent.`;
    return result;
  }

  const confidenceOk = requirement.minimumConfidence === undefined || (field?.confidence ?? 0) >= requirement.minimumConfidence;
  const statusOk = !requirement.minimumEvidenceStatus || statusRank(field?.status) >= statusRank(requirement.minimumEvidenceStatus);

  if (field?.status === EvidenceStatus.REJECTED) {
    result.status = requirement.manualReviewAllowed ? "MANUAL_REVIEW" : "BLOCKED";
    result.score = definition.scoring.manualReviewScore;
    result.blockingIssues = result.status === "BLOCKED" ? [{
      code: "REJECTED_REQUIRED_CLAIM",
      message: `${requirement.label} is rejected by internal checks.`,
      relatedFields: requirement.field ? [requirement.field] : [],
      requirementId: requirement.id
    }] : [];
    result.reason = `${requirement.label} has a rejected status.`;
    return result;
  }

  if (confidenceOk && statusOk) {
    result.status = "SATISFIED";
    result.score = 100;
    result.reason = `${requirement.label} satisfies the configured confidence and evidence-status requirement.`;
    return result;
  }

  result.status = requirement.manualReviewAllowed ? "MANUAL_REVIEW" : "PARTIALLY_SATISFIED";
  result.score = scoreFromConfidence(field?.confidence, requirement.minimumConfidence, definition.scoring.partialStatusScoreFloor);
  result.reason = `${requirement.label} is present but below the configured confidence or evidence-status requirement.`;
  return result;
}

function evaluateEvidenceRequirement(
  definition: ReadinessProfileDefinition,
  requirement: ReadinessRequirement,
  trustProfile: BusinessTrustProfile
) {
  const result = baseResult(requirement);
  const documents = findDocuments(trustProfile, requirement);
  result.relatedEvidenceIds = documents.map((document) => document.documentId);
  const best = [...documents].sort((a, b) => b.confidence - a.confidence)[0];
  result.currentEvidenceStatus = best?.status;
  result.currentConfidence = best?.confidence;

  if (!best) {
    result.status = requirement.required ? "MISSING" : "NOT_APPLICABLE";
    result.reason = requirement.required ? `${requirement.label} requires submitted evidence.` : `${requirement.label} is optional and absent.`;
    return result;
  }

  if (requirement.blockOnExpiredEvidence && documents.some((document) => document.status === EvidenceStatus.EXPIRED)) {
    result.status = "BLOCKED";
    result.blockingIssues = [{ code: "EXPIRED_REQUIRED_EVIDENCE", message: `${requirement.label} includes expired required evidence.`, relatedFields: requirement.field ? [requirement.field] : [], requirementId: requirement.id }];
    result.reason = result.blockingIssues[0].message;
    return result;
  }
  if (requirement.blockOnRejectedEvidence && documents.some((document) => document.status === EvidenceStatus.REJECTED)) {
    result.status = "BLOCKED";
    result.blockingIssues = [{ code: "REJECTED_REQUIRED_EVIDENCE", message: `${requirement.label} includes rejected required evidence.`, relatedFields: requirement.field ? [requirement.field] : [], requirementId: requirement.id }];
    result.reason = result.blockingIssues[0].message;
    return result;
  }

  const confidenceOk = requirement.minimumConfidence === undefined || best.confidence >= requirement.minimumConfidence;
  const statusOk = !requirement.minimumEvidenceStatus || statusRank(best.status) >= statusRank(requirement.minimumEvidenceStatus);
  if (confidenceOk && statusOk) {
    result.status = "SATISFIED";
    result.score = 100;
    result.reason = `${requirement.label} has acceptable submitted evidence.`;
    return result;
  }
  result.status = requirement.manualReviewAllowed ? "MANUAL_REVIEW" : "PARTIALLY_SATISFIED";
  result.score = scoreFromConfidence(best.confidence, requirement.minimumConfidence, definition.scoring.partialStatusScoreFloor);
  result.reason = `${requirement.label} exists but is below the configured confidence or evidence-status requirement.`;
  return result;
}

function evaluateMetricRequirement(
  definition: ReadinessProfileDefinition,
  requirement: ReadinessRequirement,
  trustProfile: BusinessTrustProfile
) {
  const result = baseResult(requirement);
  const metric = requirement.minimumMetric!;
  const current = trustProfile.summary[metric.metric];
  result.currentConfidence = current;
  result.minimumConfidence = metric.value;
  if (current >= metric.value) {
    result.status = "SATISFIED";
    result.score = 100;
    result.reason = `${metric.metric} is ${current}, meeting the required ${metric.value}.`;
    return result;
  }
  result.status = "PARTIALLY_SATISFIED";
  result.score = scoreFromConfidence(current, metric.value, definition.scoring.partialStatusScoreFloor);
  result.reason = `${metric.metric} is ${current}, below the required ${metric.value}.`;
  return result;
}

function evaluateConsistencyRequirement(
  _definition: ReadinessProfileDefinition,
  requirement: ReadinessRequirement,
  trustProfile: BusinessTrustProfile
) {
  const result = baseResult(requirement);
  const blocking = contradictionsForRequirement(requirement, trustProfile);
  if (blocking.length > 0) {
    result.status = "BLOCKED";
    result.blockingIssues = blocking;
    result.reason = blocking[0].message;
    return result;
  }
  result.status = "SATISFIED";
  result.score = 100;
  result.reason = "No configured blocking contradiction was found.";
  return result;
}

export function contradictionsForRequirement(requirement: ReadinessRequirement, trustProfile: BusinessTrustProfile): BlockingIssue[] {
  const severities = requirement.blockingContradictionSeverities ?? [];
  return trustProfile.contradictions
    .filter((contradiction) => severities.includes(contradiction.severity))
    .map((contradiction) => ({
      code: `${contradiction.severity}_CONTRADICTION`,
      message: contradiction.reason,
      relatedFields: [contradiction.field as never],
      requirementId: requirement.id
    }));
}
