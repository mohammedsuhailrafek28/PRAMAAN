import type { Request, Response } from "express";
import * as businessService from "./business.service.js";

export async function upsert(req: Request, res: Response) {
  const business = await businessService.upsertProfile(req.user!.id, req.body);
  res.status(201).json({ business });
}

export async function getMine(req: Request, res: Response) {
  res.json({ business: await businessService.getMine(req.user!.id) });
}

export async function patchMine(req: Request, res: Response) {
  res.json({ business: await businessService.upsertProfile(req.user!.id, req.body) });
}

export async function uploadDocument(req: Request, res: Response) {
  const document = await businessService.uploadDocument(req.user!.id, req.body.docType, req.file);
  res.status(201).json({ documentId: document.id, verifiedFlag: document.verifiedFlag, document });
}

export async function verify(req: Request, res: Response) {
  res.json(await businessService.verify(req.user!));
}
