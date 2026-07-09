import type { Request, Response } from "express";
import * as authService from "./auth.service.js";

export async function register(req: Request, res: Response) {
  const result = await authService.register(req.body);
  res.status(201).json(result);
}

export async function login(req: Request, res: Response) {
  const result = await authService.login(req.body.email, req.body.password);
  res.json(result);
}

export async function logout(_req: Request, res: Response) {
  res.json({ success: true, message: "Discard the JWT on the client to log out." });
}
