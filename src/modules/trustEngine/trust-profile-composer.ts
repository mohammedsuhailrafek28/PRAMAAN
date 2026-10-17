import type { BusinessTrustProfile } from "./trust-engine.types.js";

export function composeGeneratedTrustProfile(input: {
  profileId: string;
  generatedAt: Date;
  version: number;
  profile: BusinessTrustProfile;
  /** Schema-2 snapshots embed the evidence records assessed at generation time (see passport-snapshot.ts). */
  evidence?: readonly Record<string, unknown>[];
  snapshotSchema?: number;
}) {
  const fieldMap = input.profile.fieldConfidence.reduce<Record<string, unknown>>((acc, field) => {
    const publicName = field.field === "legalBusinessName" ? "legalBusinessName" : field.field;
    acc[publicName] = {
      value: field.value,
      evidenceStatus: field.status,
      confidence: field.confidence,
      confidenceReason: field.reason,
      evidenceIds: field.evidenceIds,
      checks: field.checks
    };
    return acc;
  }, {});

  return {
    profileId: input.profileId,
    businessId: input.profile.businessId,
    ...(input.snapshotSchema !== undefined ? { snapshotSchema: input.snapshotSchema } : {}),
    generatedAt: input.generatedAt.toISOString(),
    lastCalculatedAt: input.profile.lastCalculatedAt,
    version: input.version,
    ...fieldMap,
    summary: input.profile.summary,
    fieldConfidence: input.profile.fieldConfidence,
    documentConfidence: input.profile.documentConfidence,
    ...(input.evidence ? { evidence: input.evidence } : {}),
    gaps: input.profile.gaps,
    contradictions: input.profile.contradictions,
    limitations: input.profile.limitations,
    sourceVerificationPerformed: input.profile.sourceVerificationPerformed
  };
}
