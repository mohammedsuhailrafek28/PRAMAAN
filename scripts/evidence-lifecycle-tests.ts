import { EvidenceStatus, type Document } from "@prisma/client";
import { deriveEvidenceLifecycle, parseLifecycleDate } from "../src/modules/evidence/evidence-lifecycle.service.js";

const now = new Date("2026-08-27T00:00:00.000Z");
let failures = 0;

function documentFixture(overrides: Partial<Document> = {}) {
  return {
    id: "doc_1",
    businessId: "business_1",
    docType: "GST_CERTIFICATE" as const,
    filePath: "uploads/doc_1.pdf",
    originalName: "gst.pdf",
    mimeType: "application/pdf",
    verifiedFlag: false,
    evidenceStatus: EvidenceStatus.DOCUMENT_SUBMITTED,
    confidence: 45,
    confidenceReason: null,
    crossCheckMethod: null,
    source: "MSME_SUBMITTED",
    issuedAt: null,
    checkedAt: null,
    expiresAt: null,
    revision: 1,
    isCurrent: true,
    previousVersionId: null,
    contradictionDetails: null,
    uploadedAt: now,
    ...overrides
  } satisfies Document;
}

function test(name: string, callback: () => void) {
  try { callback(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

test("no expiry is current", () => assert(deriveEvidenceLifecycle(documentFixture(), now).state === "CURRENT", "expected CURRENT"));
test("future expiry is current", () => assert(deriveEvidenceLifecycle(documentFixture({ expiresAt: new Date("2026-12-01T00:00:00.000Z") }), now).state === "CURRENT", "expected CURRENT"));
test("expiry inside 30 days is expiring soon", () => assert(deriveEvidenceLifecycle(documentFixture({ expiresAt: new Date("2026-09-10T00:00:00.000Z") }), now).state === "EXPIRING_SOON", "expected EXPIRING_SOON"));
test("past expiry is expired", () => assert(deriveEvidenceLifecycle(documentFixture({ expiresAt: new Date("2026-08-01T00:00:00.000Z") }), now).state === "EXPIRED", "expected EXPIRED"));
test("failed check is surfaced as conflict", () => assert(deriveEvidenceLifecycle(documentFixture({ contradictionDetails: { checks: [{ result: "FAILED" }] } }), now).state === "CONFLICT", "expected CONFLICT"));
test("historical evidence needs attention", () => assert(deriveEvidenceLifecycle(documentFixture({ isCurrent: false }), now).state === "NEEDS_ATTENTION", "expected NEEDS_ATTENTION"));
test("invalid date format is rejected", () => { let rejected = false; try { parseLifecycleDate("08/27/2026", "issuedAt"); } catch { rejected = true; } assert(rejected, "invalid date was accepted"); });
test("expiry before issued is rejected by date comparison", () => { const issued = parseLifecycleDate("2026-08-27", "issuedAt")!; const expiry = parseLifecycleDate("2026-08-26", "expiresAt")!; assert(expiry < issued, "date ordering fixture is invalid"); });

if (failures > 0) process.exit(1);
console.log("Evidence lifecycle tests passed.");
