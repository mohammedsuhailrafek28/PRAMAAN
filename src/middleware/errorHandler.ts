import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "../utils/apiError.js";

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, "NOT_FOUND", "Not found."));
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

  const parserError = err as Error & { type?: string; status?: number };
  if (parserError.type === "entity.too.large" || parserError.status === 413) {
    return res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large." } });
  }
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Malformed JSON request body." } });
  }

  console.error("Unhandled request error", { name: err.name });
  return res.status(500).json({
    error: { code: "INTERNAL_SERVER_ERROR", message: "Something went wrong." }
  });
}
