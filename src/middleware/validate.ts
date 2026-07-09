import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";

type Schemas = {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
};

export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (schemas.body) req.body = schemas.body.parse(req.body);
    if (schemas.query) schemas.query.parse(req.query);
    if (schemas.params) schemas.params.parse(req.params);
    next();
  };
}
