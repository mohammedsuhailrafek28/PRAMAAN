-- Preserve revision uniqueness and ensure only one current document exists per business/type.
CREATE UNIQUE INDEX "Document_businessId_docType_revision_key"
ON "Document"("businessId", "docType", "revision");

CREATE UNIQUE INDEX "Document_one_current_per_business_doc_type"
ON "Document"("businessId", "docType")
WHERE "isCurrent" = 1;
