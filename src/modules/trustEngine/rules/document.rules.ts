import { DocumentType } from "@prisma/client";

export const supportedMimeTypes = new Set(["application/pdf", "image/png", "image/jpeg"]);

export const requiredEvidenceByField: Record<string, DocumentType[]> = {
  gstin: [DocumentType.GST_CERTIFICATE],
  udyamNumber: [DocumentType.UDYAM_CERTIFICATE],
  bankAccount: [DocumentType.BANK_STATEMENT]
};

export const requiredDocumentTypes = [
  DocumentType.GST_CERTIFICATE,
  DocumentType.UDYAM_CERTIFICATE,
  DocumentType.BANK_STATEMENT
];
