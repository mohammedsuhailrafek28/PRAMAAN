-- Additive requester assurance records. Existing buyer/bank accounts are explicitly UNVERIFIED.
CREATE TABLE "RequesterAssurance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "reviewedOrganizationName" TEXT,
    "reviewBasis" TEXT,
    "reviewedAt" DATETIME,
    "reviewerIdentifier" TEXT,
    "authorizationBasis" TEXT,
    "authorizationReference" TEXT,
    "authorizationScope" JSONB,
    "authorizationExpiresAt" DATETIME,
    "suspensionReason" TEXT,
    "suspendedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RequesterAssurance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RequesterAssurance_userId_key" ON "RequesterAssurance"("userId");
CREATE INDEX "RequesterAssurance_status_authorizationExpiresAt_idx" ON "RequesterAssurance"("status", "authorizationExpiresAt");

CREATE TABLE "RequesterAssuranceEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RequesterAssuranceEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RequesterAssuranceEvent_userId_createdAt_idx" ON "RequesterAssuranceEvent"("userId", "createdAt");

INSERT INTO "RequesterAssurance" ("id", "userId", "status", "createdAt", "updatedAt")
SELECT ('assurance_' || "id"), "id", 'UNVERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User"
WHERE "role" IN ('BUYER', 'BANK')
  AND NOT EXISTS (SELECT 1 FROM "RequesterAssurance" AS existing WHERE existing."userId" = "User"."id");
