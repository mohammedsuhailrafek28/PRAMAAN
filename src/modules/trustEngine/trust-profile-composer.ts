import type { BusinessTrustProfile } from "./trust-engine.types.js";

export function composeGeneratedTrustProfile(input: {
  profileId: string;
  generatedAt: Date;
  version: number;
  profile: BusinessTrustProfile;
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
    generatedAt: input.generatedAt.toISOString(),
    lastCalculatedAt: input.profile.lastCalculatedAt,
    version: input.version,
    ...fieldMap,
    summary: input.profile.summary,
    fieldConfidence: input.profile.fieldConfidence,
    documentConfidence: input.profile.documentConfidence,
    gaps: input.profile.gaps,
    contradictions: input.profile.contradictions,
    limitations: input.profile.limitations,
    sourceVerificationPerformed: input.profile.sourceVerificationPerformed
  };
}
