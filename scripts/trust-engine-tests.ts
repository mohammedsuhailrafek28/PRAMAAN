import { DocumentType, EvidenceStatus, UserRole, VerificationStatus } from "@prisma/client";
import { runInternalCrossCheck } from "../src/modules/trustEngine/cross-check-engine.js";
import { TRUST_READINESS_WEIGHTS } from "../src/modules/trustEngine/metrics-calculator.js";

let failures = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

function businessFixture(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-07-13T00:00:00.000Z");
  return {
    id: "business_1",
    userId: "user_1",
    legalName: "Sharma Textiles",
    gstin: "33ABCDE1234F1Z5",
    udyamNumber: "UDYAM-TN-01-0001234",
    pan: "ABCDE1234F",
    address: "Chennai, Tamil Nadu",
    turnoverBand: "INR 1Cr-INR 5Cr",
    verificationStatus: VerificationStatus.UNVERIFIED,
    trustStatus: EvidenceStatus.SELF_DECLARED,
    trustSummary: null,
    lastCrossCheckedAt: null,
    createdAt: now,
    updatedAt: now,
    user: {
      id: "user_1",
      role: UserRole.MSME,
      name: "Ravi Sharma",
      organizationName: "Sharma Textiles",
      email: "msme@pramaan.demo",
      passwordHash: "hash",
      createdAt: now
    },
    documents: [
      documentFixture("doc_gst", DocumentType.GST_CERTIFICATE),
      documentFixture("doc_udyam", DocumentType.UDYAM_CERTIFICATE),
      documentFixture("doc_bank", DocumentType.BANK_STATEMENT)
    ],
    ...overrides
  };
}

function documentFixture(id: string, docType: DocumentType, overrides: Record<string, unknown> = {}) {
  return {
    id,
    businessId: "business_1",
    docType,
    filePath: `uploads/${id}.pdf`,
    originalName: `${id}.pdf`,
    mimeType: "application/pdf",
    verifiedFlag: false,
    evidenceStatus: EvidenceStatus.DOCUMENT_SUBMITTED,
    confidence: 0,
    confidenceReason: null,
    crossCheckMethod: null,
    source: null,
    checkedAt: null,
    expiresAt: null,
    contradictionDetails: null,
    uploadedAt: new Date("2026-07-13T00:00:00.000Z"),
    ...overrides
  };
}

test("SELF_DECLARED claims are produced when profile data is missing", () => {
  const profile = runInternalCrossCheck(
    businessFixture({ legalName: null, gstin: null, udyamNumber: null, pan: null, address: null, turnoverBand: null, documents: [] })
  );
  assert(profile.fieldConfidence.some((field) => field.status === EvidenceStatus.SELF_DECLARED), "self-declared field missing");
  assert(profile.gaps.length >= 7, "required gaps missing");
});

test("DOCUMENT_SUBMITTED documents receive explainable confidence", () => {
  const profile = runInternalCrossCheck(businessFixture());
  const gstDocument = profile.documentConfidence.find((document) => document.documentType === DocumentType.GST_CERTIFICATE);
  assert(gstDocument?.status === EvidenceStatus.DOCUMENT_SUBMITTED, "document status mismatch");
  assert(gstDocument.confidence === 45, "document confidence should be deterministic");
  assert(gstDocument.reason.includes("not externally verified"), "document reason missing limitation");
});

test("CROSS_CHECKED fields are produced by internal format and consistency checks", () => {
  const profile = runInternalCrossCheck(businessFixture());
  const gstin = profile.fieldConfidence.find((field) => field.field === "gstin");
  const pan = profile.fieldConfidence.find((field) => field.field === "pan");
  assert(gstin?.status === EvidenceStatus.CROSS_CHECKED, "GSTIN should be cross-checked");
  assert(pan?.status === EvidenceStatus.CROSS_CHECKED, "PAN should be cross-checked");
});

test("SOURCE_VERIFIED is never produced without a source adapter", () => {
  const profile = runInternalCrossCheck(businessFixture());
  assert(profile.sourceVerificationPerformed === false, "source verification flag should be false");
  assert(!profile.fieldConfidence.some((field) => field.status === EvidenceStatus.SOURCE_VERIFIED), "field source verified");
  assert(!profile.documentConfidence.some((document) => document.status === EvidenceStatus.SOURCE_VERIFIED), "document source verified");
});

test("Malformed identifiers reduce confidence and become rejected", () => {
  const profile = runInternalCrossCheck(
    businessFixture({ gstin: "BADGSTIN", pan: "BADPAN", udyamNumber: "BADUDYAM" })
  );
  for (const field of ["gstin", "pan", "udyamNumber"]) {
    const result = profile.fieldConfidence.find((item) => item.field === field);
    assert(result?.status === EvidenceStatus.REJECTED, `${field} should be rejected`);
  }
});

test("Contradiction detection catches PAN and GSTIN mismatch", () => {
  const profile = runInternalCrossCheck(businessFixture({ pan: "ZZZZZ9999Z" }));
  assert(profile.contradictions.some((item) => item.field === "pan" && item.severity === "HIGH"), "PAN contradiction missing");
  assert(profile.summary.consistency < 100, "consistency should be penalized");
});

test("Expired evidence reduces freshness and document confidence", () => {
  const profile = runInternalCrossCheck(
    businessFixture({
      documents: [
        documentFixture("doc_gst", DocumentType.GST_CERTIFICATE, { expiresAt: new Date("2026-01-01T00:00:00.000Z") })
      ]
    }),
    new Date("2026-07-13T00:00:00.000Z")
  );
  assert(profile.documentConfidence[0]?.status === EvidenceStatus.EXPIRED, "expired document status missing");
  assert(profile.summary.freshness === 0, "freshness should be zero for only expired evidence");
});

test("Duplicate evidence produces a warning and deterministic penalty", () => {
  const profile = runInternalCrossCheck(
    businessFixture({
      documents: [
        documentFixture("doc_gst_1", DocumentType.GST_CERTIFICATE),
        documentFixture("doc_gst_2", DocumentType.GST_CERTIFICATE)
      ]
    })
  );
  assert(profile.documentConfidence.every((document) => document.confidence === 35), "duplicate penalty should apply");
  assert(profile.documentConfidence.every((document) => document.checks.some((check) => check.type === "DUPLICATE_EVIDENCE" && check.result === "WARNING")), "duplicate warning missing");
});

test("Trust Readiness uses centralized component weights", () => {
  const profile = runInternalCrossCheck(businessFixture());
  const expected = Math.round(
    TRUST_READINESS_WEIGHTS.PROFILE_COMPLETENESS * profile.summary.profileCompleteness +
      TRUST_READINESS_WEIGHTS.EVIDENCE_STRENGTH * profile.summary.evidenceStrength +
      TRUST_READINESS_WEIGHTS.CONSISTENCY * profile.summary.consistency +
      TRUST_READINESS_WEIGHTS.FRESHNESS * profile.summary.freshness
  );
  assert(profile.summary.trustReadiness === expected, "trust readiness formula mismatch");
});

if (failures > 0) {
  console.error(`\nTrust Engine tests failed with ${failures} failure(s).`);
  process.exit(1);
}

console.log("\nTrust Engine tests passed.");
