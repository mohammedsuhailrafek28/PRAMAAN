import type { Request, Response } from "express";
import * as service from "./onboarding.service.js";
import * as evidenceRequestService from "./evidence-request.service.js";

export async function packs(_req: Request, res: Response) { res.json({ packs: service.listPacks() }); }
export async function pack(req: Request, res: Response) { res.json({ pack: service.getPack(req.params.key as string, req.params.version as string | undefined) }); }
export async function create(req: Request, res: Response) { res.status(201).json({ assignment: await service.create(req.user!, req.body) }); }
export async function list(req: Request, res: Response) { res.json({ assignments: await service.list(req.user!, req.query.scope as "incoming" | "outgoing") }); }
export async function detail(req: Request, res: Response) { res.json({ assignment: await service.detail(req.user!, req.params.id as string) }); }
export async function accept(req: Request, res: Response) { res.json({ assignment: await service.accept(req.user!.id, req.params.id as string) }); }
export async function decline(req: Request, res: Response) { res.json({ assignment: await service.decline(req.user!.id, req.params.id as string) }); }
export async function cancel(req: Request, res: Response) { res.json({ assignment: await service.cancel(req.user!, req.params.id as string) }); }
export async function evidenceRequests(req: Request, res: Response) { res.json({ requests: await evidenceRequestService.list(req.user!, req.query.scope as "incoming" | "outgoing") }); }
export async function evidenceRequestDetail(req: Request, res: Response) { res.json({ request: await evidenceRequestService.detail(req.user!, req.params.id as string) }); }
export async function createEvidenceRequest(req: Request, res: Response) { res.status(201).json({ request: await evidenceRequestService.create(req.user!, req.params.assignmentId as string, req.body) }); }
export async function respondEvidenceRequest(req: Request, res: Response) { res.json({ request: await evidenceRequestService.respond(req.user!, req.params.id as string, req.body) }); }
export async function reviewEvidenceRequest(req: Request, res: Response) { res.json({ request: await evidenceRequestService.review(req.user!, req.params.id as string, req.body) }); }
