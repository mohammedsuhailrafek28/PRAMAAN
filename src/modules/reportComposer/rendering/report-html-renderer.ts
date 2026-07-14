import type { ReportDocument } from "../report-composer.types.js";
import { renderReportHtml } from "./report-template.js";

export function renderHtmlFromSnapshot(document: ReportDocument) {
  return renderReportHtml(document);
}
