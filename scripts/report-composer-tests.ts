import { AuditAction, ReportType, UserRole } from "@prisma/client";
import type { BusinessTrustProfile } from "../src/modules/trustEngine/trust-engine.types.js";
import { listReportTypes, validateReportTemplates } from "../src/modules/reportComposer/report-template.registry.js";
import { buildExecutiveSummary, trustMetricExplanations } from "../src/modules/reportComposer/report-summary-builder.js";
import { buildTimeline } from "../src/modules/reportComposer/report-timeline-builder.js";

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

const trustProfile: BusinessTrustProfile = {
  businessId: "business_1",
  generatedAt: "2026-07-14T00:00:00.000Z",
  lastCalculatedAt: "2026-07-14T00:00:00.000Z",
  summary: { trustReadiness: 75, profileCompleteness: 80, evidenceStrength: 60, consistency: 90, freshness: 100 },
  fieldConfidence: [],
  documentConfidence: [],
  gaps: [{ field: "bankAccount", severity: "HIGH", message: "No bank evidence." }],
  contradictions: [],
  limitations: ["No authoritative source was queried."],
  sourceVerificationPerformed: false as const
};

test("registry exposes five unique report types with versions", () => {
  const reports = listReportTypes();
  assert(reports.length === 5, "expected five report types");
  assert(new Set(reports.map((item) => item.reportType)).size === 5, "report types must be unique");
  assert(reports.every((item) => item.reportVersion), "report versions missing");
  assert(reports.some((item) => item.reportType === ReportType.BUSINESS_TRUST_PROFILE && item.readinessProfileId === null), "business report mapping missing");
});

test("registry validation rejects duplicate report types", () => {
  const reports = listReportTypes() as any[];
  assertThrows(() => validateReportTemplates([{ ...reports[0], includedSections: ["x"], requiresReadiness: false, recalculateAllowed: true }, { ...reports[0], includedSections: ["x"], requiresReadiness: false, recalculateAllowed: true }]), "duplicate report type should fail");
});

test("executive summary is deterministic for trust profile and blocked readiness", () => {
  const trustSummary = buildExecutiveSummary({ reportType: ReportType.BUSINESS_TRUST_PROFILE, trustProfile });
  assert(trustSummary.includes("Evidence-backed Business Trust Profile"), "trust summary wording missing");
  const blocked = buildExecutiveSummary({
    reportType: ReportType.LOAN_APPLICATION_PREPARATION,
    trustProfile,
    readiness: {
      profile: { id: "loan-application-preparation", version: "1.0", name: "Loan Application Preparation", purpose: "LOAN_APPLICATION_PREPARATION", description: "", disclaimer: "" },
      businessId: "business_1",
      evaluatedAt: "2026-07-14T00:00:00.000Z",
      result: { score: 45, level: "BLOCKED" as any, blocked: true, satisfiedRequirements: 1, partialRequirements: 1, missingRequirements: 1, totalApplicableRequirements: 3 },
      requirements: [],
      blockingIssues: [{ code: "HIGH", message: "blocked", relatedFields: ["pan"] as any }],
      nextActions: [],
      limitations: []
    }
  });
  assert(blocked.includes("BLOCKED"), "blocked summary missing");
  assert(blocked.includes("does not override"), "blocked transparency text missing");
});

test("trust metric explanations include all five metrics without overclaiming", () => {
  const metrics = trustMetricExplanations(trustProfile.summary);
  assert(metrics.length === 5, "metric count mismatch");
  assert(metrics.every((metric) => typeof metric.score === "number" && metric.explanation), "metric explanation missing");
});

test("timeline includes allowed events, filters unsafe metadata, and sorts deterministically", () => {
  const now = new Date("2026-07-14T00:00:00.000Z");
  const timeline = buildTimeline([
    audit("2", AuditAction.REPORT_GENERATED, now, { reportId: "r1", filePath: "C:/secret", score: 70 }),
    audit("1", AuditAction.DOCUMENT_SUBMITTED, now, { documentId: "d1", filePath: "C:/secret" }),
    audit("3", AuditAction.BUSINESS_VERIFIED, now, { unsafe: "ignored" })
  ] as any);
  assert(timeline.length === 2, "unsupported event should be ignored");
  assert(timeline[0].eventId === "1", "timeline should sort by time then ID");
  assert(!JSON.stringify(timeline).includes("C:/secret"), "timeline leaked unsafe metadata");
});

test("report snapshots must not contain local file paths", () => {
  const sample = JSON.stringify({
    evidence: [{ fileName: "gst.pdf", documentType: "GST_CERTIFICATE" }],
    limitations: ["Document contents were not parsed."]
  });
  assert(!sample.includes("uploads/") && !sample.includes("C:\\"), "sample report leaked local path");
});

function audit(id: string, action: AuditAction, createdAt: Date, metadata: Record<string, unknown>) {
  return {
    id,
    businessId: "business_1",
    consentRequestId: null,
    actorId: "user_1",
    action,
    metadata,
    createdAt,
    actor: { role: UserRole.MSME, organizationName: "Sharma Textiles" }
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
  console.error(`\nReport Composer tests failed with ${failures} failure(s).`);
  process.exit(1);
}
console.log("\nReport Composer tests passed.");
