import type { Request, Response } from "express";
import * as notificationService from "./notifications.service.js";

export async function list(req: Request, res: Response) {
  res.json({ notifications: await notificationService.list(req.user!.id) });
}

export async function markRead(req: Request, res: Response) {
  const notification = await notificationService.markRead(req.user!.id, req.params.id as string);
  res.json({ success: true, notification });
}
