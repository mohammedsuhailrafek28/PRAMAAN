-- Phase 1B: targeted evidence clarification and review cases.
CREATE TABLE "EvidenceRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assignmentId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "requirementKey" TEXT NOT NULL,
    "requirementSnapshot" JSONB NOT NULL,
    "requestKind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "activeKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EvidenceRequest_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "OnboardingPackAssignment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EvidenceRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EvidenceRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "EvidenceRequestResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "responderId" TEXT NOT NULL,
    "responseType" TEXT NOT NULL,
    "documentId" TEXT,
    "clarificationText" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceRequestResponse_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "EvidenceRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EvidenceRequestResponse_responderId_fkey" FOREIGN KEY ("responderId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EvidenceRequestResponse_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "EvidenceRequestEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceRequestEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "EvidenceRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EvidenceRequestEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "EvidenceRequest_assignmentId_status_createdAt_idx" ON "EvidenceRequest"("assignmentId", "status", "createdAt");
CREATE INDEX "EvidenceRequest_businessId_status_createdAt_idx" ON "EvidenceRequest"("businessId", "status", "createdAt");
CREATE INDEX "EvidenceRequest_requesterId_status_createdAt_idx" ON "EvidenceRequest"("requesterId", "status", "createdAt");
CREATE UNIQUE INDEX "EvidenceRequest_activeKey_key" ON "EvidenceRequest"("activeKey");
CREATE INDEX "EvidenceRequestResponse_requestId_createdAt_idx" ON "EvidenceRequestResponse"("requestId", "createdAt");
CREATE INDEX "EvidenceRequestResponse_documentId_idx" ON "EvidenceRequestResponse"("documentId");
CREATE INDEX "EvidenceRequestEvent_requestId_createdAt_idx" ON "EvidenceRequestEvent"("requestId", "createdAt");
