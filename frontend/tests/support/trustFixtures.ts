// Synthetic Trust Profile snapshots shaped exactly like the backend's (src/modules/trustEngine, passport-snapshot).
// Only synthetic data: no real identifiers.

import type { FieldCheck, TrustCheck, TrustProfile } from "../../src/types/index.ts";

export const pass = (type: string, reason = `${type} passed.`): TrustCheck => ({ type, result: "PASSED", reason });
export const fail = (type: string, reason = `${type} failed.`): TrustCheck => ({ type, result: "FAILED", reason });
export const warn = (type: string, reason = `${type} warning.`): TrustCheck => ({ type, result: "WARNING", reason });
export const na = (type: string, reason = `${type} not applicable.`): TrustCheck => ({ type, result: "NOT_APPLICABLE", reason });

export function field(overrides: Partial<FieldCheck> & { field: string }): FieldCheck {
  return { value: "x", status: "CROSS_CHECKED", confidence: 60, reason: "Recorded reason.", checks: [], evidenceIds: [], ...overrides };
}

export const EVIDENCE_RECORD = {
  documentId: "doc-gst-r2", docType: "GST_CERTIFICATE", revision: 2, evidenceStatus: "DOCUMENT_SUBMITTED", confidence: 45,
  crossCheckMethod: "INTERNAL_METADATA_CHECK", source: "MSME_SUBMITTED", issuedAt: "2026-01-10T00:00:00.000Z", checkedAt: "2026-10-01T10:00:00.000Z",
  expiresAt: "2027-01-10T00:00:00.000Z", uploadedAt: "2026-09-30T09:00:00.000Z",
  checks: [pass("FILE_EXISTS", "A file path was recorded."), pass("EXPIRY", "The evidence expiry date has not passed."), na("SOURCE_VERIFICATION", "No authoritative source adapter was used.")],
};

/** A schema-2 profile covering every explanation category. */
export function schema2Profile(overrides: Partial<TrustProfile> = {}): TrustProfile {
  return {
    id: "passport-7", businessId: "b-1", version: 7, generatedAt: "2026-10-01T10:00:01.000Z", lastCalculatedAt: "2026-10-01T10:00:00.000Z",
    summary: { trustReadiness: 60, profileCompleteness: 70, evidenceStrength: 40, consistency: 75, freshness: 80 },
    fields: [
      field({ field: "legalBusinessName", value: "Synthetic Textiles", status: "REJECTED", reason: "Name differs from the account organization.",
        checks: [pass("CLAIM_PRESENT", "The business submitted this claim."), na("SOURCE_VERIFICATION")] }),
      field({ field: "ownerName", value: "Asha Rao", status: "SELF_DECLARED", reason: "Entered by the business.",
        checks: [pass("CLAIM_PRESENT", "The business submitted this claim."), na("SOURCE_VERIFICATION")] }),
      field({ field: "gstin", value: "33TESTX0001A1Z5", status: "CROSS_CHECKED", reason: "Consistent with a submitted GST certificate.",
        checks: [pass("CLAIM_PRESENT"), pass("FORMAT", "Matches the internal format rule."), pass("SUPPORTING_DOCUMENT", "A relevant submitted document exists for this claim."), pass("INTERNAL_CONSISTENCY"), na("SOURCE_VERIFICATION")],
        evidenceIds: ["doc-gst-r2"] }),
      field({ field: "udyamNumber", value: "UDYAM-XX-00-0000001", status: "DOCUMENT_SUBMITTED", reason: "Evidence has expired.",
        checks: [pass("CLAIM_PRESENT"), fail("SUPPORTING_DOCUMENT", "No current relevant submitted document exists for this claim."), warn("EXPIRED_EVIDENCE", "At least one supporting evidence item for this claim is expired."), na("SOURCE_VERIFICATION")],
        evidenceIds: ["doc-udyam-r1"] }),
      field({ field: "pan", value: "ABCDE1234F", status: "REJECTED", reason: "PAN conflicts with GSTIN.",
        checks: [pass("CLAIM_PRESENT"), fail("INTERNAL_CONSISTENCY", "The claim conflicts with another submitted identifier."), na("SOURCE_VERIFICATION")] }),
      field({ field: "address", value: "12 Example Road", status: "SELF_DECLARED", reason: "Entered by the business.", checks: [pass("CLAIM_PRESENT"), na("SOURCE_VERIFICATION")] }),
      field({ field: "turnoverBand", value: null, status: "SELF_DECLARED", reason: "No value submitted.", checks: [fail("CLAIM_PRESENT", "The business has not submitted this claim."), na("SOURCE_VERIFICATION")] }),
      field({ field: "bankAccount", value: null, status: "SELF_DECLARED", reason: "No structured bank-account claim.",
        checks: [fail("CLAIM_PRESENT", "The business has not submitted this claim."), fail("SUPPORTING_DOCUMENT", "No current relevant submitted document exists for this claim."), na("SOURCE_VERIFICATION")], evidenceIds: [] }),
    ],
    documents: [
      { documentId: "doc-gst-r2", documentType: "GST_CERTIFICATE", status: "DOCUMENT_SUBMITTED", confidence: 45, reason: "A supported evidence file was submitted.", checks: EVIDENCE_RECORD.checks },
      { documentId: "doc-udyam-r1", documentType: "UDYAM_CERTIFICATE", status: "EXPIRED", confidence: 0, reason: "The stored expiry date has passed.",
        checks: [pass("FILE_EXISTS"), fail("EXPIRY", "The evidence expiry date has passed."), na("SOURCE_VERIFICATION")] },
    ],
    gaps: [{ field: "bankAccount", severity: "HIGH", message: "No structured bank-account claim has been submitted.", requiredEvidenceTypes: ["BANK_STATEMENT"] }],
    contradictions: [
      { field: "pan", severity: "HIGH", reason: "The PAN claim does not match the PAN segment embedded in the submitted GSTIN.", claimedValue: "ABCDE1234F", evidenceValues: ["ZZZZZ9999Z"] },
      { field: "businessName", severity: "MEDIUM", reason: "The legal business name differs from the organization name on the account.", claimedValue: "Synthetic Textiles", evidenceValues: ["Other Organization"] },
    ],
    limitations: ["No authoritative source was queried."],
    sourceVerificationPerformed: false,
    snapshotSchema: 2,
    evidence: [
      EVIDENCE_RECORD,
      { ...EVIDENCE_RECORD, documentId: "doc-udyam-r1", docType: "UDYAM_CERTIFICATE", revision: 1, evidenceStatus: "EXPIRED", confidence: 0, source: null, issuedAt: null, expiresAt: "2026-06-01T00:00:00.000Z",
        checks: [pass("FILE_EXISTS"), fail("EXPIRY", "The evidence expiry date has passed."), na("SOURCE_VERIFICATION")] },
    ],
    evidenceBasis: "SNAPSHOT",
    ...overrides,
  };
}

/** The same profile as a legacy snapshot: no embedded evidence records or snapshotSchema. */
export function legacyProfile(): TrustProfile {
  const base = schema2Profile();
  return { ...base, snapshotSchema: undefined, evidence: [], evidenceBasis: "LEGACY_SNAPSHOT" };
}

/** The raw backend snapshot JSON for the schema-2 profile, as /passport/me returns it. */
export function rawSnapshot(profile: TrustProfile = schema2Profile()) {
  return {
    profileId: profile.id, businessId: profile.businessId, snapshotSchema: profile.snapshotSchema, generatedAt: profile.generatedAt,
    lastCalculatedAt: profile.lastCalculatedAt, version: profile.version, summary: profile.summary,
    fieldConfidence: profile.fields.map((item) => ({ ...item, evidenceIds: item.evidenceIds })),
    documentConfidence: profile.documents, ...(profile.evidence.length ? { evidence: profile.evidence } : {}),
    gaps: profile.gaps, contradictions: profile.contradictions, limitations: profile.limitations, sourceVerificationPerformed: false,
  };
}
