// Report persistence adversarial tests against an isolated synthetic SQLite database.
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { ReportType, UserRole, type Prisma } from "@prisma/client";
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
const { persistReportAtomically, generateReport } = await import("../src/modules/reportComposer/report-composer.service.js");
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
function document(reportId: string, businessId: string): ReportDocument {
  return {
    reportId,
    reportType: ReportType.BUSINESS_TRUST_PROFILE,
    reportVersion: "1.0",
    generatedAt: new Date().toISOString(),
    expiresAt: null,
    revokedAt: null,
    business: { businessId, businessName: "Synthetic Textiles" },
    headline: { statusLabel: "EVIDENCE_BACKED_BUSINESS_TRUST_PROFILE", score: 80, level: null, summary: "Synthetic report." },
    trustMetrics: [],
    identityFields: [],
    requirements: [],
    evidence: [],
    contradictions: [],
    gaps: [],
    actions: [],
    timeline: [],
    limitations: [],
    disclaimer: "Synthetic test report.",
    provenance: { businessId, trustProfileId: "passport-test", readinessEvaluationId: null }
  };
}

const user = await prisma.user.create({
  data: { id: newCuid(), role: UserRole.MSME, name: "Synthetic Owner", organizationName: "Synthetic Textiles", email: `report-${runId}@example.test`, passwordHash: "not-a-login" }
});
const business = await prisma.business.create({ data: { id: newCuid(), userId: user.id, legalName: "Synthetic Textiles", gstin: `33TEST${String(Date.now()).slice(-8)}F1Z5` } });
const passport = await prisma.passport.create({ data: { id: newCuid(), businessId: business.id, version: 1, snapshotJson: { snapshotSchema: 2, businessId: business.id } as Prisma.InputJsonValue } });

async function persist(input: Partial<Parameters<typeof persistReportAtomically>[1]> = {}) {
  const reportId = input.reportId ?? newCuid();
  const snapshot = input.snapshot ?? document(reportId, business.id);
  return prisma.$transaction((tx) => persistReportAtomically(tx, {
    reportId,
    businessId: business.id,
    reportType: ReportType.BUSINESS_TRUST_PROFILE,
    reportVersion: "1.0",
    trustProfileId: passport.id,
    readinessEvaluationId: null,
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

await test("database insert failure leaves no new audit row", async () => {
  const reportId = newCuid();
  await persist({ reportId });
  const auditCount = await prisma.auditLog.count({ where: { action: "REPORT_GENERATED" } });
  await rejects(persist({ reportId }));
  assert(await prisma.auditLog.count({ where: { action: "REPORT_GENERATED" } }) === auditCount, "duplicate insert changed audit count");
});

await test("uncommitted report is invisible to concurrent readers", async () => {
  const reportId = newCuid();
  await prisma.$transaction(async (tx) => {
    await persistReportAtomically(tx, {
      reportId,
      businessId: business.id,
      reportType: ReportType.BUSINESS_TRUST_PROFILE,
      reportVersion: "1.0",
      trustProfileId: passport.id,
      readinessEvaluationId: null,
      snapshot: document(reportId, business.id),
      generatedAt: new Date(),
      createdByUserId: user.id
    });
    assert(await prisma.generatedReport.findUnique({ where: { id: reportId } }) === null, "concurrent reader observed uncommitted report");
  }, { maxWait: 15000, timeout: 30000 });
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
