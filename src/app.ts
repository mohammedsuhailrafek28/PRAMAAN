import cors from "cors";
import express, { type Request } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { prisma } from "./config/prisma.js";
import { openApiSpec } from "./docs/openapi.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestId } from "./middleware/requestId.js";
import authRoutes from "./modules/auth/auth.routes.js";
import businessRoutes from "./modules/business/business.routes.js";
import passportRoutes from "./modules/passport/passport.routes.js";
import consentRoutes from "./modules/consent/consent.routes.js";
import trustViewRoutes from "./modules/trustView/trustView.routes.js";
import auditRoutes from "./modules/audit/audit.routes.js";
import notificationRoutes from "./modules/notifications/notifications.routes.js";
import readinessRoutes from "./modules/readinessEngine/readiness.routes.js";
import reportRoutes from "./modules/reportComposer/report.routes.js";

export const app = express();

const allowedOrigins = env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || env.CORS_ORIGIN === "*" || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS origin not allowed"));
    }
  })
);
app.use(express.json());
app.use(requestId);
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.requestId ?? "unknown",
    serializers: {
      req(req) {
        const raw = req.raw as Request;
        return {
          id: req.id,
          method: req.method,
          path: raw.originalUrl ?? req.url
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode
        };
      }
    },
    customSuccessObject: (req, res, value) => ({
      ...value,
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode
    }),
    customErrorObject: (req, res, error, value) => ({
      ...value,
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      errorMessage: error.message
    })
  })
);

const apiRateLimit = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests. Please try again later."
    }
  }
});

async function healthResponse() {
  let connected = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    connected = false;
  }

  return {
    status: connected ? "healthy" : "degraded",
    service: "Pramaan Backend",
    version: "1.0.0",
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    database: {
      connected,
      provider: "sqlite"
    },
    timestamp: new Date().toISOString()
  };
}

app.get("/health", async (_req, res) => {
  res.json(await healthResponse());
});

app.get("/api/health", async (_req, res) => {
  res.json(await healthResponse());
});

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.use("/api", apiRateLimit);
app.use("/api/auth", authRoutes);
app.use("/api/business", businessRoutes);
app.use("/api/passport", passportRoutes);
app.use("/api/consent-requests", consentRoutes);
app.use("/api/trust-view", trustViewRoutes);
app.use("/api/readiness-profiles", readinessRoutes);
app.use("/api", reportRoutes);
app.use("/api/audit-logs", auditRoutes);
app.use("/api/notifications", notificationRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
