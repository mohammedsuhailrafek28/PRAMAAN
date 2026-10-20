import type { Request, Response } from "express";
import * as trustViewService from "./trustView.service.js";
import { evaluateTrustConclusion } from "../evidenceFirewall/firewall-adapter.js";

export async function get(req: Request, res: Response) {
  res.json(await trustViewService.getTrustView(req.user!.id, req.params.consentRequestId as string));
}

export async function conclusions(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.json(await evaluateTrustConclusion({ channel: "CONSENT", principalId: req.user!.id, consentRequestId: req.params.consentRequestId as string }, req.body));
}
