import type { ReportDocument } from "../report-composer.types.js";

export type RenderFormat = "preview" | "html" | "pdf";

export type StoredReportForRendering = {
  id: string;
  businessId: string;
  reportType: string;
  reportVersion: string;
  generatedAt: Date;
  revokedAt: Date | null;
  snapshotJson: unknown;
};

export type RenderableReport = {
  report: StoredReportForRendering;
  document: ReportDocument;
  html: string;
  filenameBase: string;
};

export type PdfRenderResult = {
  buffer: Buffer;
  contentType: "application/pdf";
};
