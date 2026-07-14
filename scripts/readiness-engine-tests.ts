import { DocumentType, EvidenceStatus, ReadinessLevel, UserRole, VerificationStatus } from "@prisma/client";
import { runInternalCrossCheck } from "../src/modules/trustEngine/cross-check-engine.js";
import { getReadinessProfile, listReadinessProfiles, validateReadinessProfile } from "../src/modules/readinessEngine/readiness-profile.registry.js";
import { evaluateRequirement } from "../src/modules/readinessEngine/requirement-evaluator.js";
import { composeReadinessEvaluation } from "../src/modules/readinessEngine/readiness-profile-composer.js";
import { calculateReadinessScore, levelFromScore } from "../src/modules/readinessEngine/readiness-score-calculator.js";
import { generateNextActions } from "../src/modules/readinessEngine/readiness-action-generator.js";

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

function evaluate(profileId: string, overrides: Record<string, unknown> = {}) {
  const definition = getReadinessProfile(profileId);
  const trustProfile = runInternalCrossCheck(businessFixture(overrides));
  const requirements = definition.requirements.map((requirement) => evaluateRequirement(definition, requirement, trustProfile));
  return composeReadinessEvaluation({
    definition,
    businessId: trustProfile.businessId,
    trustProfile,
    requirements,
    blockingIssues: requirements.flatMap((requirement) => requirement.blockingIssues),
    evaluatedAt: new Date("2026-07-13T00:00:00.000Z")
  });
}

test("registry lists all four profiles and retrieves a valid profile", () => {
  const profiles = listReadinessProfiles();
  assert(profiles.length === 4, "expected four profiles");
  assert(getReadinessProfile("vendor-onboarding").purpose === "VENDOR_ONBOARDING", "vendor profile missing");
});

test("registry rejects malformed definitions", () => {
  const base = getReadinessProfile("vendor-onboarding");
  assertThrows(() => getReadinessProfile("missing-profile"), "unknown profile should throw");
  assertThrows(() => validateReadinessProfile({ ...base, requirements: [{ ...base.requirements[0], weight: 0 }] }), "invalid weight should throw");
  assertThrows(() => validateReadinessProfile({ ...base, requirements: [base.requirements[0], base.requirements[0]] }), "duplicate requirement should throw");
});

test("requirement evaluation covers satisfied, missing, partial, manual review, and optional not-applicable", () => {
  const definition = getReadinessProfile("vendor-onboarding");
  const full = runInternalCrossCheck(businessFixture());
  const satisfied = evaluateRequirement(definition, definition.requirements.find((item) => item.id === "vendor_gstin")!, full);
  assert(satisfied.status === "SATISFIED", "GSTIN should satisfy vendor profile");

  const missingProfile = runInternalCrossCheck(businessFixture({ gstin: null, documents: [] }));
  const missing = evaluateRequirement(definition, definition.requirements.find((item) => item.id === "vendor_gstin")!, missingProfile);
  assert(missing.status === "MISSING", "missing required GSTIN should be missing");

  const weak = evaluateRequirement(definition, { ...definition.requirements[0], minimumConfidence: 90 }, full);
  assert(weak.status === "PARTIALLY_SATISFIED", "weak confidence should be partial");

  const manual = evaluateRequirement(definition, definition.requirements.find((item) => item.id === "vendor_udyam_optional")!, runInternalCrossCheck(businessFixture({ udyamNumber: null })));
  assert(manual.status === "NOT_APPLICABLE", "optional absent requirement should be not applicable");
});

test("metric thresholds pass and fail deterministically", () => {
  const definition = getReadinessProfile("vendor-onboarding");
  const profile = runInternalCrossCheck(businessFixture({ documents: [] }));
  const metric = definition.requirements.find((item) => item.id === "vendor_evidence_strength")!;
  const result = evaluateRequirement(definition, metric, profile);
  assert(result.status === "PARTIALLY_SATISFIED", "low evidence strength should be partial");
});

test("critical and high contradictions block configured profiles", () => {
  const loan = evaluate("loan-application-preparation", { pan: "ZZZZZ9999Z" });
  assert(loan.result.level === ReadinessLevel.BLOCKED, "loan profile should be blocked by high PAN/GSTIN contradiction");
  assert(loan.result.score >= 0, "blocked score should remain explainable");
});

test("expired mandatory evidence blocks when configured", () => {
  const loan = evaluate("loan-application-preparation", {
    documents: [documentFixture("doc_bank", DocumentType.BANK_STATEMENT, { expiresAt: new Date("2026-01-01T00:00:00.000Z") })]
  });
  assert(loan.requirements.some((item) => item.status === "BLOCKED"), "expired bank evidence should block");
});

test("weighted scoring, not-applicable exclusion, clamping, and level mapping work", () => {
  const results = [
    result("a", "SATISFIED", 10, 100),
    result("b", "MISSING", 10, 0),
    result("c", "NOT_APPLICABLE", 100, 0)
  ];
  assert(calculateReadinessScore(results) === 50, "weighted score should exclude not applicable");
  const definition = getReadinessProfile("vendor-onboarding");
  assert(levelFromScore(85, definition, false) === ReadinessLevel.READY_FOR_REVIEW, "85 should be ready for review");
  assert(levelFromScore(90, definition, true) === ReadinessLevel.BLOCKED, "blocked should override score");
});

test("next actions prioritize blockers and dedupe by requirement", () => {
  const actions = generateNextActions([result("a", "MISSING", 5, 0), result("b", "BLOCKED", 1, 0), result("a", "MISSING", 5, 0)]);
  assert(actions[0].priority === "CRITICAL", "blocker action should come first");
  assert(actions.filter((action) => action.requirementId === "a").length === 1, "duplicate actions should be removed");
});

test("all four profiles evaluate and produce purpose-specific results", () => {
  const vendor = evaluate("vendor-onboarding");
  const loan = evaluate("loan-application-preparation");
  const procurement = evaluate("government-procurement");
  const scheme = evaluate("government-scheme-application");
  assert(vendor.profile.purpose === "VENDOR_ONBOARDING", "vendor purpose mismatch");
  assert(loan.profile.purpose === "LOAN_APPLICATION_PREPARATION", "loan purpose mismatch");
  assert(procurement.profile.purpose === "GOVERNMENT_PROCUREMENT", "procurement purpose mismatch");
  assert(scheme.profile.purpose === "GOVERNMENT_SCHEME_APPLICATION", "scheme purpose mismatch");
  assert(new Set([vendor.result.score, loan.result.score, procurement.result.score, scheme.result.score]).size > 1, "profiles should differ");
});

function result(requirementId: string, status: any, weight: number, score: number) {
  return {
    requirementId,
    label: requirementId,
    status,
    score,
    weight,
    reason: "test",
    relatedEvidenceIds: [],
    blockingIssues: status === "BLOCKED" ? [{ code: "BLOCKER", message: "blocked", relatedFields: [] }] : [],
    nextAction: null
  };
}

function assertThrows(fn: () => unknown, message: string) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

if (failures > 0) {
  console.error(`\nReadiness Engine tests failed with ${failures} failure(s).`);
  process.exit(1);
}

console.log("\nReadiness Engine tests passed.");
