import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import authRoutes from "./modules/auth/auth.routes.js";
import businessRoutes from "./modules/business/business.routes.js";
import passportRoutes from "./modules/passport/passport.routes.js";
import consentRoutes from "./modules/consent/consent.routes.js";
import trustViewRoutes from "./modules/trustView/trustView.routes.js";
import auditRoutes from "./modules/audit/audit.routes.js";
import notificationRoutes from "./modules/notifications/notifications.routes.js";

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN }));
app.use(express.json());
app.use(morgan("dev"));

async function healthResponse() {
  let databaseReachable = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    databaseReachable = false;
  }

  return {
    status: databaseReachable ? "ok" : "degraded",
    uptime: process.uptime(),
    databaseReachable,
    timestamp: new Date().toISOString()
  };
}

app.get("/health", async (_req, res) => {
  res.json(await healthResponse());
});

app.get("/api/health", async (_req, res) => {
  res.json(await healthResponse());
});

app.use("/api/auth", authRoutes);
app.use("/api/business", businessRoutes);
app.use("/api/passport", passportRoutes);
app.use("/api/consent-requests", consentRoutes);
app.use("/api/trust-view", trustViewRoutes);
app.use("/api/audit-logs", auditRoutes);
app.use("/api/notifications", notificationRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
