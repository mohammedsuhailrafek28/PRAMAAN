import type { Request, Response } from "express";
import * as reportService from "./report-composer.service.js";
import * as renderingService from "./rendering/report-rendering.service.js";

export function listTypes(_req: Request, res: Response) {
  res.json({ reportTypes: reportService.listReportTypes() });
}

export async function generate(req: Request, res: Response) {
  res.status(201).json(await reportService.generateReport(req.user!, String(req.body.reportType)));
}

export async function list(req: Request, res: Response) {
  res.json({ reports: await reportService.listReports(req.user!, req.query as Record<string, string>) });
}

export async function get(req: Request, res: Response) {
  res.json(await reportService.getReport(req.user!, String(req.params.reportId)));
}

export async function revoke(req: Request, res: Response) {
  res.json(await reportService.revokeReport(req.user!, String(req.params.reportId)));
}

export async function previewHtml(req: Request, res: Response) {
  const rendered = await renderingService.renderReportHtmlForUser(req.user!, String(req.params.reportId), "preview");
  setPrivateHtmlHeaders(res);
  res.type("text/html; charset=utf-8").send(rendered.html);
}

export async function downloadHtml(req: Request, res: Response) {
  const rendered = await renderingService.renderReportHtmlForUser(req.user!, String(req.params.reportId), "html");
  setPrivateHtmlHeaders(res);
  res.setHeader("Content-Disposition", `attachment; filename="${rendered.filenameBase}.html"`);
  res.type("text/html; charset=utf-8").send(rendered.html);
}

export async function downloadPdf(req: Request, res: Response) {
  const rendered = await renderingService.renderReportPdfForUser(req.user!, String(req.params.reportId));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `attachment; filename="${rendered.filenameBase}.pdf"`);
  res.type("application/pdf").send(rendered.pdf);
}

function setPrivateHtmlHeaders(res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
}
