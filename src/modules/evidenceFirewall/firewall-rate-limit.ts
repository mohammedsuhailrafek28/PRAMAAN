import { createHash } from "node:crypto";
import rateLimit from "express-rate-limit";
import type { Request } from "express";

const ip = (req: Request) => req.ip ?? "unknown";
const guestKey = (req: Request) => `${createHash("sha256").update(typeof req.params.token === "string" ? req.params.token : "").digest("hex")}:${ip(req)}`;

export const registeredConclusionRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? ip(req),
  message: { error: { code: "RATE_LIMITED", message: "Too many trust conclusion requests." } }
});

export const guestConclusionRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: guestKey,
  message: { error: { code: "RATE_LIMITED", message: "Too many trust conclusion requests." } }
});
