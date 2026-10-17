import type { ReportType } from "@prisma/client";

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
export function validateReportDocument(document: ReportDocument, expected: { reportId: string; businessId: string }) {
  for (const key of requiredSnapshotKeys) {
    if (!(key in document)) throw new Error(`Report snapshot is missing ${key}.`);
  }
  if (document.reportId !== expected.reportId) throw new Error("Report snapshot ID does not match the report row.");
  if (document.provenance.businessId !== expected.businessId) throw new Error("Report snapshot business does not match the report row.");
  if (!document.headline || typeof document.headline.summary !== "string") throw new Error("Report snapshot headline is incomplete.");
  if (!Array.isArray(document.trustMetrics) || !Array.isArray(document.identityFields) || !Array.isArray(document.evidence)) {
    throw new Error("Report snapshot collections are incomplete.");
  }
}
