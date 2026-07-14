import type { Request, Response } from "express";
import * as reportService from "./report-composer.service.js";

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
