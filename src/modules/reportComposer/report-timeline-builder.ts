import type { AuditLog, User } from "@prisma/client";

const titles: Record<string, string> = {
  BUSINESS_PROFILE_CREATED: "Business profile created",
  BUSINESS_PROFILE_UPDATED: "Business profile updated",
  DOCUMENT_SUBMITTED: "Evidence submitted",
  BUSINESS_CROSS_CHECKED: "Internal cross-check completed",
  EVIDENCE_GAP_FOUND: "Evidence gap identified",
  CONTRADICTION_FOUND: "Contradiction identified",
  TRUST_PROFILE_GENERATED: "Business Trust Profile generated",
  READINESS_PROFILE_EVALUATED: "Readiness profile evaluated",
  READINESS_PROFILE_BLOCKED: "Readiness profile blocked",
  CONSENT_REQUESTED: "Consent requested",
  CONSENT_APPROVED: "Consent approved",
  TRUST_PROFILE_VIEWED: "Trust profile viewed",
  CONSENT_REVOKED: "Consent revoked",
  REPORT_GENERATED: "Report generated",
  REPORT_REVOKED: "Report revoked"
};

const allowed = new Set(Object.keys(titles));

export function buildTimeline(logs: Array<AuditLog & { actor?: Pick<User, "role" | "organizationName"> }>) {
  return logs
    .filter((log) => allowed.has(log.action))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .map((log) => ({
      eventId: log.id,
      eventType: log.action,
      title: titles[log.action],
      description: descriptionFor(log.action),
      occurredAt: log.createdAt.toISOString(),
      actorType: log.actor?.role ?? null,
      metadata: safeMetadata(log.metadata)
    }));
}

function descriptionFor(action: string) {
  if (action === "DOCUMENT_SUBMITTED") return "A submitted evidence record was added. This is not external verification.";
  if (action === "BUSINESS_CROSS_CHECKED") return "Deterministic internal checks were run against submitted claims and evidence.";
  if (action === "REPORT_GENERATED") return "An immutable JSON report snapshot was generated.";
  if (action === "REPORT_REVOKED") return "A report was non-destructively revoked.";
  return titles[action] ?? action;
}

function safeMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return undefined;
  const source = metadata as Record<string, unknown>;
  const allowedKeys = [
    "profileId",
    "profileVersion",
    "score",
    "level",
    "blocked",
    "evaluationId",
    "reportId",
    "reportType",
    "reportVersion",
    "readinessProfileId",
    "readinessProfileVersion",
    "readinessEvaluationId",
    "trustProfileId",
    "sourceVerificationPerformed"
  ];
  return allowedKeys.reduce<Record<string, unknown>>((acc, key) => {
    if (key in source) acc[key] = source[key];
    return acc;
  }, {});
}
