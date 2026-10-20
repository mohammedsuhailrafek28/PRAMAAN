import type { Request, Response } from "express";
import * as service from "./onboarding.service.js";

export async function packs(_req: Request, res: Response) { res.json({ packs: service.listPacks() }); }
export async function pack(req: Request, res: Response) { res.json({ pack: service.getPack(req.params.key as string, req.params.version as string | undefined) }); }
export async function create(req: Request, res: Response) { res.status(201).json({ assignment: await service.create(req.user!, req.body) }); }
export async function list(req: Request, res: Response) { res.json({ assignments: await service.list(req.user!, req.query.scope as "incoming" | "outgoing") }); }
export async function detail(req: Request, res: Response) { res.json({ assignment: await service.detail(req.user!, req.params.id as string) }); }
export async function accept(req: Request, res: Response) { res.json({ assignment: await service.accept(req.user!.id, req.params.id as string) }); }
export async function decline(req: Request, res: Response) { res.json({ assignment: await service.decline(req.user!.id, req.params.id as string) }); }
export async function cancel(req: Request, res: Response) { res.json({ assignment: await service.cancel(req.user!, req.params.id as string) }); }
