-- Finals Phase 1 disclosure hardening: explicit evidence scopes and pinned snapshots.
ALTER TABLE "ConsentRequest" ADD COLUMN "requestedEvidenceTypes" JSON NOT NULL DEFAULT '[]';
ALTER TABLE "ConsentRequest" ADD COLUMN "approvedEvidenceTypes" JSON NOT NULL DEFAULT '[]';
ALTER TABLE "ConsentRequest" ADD COLUMN "approvedPassportId" TEXT;
ALTER TABLE "AccessGrant" ADD COLUMN "passportId" TEXT;

CREATE INDEX "ConsentRequest_approvedPassportId_idx" ON "ConsentRequest"("approvedPassportId");
CREATE INDEX "AccessGrant_passportId_idx" ON "AccessGrant"("passportId");
