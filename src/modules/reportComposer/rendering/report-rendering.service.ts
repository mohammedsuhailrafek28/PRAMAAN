import { AuditAction, UserRole, type Prisma } from "@prisma/client";
import { prisma } from "../../../config/prisma.js";
import { ApiError } from "../../../utils/apiError.js";
import { writeAuditLog } from "../../audit/audit.service.js";
import type { ReportDocument } from "../report-composer.types.js";
import { renderHtmlFromSnapshot } from "./report-html-renderer.js";
import { renderPdfFromHtml } from "./report-pdf-renderer.js";
import { safeFilename } from "./report-sanitizer.js";
import type { RenderFormat, RenderableReport } from "./report-rendering.types.js";

const maxSnapshotBytes = 750_000;
const supportedReportVersionPattern = /^1\./;

export async function renderReportHtmlForUser(user: Express.User, reportId: string, format: RenderFormat) {
  const renderable = await buildRenderableReport(user, reportId);
  await auditRender(user, renderable, format);
  return renderable;
}

export async function renderReportPdfForUser(user: Express.User, reportId: string) {
  const renderable = await buildRenderableReport(user, reportId);
  const pdf = await renderPdfFromHtml({
    html: renderable.html,
    reportId: renderable.document.reportId,
    generatedAt: renderable.document.generatedAt
  });
  await auditRender(user, renderable, "pdf");
  return { ...renderable, pdf };
}

async function buildRenderableReport(user: Express.User, reportId: string): Promise<RenderableReport> {
  if (user.role !== UserRole.MSME) throw new ApiError(403, "FORBIDDEN", "Only MSMEs can render reports.");
  const report = await prisma.generatedReport.findUnique({ where: { id: reportId } });
  if (!report) throw new ApiError(404, "NOT_FOUND", "Report not found.");
  const business = await prisma.business.findUnique({ where: { id: report.businessId } });
  if (!business || business.userId !== user.id) throw new ApiError(404, "NOT_FOUND", "Report not found.");

  const document = parseSnapshot(report.snapshotJson);
  if (document.reportId !== report.id) throw new ApiError(500, "INVALID_REPORT_SNAPSHOT", "Stored report snapshot does not match the report record.");
  if (!supportedReportVersionPattern.test(document.reportVersion)) {
    throw new ApiError(422, "UNSUPPORTED_REPORT_VERSION", "This report version cannot be rendered.");
  }

  const html = renderHtmlFromSnapshot(document);
  return {
    report: {
      id: report.id,
      businessId: report.businessId,
      reportType: report.reportType,
      reportVersion: report.reportVersion,
      generatedAt: report.generatedAt,
      revokedAt: report.revokedAt,
      snapshotJson: report.snapshotJson
    },
    document,
    html,
    filenameBase: safeFilename(`pramaan-${document.reportType}-${document.reportId}`)
  };
}

function parseSnapshot(snapshot: Prisma.JsonValue): ReportDocument {
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > maxSnapshotBytes) {
    throw new ApiError(413, "REPORT_SNAPSHOT_TOO_LARGE", "Stored report snapshot is too large to render synchronously.");
  }

  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new ApiError(500, "INVALID_REPORT_SNAPSHOT", "Stored report snapshot is invalid.");
  }

  const doc = snapshot as Record<string, any>;
  for (const key of ["reportId", "reportType", "reportVersion", "generatedAt", "business", "headline", "provenance"]) {
    if (!(key in doc)) throw new ApiError(500, "INVALID_REPORT_SNAPSHOT", `Stored report snapshot is missing ${key}.`);
  }

  return doc as ReportDocument;
}

async function auditRender(user: Express.User, renderable: RenderableReport, format: RenderFormat) {
  const action =
    format === "preview"
      ? AuditAction.REPORT_HTML_VIEWED
      : format === "html"
        ? AuditAction.REPORT_HTML_DOWNLOADED
        : AuditAction.REPORT_PDF_DOWNLOADED;

  await writeAuditLog({
    businessId: renderable.report.businessId,
    actorId: user.id,
    action,
    metadata: {
      reportId: renderable.report.id,
      reportType: renderable.report.reportType,
      reportVersion: renderable.report.reportVersion,
      rendererFormat: format,
      revoked: Boolean(renderable.report.revokedAt)
    }
  });
}
