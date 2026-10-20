import type { Request, Response } from "express";
import * as service from "./accessGrant.service.js";
import { evaluateTrustConclusion } from "../evidenceFirewall/firewall-adapter.js";

export async function create(req: Request, res: Response) { res.status(201).json({ grant: await service.create(req.user!, req.body) }); }
export async function list(req: Request, res: Response) { res.json({ grants: await service.list(req.user!.id) }); }
export async function revoke(req: Request, res: Response) { res.json({ grant: await service.revoke(req.user!.id, req.params.id as string) }); }
export async function guest(req: Request, res: Response) { res.json(await service.resolveGuest(req.params.token as string)); }
export async function conclusions(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.json(await evaluateTrustConclusion({ channel: "GUEST_LINK", token: req.params.token as string }, req.body));
}
