-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Document" (
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
    "issuedAt" DATETIME,
    "checkedAt" DATETIME,
    "expiresAt" DATETIME,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "previousVersionId" TEXT,
    "contradictionDetails" JSONB,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Document_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Document" ("businessId", "checkedAt", "confidence", "confidenceReason", "contradictionDetails", "crossCheckMethod", "docType", "evidenceStatus", "expiresAt", "filePath", "id", "mimeType", "originalName", "source", "uploadedAt", "verifiedFlag") SELECT "businessId", "checkedAt", "confidence", "confidenceReason", "contradictionDetails", "crossCheckMethod", "docType", "evidenceStatus", "expiresAt", "filePath", "id", "mimeType", "originalName", "source", "uploadedAt", "verifiedFlag" FROM "Document";
DROP TABLE "Document";
ALTER TABLE "new_Document" RENAME TO "Document";
-- Preserve the newest existing upload as the current evidence for each business/type.
UPDATE "Document" AS older
SET "isCurrent" = false
WHERE EXISTS (
    SELECT 1 FROM "Document" AS newer
    WHERE newer."businessId" = older."businessId"
      AND newer."docType" = older."docType"
      AND (newer."uploadedAt" > older."uploadedAt" OR (newer."uploadedAt" = older."uploadedAt" AND newer."id" > older."id"))
);
CREATE INDEX "Document_businessId_docType_isCurrent_idx" ON "Document"("businessId", "docType", "isCurrent");
CREATE INDEX "Document_previousVersionId_idx" ON "Document"("previousVersionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
