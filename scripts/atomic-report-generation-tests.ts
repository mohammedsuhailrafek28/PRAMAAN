// Report persistence adversarial tests against an isolated synthetic SQLite database.
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { PrismaClient, ReportType, UserRole, type Prisma } from "@prisma/client";
import type { ReportDocument } from "../src/modules/reportComposer/report-composer.types.js";

const root = process.cwd();
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const dbDir = path.join(root, "prisma", ".tmp-report-atomic", runId);
const uploadDir = path.join(root, ".tmp-report-atomic-uploads", runId);
process.env.DATABASE_URL = `file:./.tmp-report-atomic/${runId}/test.db`;
process.env.UPLOAD_DIR = uploadDir;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "atomic-report-generation-test-secret-0123456789";

mkdirSync(dbDir, { recursive: true });
execSync("npm run db:init", { cwd: root, stdio: "ignore", env: process.env });

async function main() {
const { prisma } = await import("../src/config/prisma.js");
const { newCuid } = await import("../src/utils/id.js");
const { persistReportAtomically, generateReport, composeReportDocument } = await import("../src/modules/reportComposer/report-composer.service.js");
const { loadReportDataFromPassport } = await import("../src/modules/reportComposer/report-data-loader.js");
const { generate: generateTrustProfile } = await import("../src/modules/passport/passport.service.js");
const { getReportTemplate, listReportTypes } = await import("../src/modules/reportComposer/report-template.registry.js");
const { evaluateReadinessFromTrustProfile } = await import("../src/modules/readinessEngine/readiness-engine.service.js");
const { getReadinessProfile } = await import("../src/modules/readinessEngine/readiness-profile.registry.js");
const { validateReportDocument } = await import("../src/modules/reportComposer/report-composer.types.js");

let failures = 0;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function test(name: string, run: () => Promise<void>) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function rejects(run: Promise<unknown>) {
  try {
    await run;
  } catch {
    return;
  }
  throw new Error("expected operation to fail");
}
function document(reportId: string, businessId: string, passportId = "passport-test"): ReportDocument {
  return {
    reportId,
    reportType: ReportType.BUSINESS_TRUST_PROFILE,
    reportVersion: "1.0",
    generatedAt: new Date().toISOString(),
    expiresAt: null,
    revokedAt: null,
    business: { businessId, businessName: "Synthetic Textiles", ownerName: "Synthetic Owner", address: null, identifiers: { gstin: null, pan: null, udyamNumber: null } },
    headline: { statusLabel: "EVIDENCE_BACKED_BUSINESS_TRUST_PROFILE", score: 80, level: null, summary: "Synthetic report." },
    trustMetrics: [],
    identityFields: [],
    requirements: [],
    evidence: [{
      documentId: "doc-1",
      documentType: "GST_CERTIFICATE",
      fileName: null,
      submittedAt: "2026-10-18T00:00:00.000Z",
      evidenceStatus: "CROSS_CHECKED",
      confidence: 80,
      reason: "Synthetic check.",
      crossCheckMethod: "INTERNAL_METADATA_CHECK",
      checkedAt: "2026-10-18T00:00:00.000Z",
      expiresAt: null,
      checks: [],
      limitations: []
    }],
    contradictions: [],
    gaps: [],
    actions: [],
    timeline: [],
    limitations: [],
    disclaimer: "Synthetic test report.",
    provenance: {
      businessId,
      trustProfileId: passportId,
      trustProfileGeneratedAt: "2026-10-18T00:00:00.000Z",
      readinessEvaluationId: null,
      readinessProfileId: null,
      readinessProfileVersion: null,
      sourceVerificationPerformed: false
    }
  };
}

const user = await prisma.user.create({
  data: { id: newCuid(), role: UserRole.MSME, name: "Synthetic Owner", organizationName: "Synthetic Textiles", email: `report-${runId}@example.test`, passwordHash: "not-a-login" }
});
const business = await prisma.business.create({ data: { id: newCuid(), userId: user.id, legalName: "Synthetic Textiles", gstin: `33TEST${String(Date.now()).slice(-8)}F1Z5` } });
const passport = await prisma.passport.create({ data: { id: newCuid(), businessId: business.id, version: 1, snapshotJson: { snapshotSchema: 2, businessId: business.id } as Prisma.InputJsonValue } });

async function persist(input: Partial<Parameters<typeof persistReportAtomically>[1]> = {}) {
  const reportId = input.reportId ?? newCuid();
  const snapshot = input.snapshot ?? document(reportId, business.id, passport.id);
  return prisma.$transaction((tx) => persistReportAtomically(tx, {
    reportId,
    businessId: business.id,
    reportType: ReportType.BUSINESS_TRUST_PROFILE,
    reportVersion: "1.0",
    trustProfileId: passport.id,
    readinessEvaluationId: null,
      pinnedEvidenceIds: ["doc-1"],
    snapshot,
    generatedAt: new Date(),
    createdByUserId: input.createdByUserId ?? user.id
  }), { maxWait: 15000, timeout: 30000 });
}

await test("complete snapshot is validated before persistence", async () => {
  const reportId = newCuid();
  assert(validateReportDocument(document(reportId, business.id), { reportId, businessId: business.id }) === undefined, "valid snapshot rejected");
  await rejects(Promise.resolve().then(() => validateReportDocument({ ...document(reportId, business.id), headline: undefined } as never, { reportId, businessId: business.id })));
  assert(await prisma.generatedReport.count({ where: { id: reportId } }) === 0, "invalid snapshot created a row");
});

await test("sixteen malformed nested report shapes are rejected", async () => {
  const reportId = newCuid();
  const base = () => document(reportId, business.id, passport.id);
  const cases: Array<[string, (snapshot: any) => void]> = [
    ["missing report type", (s) => delete s.reportType],
    ["invalid generated timestamp", (s) => { s.generatedAt = "never"; }],
    ["business is scalar", (s) => { s.business = "wrong"; }],
    ["business identity mismatch", (s) => { s.business.businessId = "other-business"; }],
    ["provenance identity mismatch", (s) => { s.provenance.businessId = "other-business"; }],
    ["NaN headline score", (s) => { s.headline.score = Number.NaN; }],
    ["infinite metric score", (s) => { s.trustMetrics = [{ score: Number.POSITIVE_INFINITY }]; }],
    ["identity field is scalar", (s) => { s.identityFields = ["wrong"]; }],
    ["identity evidence escapes snapshot", (s) => { s.identityFields = [{ field: "gstin", label: "Gstin", evidenceStatus: "CROSS_CHECKED", confidence: 80, reason: "x", evidenceIds: ["ghost"], checks: [] }]; }],
    ["evidence is scalar", (s) => { s.evidence = "wrong"; }],
    ["evidence has no document id", (s) => { delete s.evidence[0].documentId; }],
    ["evidence has invalid document type", (s) => { s.evidence[0].documentType = "PAN_CARD"; }],
    ["evidence has invalid status", (s) => { s.evidence[0].evidenceStatus = "VERIFIED_BY_MAGIC"; }],
    ["evidence has non-finite confidence", (s) => { s.evidence[0].confidence = Number.POSITIVE_INFINITY; }],
    ["duplicate evidence reference", (s) => { s.evidence.push({ ...s.evidence[0] }); }],
    ["evidence limitation is non-string", (s) => { s.evidence[0].limitations = [7]; }]
  ];
  assert(cases.length === 16, "negative validator case count changed");
  for (const [name, mutate] of cases) {
    const snapshot = base();
    mutate(snapshot);
    await rejects(Promise.resolve().then(() => validateReportDocument(snapshot, {
      reportId,
      businessId: business.id,
      passportId: passport.id,
      pinnedEvidenceIds: ["doc-1"]
    })));
    assert(name.length > 0, "case name missing");
  }
});

await test("report and audit commit together", async () => {
  const report = await persist();
  const audit = (await prisma.auditLog.findMany({ where: { action: "REPORT_GENERATED" } })).find((item) => JSON.stringify(item.metadata).includes(report.id));
  assert(audit, "generated report audit missing");
  assert(JSON.stringify(report.snapshotJson) !== "{}", "complete report persisted as empty object");
});

await test("audit failure rolls back the report row", async () => {
  const reportId = newCuid();
  await rejects(persist({ reportId, createdByUserId: "missing-user" }));
  assert(await prisma.generatedReport.count({ where: { id: reportId } }) === 0, "report survived audit failure");
  assert(!(await prisma.auditLog.findMany({ where: { action: "REPORT_GENERATED" } })).some((item) => JSON.stringify(item.metadata).includes(reportId)), "orphaned audit survived audit failure");
});

await test("post-report-insert audit trigger rolls back both rows", async () => {
  const reportId = newCuid();
  await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_report_audit AFTER INSERT ON "GeneratedReport" BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END;`);
  await rejects(persist({ reportId }));
  await prisma.$executeRawUnsafe(`DROP TRIGGER fail_report_audit`);
  assert(await prisma.generatedReport.count({ where: { id: reportId } }) === 0, "report survived post-insert audit failure");
  assert(!(await prisma.auditLog.findMany({ where: { action: "REPORT_GENERATED" } })).some((item) => JSON.stringify(item.metadata).includes(reportId)), "audit survived post-insert failure");
});

await test("database insert failure leaves no new audit row", async () => {
  const reportId = newCuid();
  await persist({ reportId });
  const auditCount = await prisma.auditLog.count({ where: { action: "REPORT_GENERATED" } });
  await rejects(persist({ reportId }));
  assert(await prisma.auditLog.count({ where: { action: "REPORT_GENERATED" } }) === auditCount, "duplicate insert changed audit count");
});

await test("uncommitted report is invisible to concurrent readers", async () => {
  const reportId = newCuid();
  const reader = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  await prisma.$transaction(async (tx) => {
    await persistReportAtomically(tx, {
      reportId,
      businessId: business.id,
      reportType: ReportType.BUSINESS_TRUST_PROFILE,
      reportVersion: "1.0",
      trustProfileId: passport.id,
      readinessEvaluationId: null,
      pinnedEvidenceIds: ["doc-1"],
      snapshot: document(reportId, business.id, passport.id),
      generatedAt: new Date(),
      createdByUserId: user.id
    });
    assert(await reader.generatedReport.findUnique({ where: { id: reportId } }) === null, "independent reader observed uncommitted report");
  }, { maxWait: 15000, timeout: 30000 });
  assert(await reader.generatedReport.findUnique({ where: { id: reportId } }), "committed report missing after transaction");
  await reader.$disconnect();
});

await test("stale live document metadata cannot override the newer Passport snapshot", async () => {
  const initial = await prisma.document.create({
    data: {
      id: newCuid(),
      businessId: business.id,
      docType: "GST_CERTIFICATE",
      filePath: "synthetic-old.pdf",
      originalName: "old-revision.pdf",
      mimeType: "application/pdf",
      revision: 1,
      isCurrent: true,
      uploadedAt: new Date("2026-10-17T00:00:00.000Z")
    }
  });
  const initialBusiness = await prisma.business.findUnique({ where: { id: business.id }, include: { documents: true } });
  await prisma.document.update({ where: { id: initial.id }, data: { originalName: "new-revision.pdf", uploadedAt: new Date("2026-10-18T00:00:00.000Z") } });
  const generated = await generateTrustProfile(user.id);
  const trustProfile = generated.snapshotJson as any;
  const report = composeReportDocument({
    reportId: newCuid(),
    generatedAt: new Date(),
    revokedAt: null,
    expiresAt: null,
    business: initialBusiness,
    template: getReportTemplate(ReportType.BUSINESS_TRUST_PROFILE),
    passport: generated,
    trustProfile,
    readiness: null,
    readinessEvaluationId: null,
    auditLogs: []
  } as never);
  const evidence = report.evidence.find((item) => item.documentId === initial.id);
  assert(evidence, "generated Passport did not contain the synthetic evidence");
  assert(evidence.fileName === null, "report read live filename metadata");
  assert(evidence.submittedAt === trustProfile.evidence.find((item: any) => item.documentId === initial.id)?.uploadedAt, "report evidence date did not come from Passport snapshot");
});

await test("readiness reports stay pinned to Passport generation across document replacement", async () => {
  const pinnedUser = await prisma.user.create({
    data: { id: newCuid(), role: UserRole.MSME, name: "Pinned Owner", organizationName: "Pinned Textiles", email: `pinned-${runId}@example.test`, passwordHash: "not-a-login" }
  });
  const pinnedBusiness = await prisma.business.create({
    data: { id: newCuid(), userId: pinnedUser.id, legalName: "Pinned Textiles", gstin: `33PINNED${String(Date.now()).slice(-6)}F1Z5` }
  });
  const revisionOne = await prisma.document.create({
    data: {
      id: newCuid(), businessId: pinnedBusiness.id, docType: "GST_CERTIFICATE", filePath: "pinned-v1.pdf", originalName: "gst-v1.pdf", mimeType: "application/pdf",
      revision: 1, isCurrent: true, uploadedAt: new Date("2026-10-01T00:00:00.000Z"), expiresAt: new Date("2027-10-01T00:00:00.000Z")
    }
  });
  const passportV1 = await generateTrustProfile(pinnedUser.id);
  const snapshotV1 = passportV1.snapshotJson as any;
  assert(snapshotV1.version === 1, "expected Passport v1");
  assert(snapshotV1.evidence.some((item: any) => item.documentId === revisionOne.id && item.revision === 1), "Passport v1 did not pin revision 1");

  await prisma.document.update({ where: { id: revisionOne.id }, data: { isCurrent: false } });
  const revisionTwo = await prisma.document.create({
    data: {
      id: newCuid(), businessId: pinnedBusiness.id, docType: "GST_CERTIFICATE", filePath: "pinned-v2.pdf", originalName: "gst-v2-expired.pdf", mimeType: "application/pdf",
      revision: 2, isCurrent: true, previousVersionId: revisionOne.id, uploadedAt: new Date("2026-10-18T00:00:00.000Z"), expiresAt: new Date("2026-10-17T00:00:00.000Z")
    }
  });
  assert(revisionTwo.id !== revisionOne.id, "revision replacement did not create a new document");

  const reportUser = { id: pinnedUser.id, role: UserRole.MSME, email: pinnedUser.email };
  const vendorTemplate = getReportTemplate(ReportType.VENDOR_ONBOARDING_READINESS);
  const pinnedData = await loadReportDataFromPassport(reportUser, pinnedBusiness, vendorTemplate, passportV1);
  const pinnedReport = composeReportDocument({
    reportId: newCuid(), generatedAt: new Date(), revokedAt: null, expiresAt: null, ...pinnedData
  } as never);
  const reportEvidence = pinnedReport.evidence.find((item) => item.documentId === revisionOne.id);
  assert(reportEvidence, "report did not retain Passport v1 evidence");
  assert(!pinnedReport.evidence.some((item) => item.documentId === revisionTwo.id), "report read the replacement document");
  assert(pinnedReport.provenance.trustProfileGeneratedAt === passportV1.generatedAt.toISOString(), "report provenance changed Passport generation");
  assert(pinnedData.readiness?.trustProfileGeneratedAt === snapshotV1.generatedAt, "readiness did not use Passport v1 timestamp");
  const expectedPinnedReadiness = evaluateReadinessFromTrustProfile({
    definition: getReadinessProfile(vendorTemplate.readinessProfileId!),
    businessId: pinnedBusiness.id,
    trustProfile: snapshotV1,
    evaluatedAt: new Date(pinnedData.readiness!.evaluatedAt)
  });
  assert(JSON.stringify({
    result: pinnedData.readiness?.result,
    requirements: pinnedData.readiness?.requirements,
    blockingIssues: pinnedData.readiness?.blockingIssues,
    nextActions: pinnedData.readiness?.nextActions
  }) === JSON.stringify({
    result: expectedPinnedReadiness.result,
    requirements: expectedPinnedReadiness.requirements,
    blockingIssues: expectedPinnedReadiness.blockingIssues,
    nextActions: expectedPinnedReadiness.nextActions
  }), "pinned readiness decisions diverged from the pure evaluator");
  for (const item of listReportTypes().filter((entry) => entry.readinessProfileId)) {
    const template = getReportTemplate(item.reportType);
    const definition = getReadinessProfile(template.readinessProfileId!);
    const result = evaluateReadinessFromTrustProfile({ definition, businessId: pinnedBusiness.id, trustProfile: snapshotV1 });
    assert(result.businessId === pinnedBusiness.id && result.requirements.length > 0, `${item.reportType} did not evaluate pinned snapshot`);
  }
});

await test("concurrent API report generations leave only complete reports", async () => {
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => generateReport({ id: user.id, role: UserRole.MSME, email: user.email }, "BUSINESS_TRUST_PROFILE")));
  const successfulIds = results.flatMap((result) => result.status === "fulfilled" ? [result.value.report.reportId] : []);
  assert(successfulIds.length > 0, "all concurrent report generations failed");
  const rows = await prisma.generatedReport.findMany({ where: { id: { in: successfulIds } } });
  assert(rows.length === successfulIds.length, "successful report response has no persisted row");
  assert(rows.every((row) => {
    const snapshot = row.snapshotJson as Record<string, unknown>;
    return snapshot.reportId === row.id && snapshot.business && snapshot.headline && Array.isArray(snapshot.evidence);
  }), "concurrent generation persisted an incomplete snapshot");
  const generatedAudits = await prisma.auditLog.findMany({ where: { action: "REPORT_GENERATED" } });
  assert(successfulIds.every((id) => generatedAudits.some((audit) => JSON.stringify(audit.metadata).includes(id))), "successful report is missing its generated audit");
});

await prisma.$disconnect();
rmSync(path.join(root, "prisma", ".tmp-report-atomic", runId), { recursive: true, force: true });
rmSync(path.join(root, ".tmp-report-atomic-uploads", runId), { recursive: true, force: true });
if (failures > 0) process.exit(1);
console.log("\nAtomic report generation tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
