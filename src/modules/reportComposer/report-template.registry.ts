import { ReportType } from "@prisma/client";
import { ApiError } from "../../utils/apiError.js";
import { getReadinessProfile } from "../readinessEngine/readiness-profile.registry.js";
import type { ReportTemplate } from "./report-composer.types.js";

export const REPORT_FRESHNESS_POLICY = {
  trustProfileMaxAgeMs: 10 * 60 * 1000,
  readinessMaxAgeMs: 10 * 60 * 1000,
  expiresAt: null as null
};

export const reportTemplates: ReportTemplate[] = [
  {
    reportType: ReportType.BUSINESS_TRUST_PROFILE,
    displayName: "Business Trust Profile Report",
    description: "Structured snapshot of business claims, evidence confidence, gaps, contradictions, and Trust OS metrics.",
    reportVersion: "1.0",
    readinessProfileId: null,
    disclaimer: "This report summarizes submitted evidence and internal checks. It is not a certificate, approval, eligibility decision, credit assessment, or external verification.",
    includedSections: ["business", "headline", "trustMetrics", "identityFields", "evidence", "contradictions", "gaps", "actions", "timeline", "limitations", "provenance"],
    requiresReadiness: false,
    recalculateAllowed: true
  },
  {
    reportType: ReportType.VENDOR_ONBOARDING_READINESS,
    displayName: "Vendor Onboarding Readiness Report",
    description: "Purpose-specific preparation report for B2B vendor onboarding.",
    reportVersion: "1.0",
    readinessProfileId: "vendor-onboarding",
    disclaimer: getReadinessProfile("vendor-onboarding").disclaimer,
    includedSections: ["business", "headline", "trustMetrics", "identityFields", "requirements", "evidence", "contradictions", "gaps", "actions", "timeline", "limitations", "provenance"],
    requiresReadiness: true,
    recalculateAllowed: true
  },
  {
    reportType: ReportType.LOAN_APPLICATION_PREPARATION,
    displayName: "Loan Application Preparation Report",
    description: "Purpose-specific document preparation report for approaching a lender.",
    reportVersion: "1.0",
    readinessProfileId: "loan-application-preparation",
    disclaimer: getReadinessProfile("loan-application-preparation").disclaimer,
    includedSections: ["business", "headline", "trustMetrics", "identityFields", "requirements", "evidence", "contradictions", "gaps", "actions", "timeline", "limitations", "provenance"],
    requiresReadiness: true,
    recalculateAllowed: true
  },
  {
    reportType: ReportType.GOVERNMENT_PROCUREMENT_READINESS,
    displayName: "Government Procurement Readiness Report",
    description: "Purpose-specific preparation report for generic government procurement onboarding.",
    reportVersion: "1.0",
    readinessProfileId: "government-procurement",
    disclaimer: getReadinessProfile("government-procurement").disclaimer,
    includedSections: ["business", "headline", "trustMetrics", "identityFields", "requirements", "evidence", "contradictions", "gaps", "actions", "timeline", "limitations", "provenance"],
    requiresReadiness: true,
    recalculateAllowed: true
  },
  {
    reportType: ReportType.GOVERNMENT_SCHEME_APPLICATION_READINESS,
    displayName: "Government Scheme Application Readiness Report",
    description: "Purpose-specific preparation report for a generic MSME scheme application.",
    reportVersion: "1.0",
    readinessProfileId: "government-scheme-application",
    disclaimer: getReadinessProfile("government-scheme-application").disclaimer,
    includedSections: ["business", "headline", "trustMetrics", "identityFields", "requirements", "evidence", "contradictions", "gaps", "actions", "timeline", "limitations", "provenance"],
    requiresReadiness: true,
    recalculateAllowed: true
  }
];

export function validateReportTemplates(templates = reportTemplates) {
  const seen = new Set<ReportType>();
  for (const template of templates) {
    if (seen.has(template.reportType)) throw new Error(`Duplicate report type ${template.reportType}`);
    seen.add(template.reportType);
    if (!template.reportVersion) throw new Error(`Report type ${template.reportType} is missing a version.`);
    if (!template.disclaimer) throw new Error(`Report type ${template.reportType} is missing a disclaimer.`);
    if (template.includedSections.length === 0) throw new Error(`Report type ${template.reportType} has no sections.`);
    if (template.readinessProfileId) getReadinessProfile(template.readinessProfileId);
  }
  return templates;
}

validateReportTemplates();

export function listReportTypes() {
  return reportTemplates.map(({ reportType, displayName, description, reportVersion, readinessProfileId, disclaimer }) => ({
    reportType,
    displayName,
    description,
    reportVersion,
    readinessProfileId,
    disclaimer
  }));
}

export function getReportTemplate(reportType: ReportType) {
  const template = reportTemplates.find((item) => item.reportType === reportType);
  if (!template) throw new ApiError(400, "UNSUPPORTED_REPORT_TYPE", "Unsupported report type.");
  return template;
}
