import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { UserRole } from "@prisma/client";
import { env } from "../config/env.js";
import { ApiError } from "../utils/apiError.js";

type JwtPayload = {
  sub: string;
  role: UserRole;
  email: string;
};

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new ApiError(401, "UNAUTHORIZED", "Missing bearer token.");
  }

  try {
    const decoded = jwt.verify(header.slice(7), env.JWT_SECRET) as JwtPayload;
    req.user = { id: decoded.sub, role: decoded.role, email: decoded.email };
    next();
  } catch {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid or expired token.");
  }
}
