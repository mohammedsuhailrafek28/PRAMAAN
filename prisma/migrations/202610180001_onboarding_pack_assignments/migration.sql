-- Phase 1A: immutable onboarding-pack assignments and lifecycle audit linkage.
CREATE TABLE "OnboardingPackAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "packKey" TEXT NOT NULL,
    "packVersion" TEXT NOT NULL,
    "activeKey" TEXT,
    "requirementsSnapshot" JSONB NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    "declinedAt" DATETIME,
    "cancelledAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "OnboardingPackAssignment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OnboardingPackAssignment_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "OnboardingPackAssignment_businessId_status_createdAt_idx" ON "OnboardingPackAssignment"("businessId", "status", "createdAt");
CREATE INDEX "OnboardingPackAssignment_requesterId_status_createdAt_idx" ON "OnboardingPackAssignment"("requesterId", "status", "createdAt");
CREATE INDEX "OnboardingPackAssignment_packKey_packVersion_idx" ON "OnboardingPackAssignment"("packKey", "packVersion");
CREATE UNIQUE INDEX "OnboardingPackAssignment_activeKey_key" ON "OnboardingPackAssignment"("activeKey");

ALTER TABLE "AuditLog" ADD COLUMN "onboardingAssignmentId" TEXT;
CREATE INDEX "AuditLog_onboardingAssignmentId_idx" ON "AuditLog"("onboardingAssignmentId");

ALTER TABLE "Notification" ADD COLUMN "relatedOnboardingAssignmentId" TEXT;
CREATE INDEX "Notification_relatedOnboardingAssignmentId_idx" ON "Notification"("relatedOnboardingAssignmentId");
