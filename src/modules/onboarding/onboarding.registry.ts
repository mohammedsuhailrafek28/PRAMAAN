import { DocumentType } from "@prisma/client";
import { z } from "zod";

const requirementSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  kind: z.literal("DOCUMENT"),
  documentType: z.nativeEnum(DocumentType),
  required: z.boolean(),
  description: z.string().min(1).max(240)
});

export const PACK_KEY = "vendor-onboarding";
export const PACK_VERSION = "1.0";

const requirements = [
  { key: DocumentType.GST_CERTIFICATE, label: "GST certificate", kind: "DOCUMENT" as const, documentType: DocumentType.GST_CERTIFICATE, required: true, description: "A current GST registration certificate." },
  { key: DocumentType.UDYAM_CERTIFICATE, label: "Udyam certificate", kind: "DOCUMENT" as const, documentType: DocumentType.UDYAM_CERTIFICATE, required: true, description: "A current Udyam registration certificate." },
  { key: DocumentType.BANK_STATEMENT, label: "Bank statement", kind: "DOCUMENT" as const, documentType: DocumentType.BANK_STATEMENT, required: false, description: "Optional banking evidence for supplier onboarding." }
];

export const vendorOnboardingPack = Object.freeze({
  key: PACK_KEY,
  version: PACK_VERSION,
  name: "Vendor onboarding",
  audience: "BUYER_OR_BANK",
  description: "A deterministic checklist for collecting the business documents commonly used in vendor onboarding.",
  requirements: Object.freeze(requirements.map((item) => Object.freeze(item)))
});

export type PackRequirement = z.infer<typeof requirementSchema>;

export function validatePackRequirements(value: unknown): PackRequirement[] {
  return z.array(requirementSchema).min(1).parse(value);
}

export function getPublishedPack(key: string, version?: string) {
  if (key !== PACK_KEY || (version && version !== PACK_VERSION)) return null;
  return vendorOnboardingPack;
}

export function listPublishedPacks() {
  return [vendorOnboardingPack];
}
