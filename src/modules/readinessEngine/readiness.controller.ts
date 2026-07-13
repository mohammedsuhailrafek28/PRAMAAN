import type { Request, Response } from "express";
import * as readinessService from "./readiness-engine.service.js";

export function listProfiles(_req: Request, res: Response) {
  res.json({ profiles: readinessService.listReadinessProfiles() });
}

export function getProfile(req: Request, res: Response) {
  res.json({ profile: readinessService.getProfileDefinition(String(req.params.profileId)) });
}

export async function evaluate(req: Request, res: Response) {
  res.status(201).json(await readinessService.evaluateForMsme(req.user!, String(req.params.profileId)));
}

export async function latest(req: Request, res: Response) {
  res.json({ evaluation: await readinessService.latestForMsme(req.user!, String(req.params.profileId)) });
}

export async function history(req: Request, res: Response) {
  res.json({ evaluations: await readinessService.historyForMsme(req.user!) });
}
