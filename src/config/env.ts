import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().default("file:./dev.db"),
  JWT_SECRET: z.string().min(16).default("dev-secret-change-me"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  PORT: z.coerce.number().default(4000),
  UPLOAD_DIR: z.string().default("uploads"),
  CORS_ORIGIN: z.string().default("*")
});

export const env = envSchema.parse(process.env);
