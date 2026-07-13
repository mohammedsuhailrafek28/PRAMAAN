-- Trust OS foundation baseline migration.
-- This repository previously used prisma/init-sqlite.ts instead of checked-in migrations.
-- For existing local SQLite files, prisma/init-sqlite.ts adds the new Trust OS columns
-- without mapping historical uploads to SOURCE_VERIFIED.

CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "role" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "organizationName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Business" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "legalName" TEXT,
  "gstin" TEXT,
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

CREATE UNIQUE INDEX "Business_userId_key" ON "Business"("userId");
CREATE UNIQUE INDEX "Business_gstin_key" ON "Business"("gstin");

CREATE TABLE "Document" (
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

CREATE TABLE "Passport" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Passport_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Passport_businessId_version_key" ON "Passport"("businessId", "version");

CREATE TABLE "ConsentRequest" (
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

CREATE TABLE "AuditLog" (
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

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "readFlag" BOOLEAN NOT NULL DEFAULT false,
  "relatedConsentId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Notification_relatedConsentId_fkey" FOREIGN KEY ("relatedConsentId") REFERENCES "ConsentRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ReadinessEvaluation" (
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
