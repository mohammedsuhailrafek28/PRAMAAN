import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const nodeEnv = process.env.NODE_ENV ?? "development";
const configuredJwtSecret = process.env.JWT_SECRET ?? (nodeEnv === "production" ? undefined : "dev-secret-change-me");

const envSchema = z.object({
  DATABASE_URL: z.string().default("file:./dev.db"),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("7d"),
  NODE_ENV: z.string().default(nodeEnv),
  PORT: z.coerce.number().default(4000),
  UPLOAD_DIR: z.string().default("uploads"),
  CORS_ORIGIN: z.string().default("http://localhost:5173,http://localhost:3000,http://localhost:4173"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().default(1000),
  PUBLIC_APP_URL: z.string().default("http://localhost:5173")
}).superRefine((value, context) => {
  if (value.NODE_ENV === "production" && (!process.env.JWT_SECRET || value.JWT_SECRET === "dev-secret-change-me")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["JWT_SECRET"], message: "JWT_SECRET must be explicitly configured in production." });
  }
});

export const env = envSchema.parse({ ...process.env, JWT_SECRET: configuredJwtSecret });
