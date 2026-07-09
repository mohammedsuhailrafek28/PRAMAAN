import type { Request, Response } from "express";
import * as consentService from "./consent.service.js";

export async function create(req: Request, res: Response) {
  const consent = await consentService.create(req.user!, req.body);
  res.status(201).json({ consentRequestId: consent.id, status: consent.status, consent });
}

export async function list(req: Request, res: Response) {
  res.json({ requests: await consentService.list(req.user!, req.query.scope as "incoming" | "outgoing") });
}

export async function approve(req: Request, res: Response) {
  const consent = await consentService.approve(req.user!.id, req.params.id as string, req.body);
  res.json({ status: consent.status, expiresAt: consent.expiresAt, consent });
}

export async function reject(req: Request, res: Response) {
  const consent = await consentService.reject(req.user!.id, req.params.id as string);
  res.json({ status: consent.status, consent });
}

export async function revoke(req: Request, res: Response) {
  const consent = await consentService.revoke(req.user!.id, req.params.id as string);
  res.json({ status: consent.status, consent });
}
