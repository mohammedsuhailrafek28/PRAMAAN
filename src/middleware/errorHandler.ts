import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "../utils/apiError.js";

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, "NOT_FOUND", `Route not found: ${req.method} ${req.path}`));
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message }
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: err.errors.map((issue) => issue.message).join("; ")
      }
    });
  }

  console.error(err);
  return res.status(500).json({
    error: { code: "INTERNAL_SERVER_ERROR", message: "Something went wrong." }
  });
}
