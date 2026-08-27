import type { Request, Response } from "express";
import * as businessService from "./business.service.js";

export async function upsert(req: Request, res: Response) {
  const business = await businessService.upsertProfile(req.user!.id, req.body);
  res.status(201).json({ business });
}

export async function getMine(req: Request, res: Response) {
  res.json({ business: await businessService.getMine(req.user!.id) });
}

export async function lookup(req: Request, res: Response) {
  const gstin = Array.isArray(req.params.gstin) ? req.params.gstin[0] : req.params.gstin;
  res.json({ business: await businessService.lookupByGstin(gstin) });
}

export async function patchMine(req: Request, res: Response) {
  res.json({ business: await businessService.upsertProfile(req.user!.id, req.body) });
}

export async function uploadDocument(req: Request, res: Response) {
  const document = await businessService.uploadDocument(req.user!.id, req.body.docType, req.file, {
    issuedAt: req.body.issuedAt,
    expiresAt: req.body.expiresAt,
    source: req.body.source
  });
  res.status(201).json({
    documentId: document.id,
    evidenceStatus: document.evidenceStatus,
    confidence: document.confidence,
    document
  });
}

export async function crossCheck(req: Request, res: Response) {
  res.json(await businessService.crossCheck(req.user!));
}

export async function verify(req: Request, res: Response) {
  res.json(await businessService.verify(req.user!));
}
