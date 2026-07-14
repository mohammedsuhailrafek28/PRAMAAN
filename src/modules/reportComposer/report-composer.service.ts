import { AuditAction, ReportType, UserRole, type Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/apiError.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { listReportTypes } from "./report-template.registry.js";
import { loadReportData } from "./report-data-loader.js";
import { buildExecutiveSummary, trustMetricExplanations } from "./report-summary-builder.js";
import { buildTimeline } from "./report-timeline-builder.js";
import type { ReportDocument } from "./report-composer.types.js";

export { listReportTypes };

export async function generateReport(user: Express.User, reportTypeRaw: string) {
  const reportType = parseReportType(reportTypeRaw);
  const data = await loadReportData(user, reportType);
  const generatedAt = new Date();
  const placeholder = await prisma.generatedReport.create({
    data: {
      businessId: data.business.id,
      reportType,
      reportVersion: data.template.reportVersion,
      trustProfileId: data.passport.id,
      readinessEvaluationId: data.readinessEvaluationId,
      snapshotJson: {},
      generatedAt,
      expiresAt: null,
      createdByUserId: user.id
    }
  });

  const snapshot = composeReportDocument({
    reportId: placeholder.id,
    generatedAt,
    revokedAt: null,
    expiresAt: null,
    ...data
  });

  const report = await prisma.generatedReport.update({
    where: { id: placeholder.id },
    data: { snapshotJson: snapshot as Prisma.InputJsonValue }
  });

  await writeAuditLog({
    businessId: data.business.id,
    actorId: user.id,
    action: AuditAction.REPORT_GENERATED,
    metadata: auditMetadata(snapshot) as Prisma.InputJsonValue
  });

  return { report: metadataFor(report), document: snapshot };
}

export async function listReports(user: Express.User, filters: { reportType?: string; revoked?: string }) {
  if (user.role !== UserRole.MSME) throw new ApiError(403, "FORBIDDEN", "Only MSMEs can list reports.");
  const business = await prisma.business.findUnique({ where: { userId: user.id } });
  if (!business) throw new ApiError(404, "NOT_FOUND", "Business profile not found.");
  const where: Prisma.GeneratedReportWhereInput = { businessId: business.id };
  if (filters.reportType) where.reportType = parseReportType(filters.reportType);
  if (filters.revoked === "true") where.revokedAt = { not: null };
  if (filters.revoked === "false") where.revokedAt = null;
  const reports = await prisma.generatedReport.findMany({ where, orderBy: { generatedAt: "desc" } });
  return reports.map(metadataFor);
}

export async function getReport(user: Express.User, reportId: string) {
  const report = await requireOwnedReport(user, reportId);
  return { report: metadataFor(report), document: report.snapshotJson };
}

export async function revokeReport(user: Express.User, reportId: string) {
  const report = await requireOwnedReport(user, reportId);
  const revokedAt = report.revokedAt ?? new Date();
  const snapshot = report.snapshotJson as Record<string, any>;
  const updatedSnapshot = { ...snapshot, revokedAt: revokedAt.toISOString() };
  const updated = await prisma.generatedReport.update({
    where: { id: report.id },
    data: { revokedAt, snapshotJson: updatedSnapshot as Prisma.InputJsonValue }
  });
  await writeAuditLog({
    businessId: report.businessId,
    actorId: user.id,
    action: AuditAction.REPORT_REVOKED,
    metadata: {
      reportId: report.id,
      reportType: report.reportType,
      reportVersion: report.reportVersion,
      readinessEvaluationId: report.readinessEvaluationId,
      trustProfileId: report.trustProfileId
    }
  });
  return { report: metadataFor(updated), document: updated.snapshotJson };
}

async function requireOwnedReport(user: Express.User, reportId: string) {
  if (user.role !== UserRole.MSME) throw new ApiError(403, "FORBIDDEN", "Only MSMEs can access reports.");
  const report = await prisma.generatedReport.findUnique({ where: { id: reportId } });
  if (!report) throw new ApiError(404, "NOT_FOUND", "Report not found.");
  const business = await prisma.business.findUnique({ where: { id: report.businessId } });
  if (!business || business.userId !== user.id) throw new ApiError(404, "NOT_FOUND", "Report not found.");
  return report;
}

function composeReportDocument(input: Awaited<ReturnType<typeof loadReportData>> & {
  reportId: string;
  generatedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}): ReportDocument {
  const trustProfile = input.trustProfile;
  const readiness = input.readiness;
  const fields = (trustProfile.fieldConfidence ?? []) as Array<Record<string, any>>;
  const docs = (trustProfile.documentConfidence ?? []) as Array<Record<string, any>>;
  const docMeta = new Map(input.business.documents.map((doc) => [doc.id, doc]));
  const field = (name: string) => fields.find((item) => item.field === name);
  const summary = buildExecutiveSummary({
    reportType: input.template.reportType,
    trustProfile: trustProfile as any,
    readiness
  });

  return {
    reportId: input.reportId,
    reportType: input.template.reportType,
    reportVersion: input.template.reportVersion,
    generatedAt: input.generatedAt.toISOString(),
    expiresAt: input.expiresAt?.toISOString() ?? null,
    revokedAt: input.revokedAt?.toISOString() ?? null,
    business: {
      businessId: input.business.id,
      businessName: input.business.legalName,
      ownerName: input.business.user.name,
      businessType: null,
      identifiers: {
        gstin: input.business.gstin,
        pan: field("pan")?.value ?? null,
        udyamNumber: input.business.udyamNumber
      },
      address: input.business.address
    },
    headline: {
      statusLabel: readiness ? readiness.result.level : "EVIDENCE_BACKED_BUSINESS_TRUST_PROFILE",
      score: readiness?.result.score ?? trustProfile.summary?.trustReadiness ?? null,
      level: readiness?.result.level ?? null,
      blocked: readiness?.result.blocked ?? false,
      summary
    },
    trustMetrics: trustMetricExplanations(trustProfile.summary),
    identityFields: fields.map((item) => ({
      field: item.field,
      label: labelFor(item.field),
      value: item.value,
      evidenceStatus: item.status,
      confidence: item.confidence,
      reason: item.reason,
      evidenceIds: item.evidenceIds ?? [],
      checks: item.checks ?? []
    })),
    requirements: readiness?.requirements ?? [],
    evidence: docs.map((doc) => ({
      documentId: doc.documentId,
      documentType: doc.documentType,
      fileName: docMeta.get(doc.documentId)?.originalName ?? null,
      submittedAt: docMeta.get(doc.documentId)?.uploadedAt?.toISOString() ?? null,
      evidenceStatus: doc.status,
      confidence: doc.confidence,
      reason: doc.reason,
      crossCheckMethod: docMeta.get(doc.documentId)?.crossCheckMethod ?? "INTERNAL_METADATA_CHECK",
      checkedAt: docMeta.get(doc.documentId)?.checkedAt?.toISOString() ?? null,
      expiresAt: docMeta.get(doc.documentId)?.expiresAt?.toISOString() ?? null,
      checks: doc.checks ?? [],
      limitations: ["Document contents were not parsed.", "No authoritative source verification was performed."]
    })),
    contradictions: (trustProfile.contradictions ?? []).map((item: any) => ({
      field: item.field,
      severity: item.severity,
      reason: item.reason,
      claimedValue: item.claimedValue,
      evidenceValues: item.evidenceValues ?? [],
      confidencePenalty: null,
      resolutionNeeded: "Review and correct the conflicting submitted claim or evidence metadata."
    })),
    gaps: trustProfile.gaps ?? [],
    actions: dedupeActions(readiness?.nextActions ?? (trustProfile.gaps ?? []).map((gap: any) => ({
      priority: gap.severity,
      title: `Address ${gap.field ?? "evidence"} gap`,
      description: gap.message,
      reason: gap.message,
      requirementId: null,
      expectedStatusChange: "MISSING -> PARTIALLY_SATISFIED"
    }))),
    timeline: buildTimeline(input.auditLogs as any),
    limitations: [...(trustProfile.limitations ?? []), ...(readiness?.limitations ?? []), input.template.disclaimer],
    disclaimer: input.template.disclaimer,
    provenance: {
      businessId: input.business.id,
      trustProfileId: input.passport.id,
      trustProfileGeneratedAt: input.passport.generatedAt.toISOString(),
      readinessEvaluationId: input.readinessEvaluationId,
      readinessProfileId: input.template.readinessProfileId,
      readinessProfileVersion: readiness?.profile.version ?? null,
      sourceVerificationPerformed: false
    }
  };
}

function parseReportType(value: string) {
  if (!Object.values(ReportType).includes(value as ReportType)) {
    throw new ApiError(400, "UNSUPPORTED_REPORT_TYPE", "Unsupported report type.");
  }
  return value as ReportType;
}

function metadataFor(report: any) {
  const snapshot = report.snapshotJson as Record<string, any>;
  return {
    reportId: report.id,
    reportType: report.reportType,
    reportVersion: report.reportVersion,
    generatedAt: report.generatedAt,
    expiresAt: report.expiresAt,
    revokedAt: report.revokedAt,
    headlineStatus: snapshot?.headline?.statusLabel ?? null,
    score: snapshot?.headline?.score ?? null,
    level: snapshot?.headline?.level ?? null,
    readinessProfileId: snapshot?.provenance?.readinessProfileId ?? null,
    readinessProfileVersion: snapshot?.provenance?.readinessProfileVersion ?? null,
    sourceVerificationPerformed: false
  };
}

function auditMetadata(snapshot: ReportDocument) {
  return {
    reportId: snapshot.reportId,
    reportType: snapshot.reportType,
    reportVersion: snapshot.reportVersion,
    readinessProfileId: snapshot.provenance.readinessProfileId,
    readinessProfileVersion: snapshot.provenance.readinessProfileVersion,
    readinessEvaluationId: snapshot.provenance.readinessEvaluationId,
    trustProfileId: snapshot.provenance.trustProfileId,
    score: snapshot.headline.score,
    level: snapshot.headline.level,
    blocked: snapshot.headline.blocked
  };
}

function labelFor(field: string) {
  return field.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function dedupeActions(actions: Array<Record<string, any>>) {
  const map = new Map<string, Record<string, any>>();
  for (const action of actions) map.set(`${action.priority}:${action.title}:${action.requirementId ?? ""}`, action);
  return [...map.values()];
}
