import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "request.headers.authorization",
      "request.headers.cookie",
      "*.password",
      "*.passwordHash",
      "body.password",
      "body.passwordHash"
    ],
    censor: "[redacted]"
  }
});
