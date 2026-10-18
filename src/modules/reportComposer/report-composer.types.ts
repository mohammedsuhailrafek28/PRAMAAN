import { DocumentType, EvidenceStatus, ReportType } from "@prisma/client";

export type ReportTemplate = {
  reportType: ReportType;
  displayName: string;
  description: string;
  reportVersion: string;
  readinessProfileId: string | null;
  disclaimer: string;
  includedSections: string[];
  requiresReadiness: boolean;
  recalculateAllowed: boolean;
};

export type ReportDocument = {
  reportId: string;
  reportType: ReportType;
  reportVersion: string;
  generatedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  business: Record<string, unknown>;
  headline: {
    statusLabel: string;
    score?: number | null;
    level?: string | null;
    summary: string;
    blocked?: boolean;
  };
  trustMetrics: Array<Record<string, unknown>>;
  identityFields: Array<Record<string, unknown>>;
  requirements: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  contradictions: Array<Record<string, unknown>>;
  gaps: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  timeline: Array<Record<string, unknown>>;
  limitations: string[];
  disclaimer: string;
  provenance: Record<string, unknown>;
};

const requiredSnapshotKeys = [
  "reportId",
  "reportType",
  "reportVersion",
  "generatedAt",
  "expiresAt",
  "revokedAt",
  "business",
  "headline",
  "trustMetrics",
  "identityFields",
  "requirements",
  "evidence",
  "contradictions",
  "gaps",
  "actions",
  "timeline",
  "limitations",
  "disclaimer",
  "provenance"
] as const;

/** Reject incomplete documents before they can cross the persistence boundary. */
export function validateReportDocument(document: ReportDocument, expected: {
  reportId: string;
  businessId: string;
  passportId?: string;
  pinnedEvidenceIds?: readonly string[];
}) {
  const problems: string[] = [];
  const object = (value: unknown, path: string): Record<string, any> | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      problems.push(`${path} must be an object`);
      return null;
    }
    return value as Record<string, any>;
  };
  const string = (value: unknown, path: string, nullable = false) => {
    if (typeof value !== "string" && !(nullable && value === null)) problems.push(`${path} must be a ${nullable ? "string or null" : "string"}`);
  };
  const finite = (value: unknown, path: string, nullable = false) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      if (!(nullable && value === null)) problems.push(`${path} must be a finite number${nullable ? " or null" : ""}`);
    }
  };
  const iso = (value: unknown, path: string, nullable = false) => {
    if (nullable && value === null) return;
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) problems.push(`${path} must be an ISO timestamp${nullable ? " or null" : ""}`);
  };
  const checks = (value: unknown, path: string) => {
    if (!Array.isArray(value)) {
      problems.push(`${path} must be an array`);
      return;
    }
    value.forEach((check, index) => {
      const item = object(check, `${path}[${index}]`);
      if (!item) return;
      string(item.type, `${path}[${index}].type`);
      string(item.result, `${path}[${index}].result`);
      string(item.reason, `${path}[${index}].reason`);
    });
  };
  const records = (value: unknown, path: string) => {
    if (!Array.isArray(value)) {
      problems.push(`${path} must be an array`);
      return;
    }
    value.forEach((item, index) => object(item, `${path}[${index}]`));
  };
  for (const key of requiredSnapshotKeys) {
    if (!document || typeof document !== "object" || !(key in document)) problems.push(`Report snapshot is missing ${key}.`);
  }
  const root = object(document, "document");
  if (!root) throw new Error(problems.join("; "));
  if (root.reportId !== expected.reportId) problems.push("Report snapshot ID does not match the report row.");
  if (!Object.values(ReportType).includes(root.reportType)) problems.push("reportType is invalid.");
  string(root.reportVersion, "reportVersion");
  iso(root.generatedAt, "generatedAt");
  iso(root.expiresAt, "expiresAt", true);
  iso(root.revokedAt, "revokedAt", true);

  const business = object(root.business, "business");
  if (business) {
    string(business.businessId, "business.businessId");
    if (business.businessId !== expected.businessId) problems.push("Report snapshot business does not match the report row.");
    string(business.businessName, "business.businessName", true);
    string(business.ownerName, "business.ownerName", true);
    string(business.address, "business.address", true);
    const identifiers = object(business.identifiers, "business.identifiers");
    if (identifiers) for (const key of ["gstin", "pan", "udyamNumber"]) string(identifiers[key], `business.identifiers.${key}`, true);
  }

  const headline = object(root.headline, "headline");
  if (headline) {
    string(headline.statusLabel, "headline.statusLabel");
    string(headline.summary, "headline.summary");
    if (headline.score !== undefined && headline.score !== null) finite(headline.score, "headline.score");
    if (headline.level !== undefined && headline.level !== null) string(headline.level, "headline.level");
    if (headline.blocked !== undefined && typeof headline.blocked !== "boolean") problems.push("headline.blocked must be boolean");
  }

  records(root.trustMetrics, "trustMetrics");
  if (Array.isArray(root.trustMetrics)) root.trustMetrics.forEach((metric: any, index: number) => {
    if (metric && metric.score !== undefined && metric.score !== null) finite(metric.score, `trustMetrics[${index}].score`);
  });
  records(root.requirements, "requirements");
  records(root.contradictions, "contradictions");
  records(root.gaps, "gaps");
  records(root.actions, "actions");
  records(root.timeline, "timeline");
  if (!Array.isArray(root.limitations) || root.limitations.some((item: unknown) => typeof item !== "string")) problems.push("limitations must be an array of strings");
  string(root.disclaimer, "disclaimer");

  const pinnedIds = new Set(expected.pinnedEvidenceIds ?? (Array.isArray(root.evidence) ? root.evidence.map((item: any) => item?.documentId) : []));
  const identityFields = root.identityFields;
  if (!Array.isArray(identityFields)) problems.push("identityFields must be an array");
  else identityFields.forEach((item: any, index: number) => {
    const field = object(item, `identityFields[${index}]`);
    if (!field) return;
    string(field.field, `identityFields[${index}].field`);
    string(field.label, `identityFields[${index}].label`);
    string(field.evidenceStatus, `identityFields[${index}].evidenceStatus`);
    if (!Object.values(EvidenceStatus).includes(field.evidenceStatus)) problems.push(`identityFields[${index}].evidenceStatus is invalid`);
    finite(field.confidence, `identityFields[${index}].confidence`);
    string(field.reason, `identityFields[${index}].reason`);
    if (!Array.isArray(field.evidenceIds) || field.evidenceIds.some((id: unknown) => typeof id !== "string" || !pinnedIds.has(id))) problems.push(`identityFields[${index}].evidenceIds escape the pinned evidence set`);
    checks(field.checks, `identityFields[${index}].checks`);
  });

  const evidence = root.evidence;
  if (!Array.isArray(evidence)) problems.push("evidence must be an array");
  else {
    const seen = new Set<string>();
    evidence.forEach((item: any, index: number) => {
      const record = object(item, `evidence[${index}]`);
      if (!record) return;
      string(record.documentId, `evidence[${index}].documentId`);
      if (typeof record.documentId === "string") {
        if (seen.has(record.documentId)) problems.push(`evidence[${index}].documentId is duplicated`);
        seen.add(record.documentId);
        if (!pinnedIds.has(record.documentId)) problems.push(`evidence[${index}].documentId escapes the pinned evidence set`);
      }
      if (!Object.values(DocumentType).includes(record.documentType)) problems.push(`evidence[${index}].documentType is invalid`);
      if (!Object.values(EvidenceStatus).includes(record.evidenceStatus)) problems.push(`evidence[${index}].evidenceStatus is invalid`);
      finite(record.confidence, `evidence[${index}].confidence`);
      string(record.reason, `evidence[${index}].reason`);
      string(record.fileName, `evidence[${index}].fileName`, true);
      string(record.submittedAt, `evidence[${index}].submittedAt`, true);
      string(record.crossCheckMethod, `evidence[${index}].crossCheckMethod`, true);
      iso(record.checkedAt, `evidence[${index}].checkedAt`, true);
      iso(record.expiresAt, `evidence[${index}].expiresAt`, true);
      checks(record.checks, `evidence[${index}].checks`);
      if (!Array.isArray(record.limitations) || record.limitations.some((value: unknown) => typeof value !== "string")) problems.push(`evidence[${index}].limitations must be strings`);
    });
  }

  const provenance = object(root.provenance, "provenance");
  if (provenance) {
    string(provenance.businessId, "provenance.businessId");
    string(provenance.trustProfileId, "provenance.trustProfileId");
    if (provenance.businessId !== expected.businessId) problems.push("Report provenance business does not match the report row.");
    if (expected.passportId && provenance.trustProfileId !== expected.passportId) problems.push("Report provenance Passport does not match the report row.");
    if (provenance.sourceVerificationPerformed !== false) problems.push("sourceVerificationPerformed must be false");
    for (const key of ["readinessEvaluationId", "readinessProfileId", "readinessProfileVersion"]) string(provenance[key], `provenance.${key}`, true);
    iso(provenance.trustProfileGeneratedAt, "provenance.trustProfileGeneratedAt");
  }
  if (problems.length) throw new Error(`Invalid report snapshot: ${problems.slice(0, 8).join("; ")}`);
}
