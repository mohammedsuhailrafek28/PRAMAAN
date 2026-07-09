import type { Request, Response } from "express";
import * as passportService from "./passport.service.js";

export async function generate(req: Request, res: Response) {
  const passport = await passportService.generate(req.user!.id);
  res.status(201).json({
    passportId: passport.id,
    version: passport.version,
    snapshot: passport.snapshotJson
  });
}

export async function getMine(req: Request, res: Response) {
  const passport = await passportService.getMine(req.user!.id);
  res.json({ passport });
}
