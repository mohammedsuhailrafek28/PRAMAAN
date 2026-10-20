-- Additive: metadata of owner evidence-review jobs. No extracted document content is stored here (values live only in a
-- short-lived in-memory cache), and nothing in this table feeds consent, Passport snapshots or trust scores.
CREATE TABLE "EvidenceReviewJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "docsTotal" INTEGER NOT NULL DEFAULT 0,
    "docsDone" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "errorCode" TEXT,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "isolation" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "heartbeatAt" DATETIME
);

CREATE INDEX "EvidenceReviewJob_businessId_createdAt_idx" ON "EvidenceReviewJob"("businessId", "createdAt");
CREATE INDEX "EvidenceReviewJob_status_createdAt_idx" ON "EvidenceReviewJob"("status", "createdAt");

-- At most one active (queued or running) review per business: duplicate protection enforced by the database.
CREATE UNIQUE INDEX "EvidenceReviewJob_one_active_per_business"
ON "EvidenceReviewJob"("businessId")
WHERE "status" IN ('QUEUED', 'RUNNING');
