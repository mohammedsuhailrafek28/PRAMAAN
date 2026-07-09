import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@prisma/client";
import { ApiError } from "../utils/apiError.js";

export function requireRole(roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new ApiError(401, "UNAUTHORIZED", "Authentication required.");
    if (!roles.includes(req.user.role)) {
      throw new ApiError(403, "FORBIDDEN", "Your role cannot perform this action.");
    }
    next();
  };
}
