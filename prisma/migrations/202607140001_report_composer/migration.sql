-- Report Composer schema migration.
-- This migration is intentionally separate from the Trust OS baseline migration.
-- It does not reinterpret historical evidence statuses or map internal checks to SOURCE_VERIFIED.

CREATE TABLE "GeneratedReport" (
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

CREATE INDEX "GeneratedReport_businessId_generatedAt_idx" ON "GeneratedReport"("businessId", "generatedAt");
CREATE INDEX "GeneratedReport_reportType_idx" ON "GeneratedReport"("reportType");
CREATE INDEX "GeneratedReport_readinessEvaluationId_idx" ON "GeneratedReport"("readinessEvaluationId");
