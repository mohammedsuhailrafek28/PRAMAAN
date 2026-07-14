import { DatabaseSync } from "node:sqlite";
import "dotenv/config";
import { mkdirSync } from "node:fs";
import path from "node:path";

function sqlitePathFromDatabaseUrl(databaseUrl?: string) {
  if (!databaseUrl?.startsWith("file:")) return path.resolve("prisma", "dev.db");
  const rawPath = databaseUrl.slice("file:".length);
  return path.isAbsolute(rawPath) ? rawPath : path.resolve("prisma", rawPath);
}

const dbPath = sqlitePathFromDatabaseUrl(process.env.DATABASE_URL);
mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);

db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "role" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "organizationName" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Business" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "legalName" TEXT,
  "gstin" TEXT UNIQUE,
  "udyamNumber" TEXT,
  "pan" TEXT,
  "address" TEXT,
  "turnoverBand" TEXT,
  "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "trustStatus" TEXT NOT NULL DEFAULT 'SELF_DECLARED',
  "trustSummary" JSONB,
  "lastCrossCheckedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Business_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Document" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "docType" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "verifiedFlag" BOOLEAN NOT NULL DEFAULT false,
  "evidenceStatus" TEXT NOT NULL DEFAULT 'DOCUMENT_SUBMITTED',
  "confidence" INTEGER NOT NULL DEFAULT 0,
  "confidenceReason" TEXT,
  "crossCheckMethod" TEXT,
  "source" TEXT,
  "checkedAt" DATETIME,
  "expiresAt" DATETIME,
  "contradictionDetails" JSONB,
  "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Document_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Passport" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Passport_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Passport_businessId_version_key" ON "Passport"("businessId", "version");

CREATE TABLE IF NOT EXISTS "ConsentRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requesterId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "requestedFields" JSONB NOT NULL,
  "approvedFields" JSONB,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "durationDays" INTEGER,
  "approvedAt" DATETIME,
  "expiresAt" DATETIME,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsentRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ConsentRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "consentRequestId" TEXT,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AuditLog_consentRequestId_fkey" FOREIGN KEY ("consentRequestId") REFERENCES "ConsentRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Notification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "readFlag" BOOLEAN NOT NULL DEFAULT false,
  "relatedConsentId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Notification_relatedConsentId_fkey" FOREIGN KEY ("relatedConsentId") REFERENCES "ConsentRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ReadinessEvaluation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "profileVersion" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "level" TEXT NOT NULL,
  "blocked" BOOLEAN NOT NULL,
  "summaryJson" JSONB NOT NULL,
  "evaluatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReadinessEvaluation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "GeneratedReport" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "reportType" TEXT NOT NULL,
  "reportVersion" TEXT NOT NULL,
  "trustProfileId" TEXT,
  "readinessEvaluationId" TEXT,
  "snapshotJson" JSONB NOT NULL,
  "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME,
  "revokedAt" DATETIME,
  "createdByUserId" TEXT NOT NULL,
  CONSTRAINT "GeneratedReport_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GeneratedReport_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "GeneratedReport_businessId_generatedAt_idx" ON "GeneratedReport"("businessId", "generatedAt");
CREATE INDEX IF NOT EXISTS "GeneratedReport_reportType_idx" ON "GeneratedReport"("reportType");
CREATE INDEX IF NOT EXISTS "GeneratedReport_readinessEvaluationId_idx" ON "GeneratedReport"("readinessEvaluationId");
`);

const existingColumns = (tableName: string) =>
  db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;

const ensureColumn = (tableName: string, columnName: string, definition: string) => {
  const hasColumn = existingColumns(tableName).some((column) => column.name === columnName);
  if (!hasColumn) {
    db.exec(`ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${definition};`);
  }
};

ensureColumn("Business", "trustStatus", "TEXT NOT NULL DEFAULT 'SELF_DECLARED'");
ensureColumn("Business", "trustSummary", "JSONB");
ensureColumn("Business", "lastCrossCheckedAt", "DATETIME");
ensureColumn("Document", "evidenceStatus", "TEXT NOT NULL DEFAULT 'DOCUMENT_SUBMITTED'");
ensureColumn("Document", "confidence", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("Document", "confidenceReason", "TEXT");
ensureColumn("Document", "crossCheckMethod", "TEXT");
ensureColumn("Document", "source", "TEXT");
ensureColumn("Document", "checkedAt", "DATETIME");
ensureColumn("Document", "expiresAt", "DATETIME");
ensureColumn("Document", "contradictionDetails", "JSONB");

db.close();
console.log(`Initialized SQLite database at ${dbPath}`);
