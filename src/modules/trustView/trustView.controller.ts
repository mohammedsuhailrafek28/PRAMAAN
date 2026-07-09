import type { Request, Response } from "express";
import * as trustViewService from "./trustView.service.js";

export async function get(req: Request, res: Response) {
  res.json(await trustViewService.getTrustView(req.user!.id, req.params.consentRequestId as string));
}
