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
