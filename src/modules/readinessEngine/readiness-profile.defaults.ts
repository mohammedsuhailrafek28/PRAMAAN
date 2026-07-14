import { EvidenceStatus } from "@prisma/client";
import type { ReadinessScoringPolicy, ReadinessThresholds } from "./readiness-engine.types.js";

export const defaultReadinessScoring: ReadinessScoringPolicy = {
  manualReviewScore: 40,
  partialStatusScoreFloor: 35
};

export const defaultReadinessThresholds: ReadinessThresholds = {
  notReadyMax: 29,
  earlyStageMax: 49,
  partiallyReadyMax: 69,
  mostlyReadyMax: 84
};

export const evidenceStatusRank = {
  [EvidenceStatus.SELF_DECLARED]: 1,
  [EvidenceStatus.DOCUMENT_SUBMITTED]: 2,
  [EvidenceStatus.CROSS_CHECKED]: 3,
  [EvidenceStatus.SOURCE_VERIFIED]: 4,
  [EvidenceStatus.REJECTED]: 0,
  [EvidenceStatus.EXPIRED]: 0
} as const;
