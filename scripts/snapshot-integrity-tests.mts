// Snapshot immutability (F2) and atomic snapshot creation (F4).
// Runs in-process against an isolated, synthetic SQLite database created from the real migrations.
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const dbDir = path.join(root, "prisma", ".tmp-snapshot", runId);
process.env.DATABASE_URL = `file:./.tmp-snapshot/${runId}/test.db`;
process.env.UPLOAD_DIR = path.join(root, ".tmp-snapshot-uploads", runId);
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "snapshot-integrity-test-secret-0123456789";

mkdirSync(dbDir, { recursive: true });
execSync("npm run db:init", { cwd: root, stdio: "ignore", env: process.env });

const { prisma } = await import("../src/config/prisma.js");
const authService = await import("../src/modules/auth/auth.service.js");
const businessService = await import("../src/modules/business/business.service.js");
const passportService = await import("../src/modules/passport/passport.service.js");
const consentService = await import("../src/modules/consent/consent.service.js");
const trustViewService = await import("../src/modules/trustView/trustView.service.js");
const accessGrantService = await import("../src/modules/accessGrant/accessGrant.service.js");
const { deriveEvidenceLifecycle } = await import("../src/modules/evidence/evidence-lifecycle.service.js");
const { readPinnedEvidence } = await import("../src/modules/evidence/pinned-evidence.js");
const { SnapshotConstructionError, buildEvidenceRecords, validateSnapshot } = await import("../src/modules/passport/passport-snapshot.js");

let failures = 0;
const results: string[] = [];
async function test(name: string, run: () => Promise<void>) {
  try { await run(); results.push(`PASS ${name}`); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); }
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function canon(value: unknown): string {
  const sort = (input: unknown): unknown => Array.isArray(input) ? input.map(sort)
    : input && typeof input === "object" ? Object.fromEntries(Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sort(item)]))
    : input;
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value))));
}
async function rejectsWith(promise: Promise<unknown>, code: string) {
  try { await promise; } catch (error) { assert((error as { code?: string }).code === code, `expected ${code}, got ${(error as { code?: string }).code ?? error}`); return; }
  throw new Error(`expected ${code} but the call succeeded`);
}

const file = (name: string) => ({ path: `uploads/${name}`, originalname: `${name}.pdf`, mimetype: "application/pdf" }) as Express.Multer.File;
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
let counter = 0;
/** Passports these tests deliberately rewrite to legacy/empty shapes to exercise backward compatibility. */
const deliberatelyRewritten = new Set<string>();

async function makeMsme(options: { gstExpiresInDays?: number } = {}) {
  counter += 1;
  const registered = await authService.register({ role: "MSME", name: `Owner ${counter}`, organizationName: `Sharma Textiles ${counter}`, email: `msme${counter}-${runId}@example.test`, password: "password123" });
  const user = { id: registered.user.id, role: "MSME" as const, email: registered.user.email };
  const gstin = `33ABCDE${String(1000 + counter)}F1Z5`;
  await businessService.upsertProfile(user.id, { legalName: `Sharma Textiles ${counter}`, gstin, udyamNumber: `UDYAM-TN-33-${String(1000000 + counter)}`, pan: "ABCDE1234F", address: "12 Weavers Lane, Erode", turnoverBand: "₹1.5 Cr – ₹5 Cr" } as never);
  await businessService.uploadDocument(user.id, "GST_CERTIFICATE", file(`gst${counter}`), { issuedAt: day(-100), expiresAt: day(options.gstExpiresInDays ?? 400), source: "GST portal download" });
  await businessService.uploadDocument(user.id, "UDYAM_CERTIFICATE", file(`udyam${counter}`), { issuedAt: day(-100), expiresAt: day(500) });
  await businessService.uploadDocument(user.id, "BANK_STATEMENT", file(`bank${counter}`), { issuedAt: day(-30), expiresAt: day(300) });
  await businessService.crossCheck(user);
  const business = await prisma.business.findUniqueOrThrow({ where: { userId: user.id } });
  return { user, business, gstin };
}

async function makeBuyer(suffix: string) {
  counter += 1;
  const registered = await authService.register({ role: "BUYER", name: `Buyer ${suffix}`, organizationName: `Acme ${suffix}`, email: `buyer${counter}-${runId}@example.test`, password: "password123" });
  return { id: registered.user.id, role: "BUYER" as const, email: registered.user.email };
}

async function approvedConsent(msme: Awaited<ReturnType<typeof makeMsme>>, buyer: Awaited<ReturnType<typeof makeBuyer>>, fields: string[], evidence: string[]) {
  const created = await consentService.create(buyer, { businessGstin: msme.gstin, requestedFields: fields, requestedEvidenceTypes: evidence, purpose: "Vendor Onboarding" });
  await consentService.approve(msme.user.id, created.id, { approvedFields: fields, approvedEvidenceTypes: evidence, durationDays: 7 });
  return created.id;
}

async function guestToken(msme: Awaited<ReturnType<typeof makeMsme>>, fields: string[], evidence: string[]) {
  const grant: any = await accessGrantService.create(msme.user, { purpose: "Vendor onboarding", scope: { fields, evidenceTypes: evidence }, durationHours: 24 });
  return { id: grant.id as string, token: String(grant.secureUrl).split("/").pop() as string };
}

const passports = (businessId: string) => prisma.passport.findMany({ where: { businessId }, orderBy: { version: "asc" } });
const generatedAudits = (businessId: string) => prisma.auditLog.count({ where: { businessId, action: "TRUST_PROFILE_GENERATED" } });
const FIELDS = ["legalBusinessName", "gstin", "summary"];
const EVIDENCE = ["GST_CERTIFICATE", "UDYAM_CERTIFICATE"];

try {
  await test("F2: pinned disclosure is byte-identical after a later cross-check and mutated document rows", async () => {
    const msme = await makeMsme({ gstExpiresInDays: 90 });
    const buyer = await makeBuyer("a");
    await passportService.generate(msme.user.id);
    const consentId = await approvedConsent(msme, buyer, FIELDS, EVIDENCE);
    const guest = await guestToken(msme, FIELDS, EVIDENCE);
    const before = canon(await trustViewService.getTrustView(buyer.id, consentId));
    const guestBefore = canon(await accessGrantService.resolveGuest(guest.token));

    await businessService.crossCheck(msme.user);
    await prisma.document.updateMany({ where: { businessId: msme.business.id }, data: { evidenceStatus: "REJECTED", confidence: 1, checkedAt: new Date(), crossCheckMethod: "TAMPERED", contradictionDetails: [{ result: "FAILED", severity: "CRITICAL" }] } });
    await prisma.business.update({ where: { id: msme.business.id }, data: { legalName: "Renamed After Approval", gstin: `29ZZZZZ9999Z1Z1`, trustStatus: "REJECTED" } });

    assert(canon(await trustViewService.getTrustView(buyer.id, consentId)) === before, "registered Trust View changed after cross-check / row mutation");
    assert(canon(await accessGrantService.resolveGuest(guest.token)) === guestBefore, "guest view changed after cross-check / row mutation");
    const view: any = JSON.parse(before);
    assert(view.sharedFields.legalBusinessName.value.startsWith("Sharma Textiles"), "pinned legal name was not the approved value");
    assert(JSON.parse(guestBefore).business.legalName.startsWith("Sharma Textiles"), "guest identity was read from the live business row");
  });

  await test("F2: pinned disclosure survives document replacement; a new snapshot discloses the new revision", async () => {
    const msme = await makeMsme();
    const buyer = await makeBuyer("b");
    await passportService.generate(msme.user.id);
    const oldConsent = await approvedConsent(msme, buyer, FIELDS, EVIDENCE);
    const guest = await guestToken(msme, FIELDS, EVIDENCE);
    const oldView = canon(await trustViewService.getTrustView(buyer.id, oldConsent));
    const oldGuest = canon(await accessGrantService.resolveGuest(guest.token));
    const oldGst = (JSON.parse(oldView) as any).evidence.find((item: any) => item.docType === "GST_CERTIFICATE");

    await businessService.uploadDocument(msme.user.id, "GST_CERTIFICATE", file("gst-replacement"), { issuedAt: day(-5), expiresAt: day(900), source: "Replacement" });
    await businessService.crossCheck(msme.user);
    assert(canon(await trustViewService.getTrustView(buyer.id, oldConsent)) === oldView, "replacement changed an approved Trust View");
    assert(canon(await accessGrantService.resolveGuest(guest.token)) === oldGuest, "replacement changed a pinned guest link");

    await passportService.generate(msme.user.id);
    const newConsent = await approvedConsent(msme, buyer, FIELDS, EVIDENCE);
    const newGst = ((await trustViewService.getTrustView(buyer.id, newConsent)) as any).evidence.find((item: any) => item.docType === "GST_CERTIFICATE");
    assert(newGst.source === "Replacement" && newGst.expiresAt !== oldGst.expiresAt, "new snapshot did not disclose the new revision");
    assert(canon(await trustViewService.getTrustView(buyer.id, oldConsent)) === oldView, "old consent changed after a newer snapshot existed");
  });

  await test("F2: historical lifecycle is as of the assessment, separate from the live lifecycle", async () => {
    const msme = await makeMsme({ gstExpiresInDays: 10 });
    const buyer = await makeBuyer("c");
    await passportService.generate(msme.user.id);
    const consentId = await approvedConsent(msme, buyer, ["gstin"], ["GST_CERTIFICATE"]);
    const before: any = await trustViewService.getTrustView(buyer.id, consentId);
    assert(before.evidence[0].lifecycle.state === "EXPIRING_SOON", `expected EXPIRING_SOON at assessment, got ${before.evidence[0].lifecycle.state}`);

    await prisma.document.updateMany({ where: { businessId: msme.business.id, docType: "GST_CERTIFICATE" }, data: { expiresAt: new Date(Date.now() - 86400000) } });
    await businessService.crossCheck(msme.user);
    const live = await prisma.document.findFirstOrThrow({ where: { businessId: msme.business.id, docType: "GST_CERTIFICATE" } });
    assert(deriveEvidenceLifecycle(live).state === "EXPIRED" && live.evidenceStatus === "EXPIRED", "the live row did not expire (test precondition)");

    const after: any = await trustViewService.getTrustView(buyer.id, consentId);
    assert(canon(after) === canon(before), "evidence expiry rewrote the approved disclosure");
    assert(after.evidence[0].lifecycle.state === "EXPIRING_SOON" && after.evidence[0].expiresAt === before.evidence[0].expiresAt, "historical state was replaced by the current state");
  });

  await test("F2: lifecycle is evaluated at the snapshot time, not the read time (long-ago snapshot)", async () => {
    const record = (expiresAt: string | null, checks: unknown[]) => ({ documentId: "d1", docType: "GST_CERTIFICATE", revision: 1, evidenceStatus: "CROSS_CHECKED", confidence: 45, crossCheckMethod: "INTERNAL_METADATA_CHECK", source: "x", issuedAt: "2019-06-01T00:00:00.000Z", checkedAt: "2020-01-01T00:00:00.000Z", expiresAt, uploadedAt: "2019-06-02T00:00:00.000Z", checks });
    const snapshot = (evidence: unknown[]) => ({ snapshotSchema: 2, lastCalculatedAt: "2020-01-01T00:00:00.000Z", generatedAt: "2020-01-01T00:00:01.000Z", evidence });
    const soon = readPinnedEvidence(snapshot([record("2020-01-20T00:00:00.000Z", [{ type: "EXPIRY", result: "PASSED" }])]), ["GST_CERTIFICATE"]).evidence[0];
    assert(soon.lifecycle.state === "EXPIRING_SOON" && soon.lifecycle.freshnessState === "EXPIRING_SOON", `historical state should be EXPIRING_SOON, got ${soon.lifecycle.state}`);
    assert(deriveEvidenceLifecycle({ expiresAt: new Date("2020-01-20T00:00:00.000Z"), isCurrent: true, evidenceStatus: "CROSS_CHECKED", contradictionDetails: null } as never).state === "EXPIRED", "precondition: read-time lifecycle would be EXPIRED");
    const current = readPinnedEvidence(snapshot([record("2021-01-01T00:00:00.000Z", [{ type: "EXPIRY", result: "PASSED" }])]), ["GST_CERTIFICATE"]).evidence[0];
    assert(current.lifecycle.state === "CURRENT", `historical state should be CURRENT, got ${current.lifecycle.state}`);
    const expired = readPinnedEvidence(snapshot([record("2019-12-01T00:00:00.000Z", [{ type: "EXPIRY", result: "FAILED" }])]), ["GST_CERTIFICATE"]).evidence[0];
    assert(expired.lifecycle.state === "EXPIRED", `historical state should be EXPIRED, got ${expired.lifecycle.state}`);
  });

  await test("F2: guest link and registered Trust View agree for the same snapshot and scope", async () => {
    const msme = await makeMsme();
    const buyer = await makeBuyer("d");
    await passportService.generate(msme.user.id);
    const consentId = await approvedConsent(msme, buyer, FIELDS, EVIDENCE);
    const guest = await guestToken(msme, FIELDS, EVIDENCE);
    const registered: any = await trustViewService.getTrustView(buyer.id, consentId);
    const guestView: any = await accessGrantService.resolveGuest(guest.token);
    assert(canon(registered.evidence) === canon(guestView.evidence), "evidence differs between registered and guest views");
    assert(canon(registered.sharedFields) === canon(guestView.sharedFields), "fields differ between registered and guest views");
    assert(registered.metadata.evidenceBasis === "SNAPSHOT" && guestView.grant.evidenceBasis === "SNAPSHOT", "evidence basis not reported");
  });

  await test("F2: approved scope excludes undisclosed evidence and live document metadata", async () => {
    const msme = await makeMsme();
    const buyer = await makeBuyer("e");
    await passportService.generate(msme.user.id);
    const consentId = await approvedConsent(msme, buyer, ["gstin"], ["GST_CERTIFICATE"]);
    const guest = await guestToken(msme, ["gstin"], ["GST_CERTIFICATE"]);
    for (const view of [await trustViewService.getTrustView(buyer.id, consentId), await accessGrantService.resolveGuest(guest.token)] as any[]) {
      assert(view.evidence.length === 1 && view.evidence[0].docType === "GST_CERTIFICATE", "evidence scope not respected");
      assert(Object.keys(view.sharedFields).join() === "gstin", "field scope not respected");
      const text = JSON.stringify(view);
      for (const forbidden of ["BANK_STATEMENT", "UDYAM_CERTIFICATE", "originalName", "mimeType", "filePath", "uploads/", ".pdf", "documentId", "\"revision\"", "\"checks\"", "contradictionDetails", msme.business.id]) {
        if (forbidden === msme.business.id && "businessId" in view) continue; // Trust View already returns its own business id
        assert(!text.includes(forbidden), `pinned share leaked ${forbidden}`);
      }
    }
  });

  await test("F2: revocation and expiry are still enforced", async () => {
    const msme = await makeMsme();
    const buyer = await makeBuyer("f");
    await passportService.generate(msme.user.id);
    const revoked = await approvedConsent(msme, buyer, FIELDS, EVIDENCE);
    const expired = await approvedConsent(msme, buyer, FIELDS, EVIDENCE);
    await consentService.revoke(msme.user.id, revoked);
    await rejectsWith(trustViewService.getTrustView(buyer.id, revoked), "CONSENT_REVOKED");
    await prisma.consentRequest.update({ where: { id: expired }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await rejectsWith(trustViewService.getTrustView(buyer.id, expired), "CONSENT_EXPIRED");
    const other = await makeBuyer("f2");
    const live = await approvedConsent(msme, buyer, FIELDS, EVIDENCE);
    await rejectsWith(trustViewService.getTrustView(other.id, live), "FORBIDDEN");

    const grantA = await guestToken(msme, FIELDS, EVIDENCE);
    const grantB = await guestToken(msme, FIELDS, EVIDENCE);
    await accessGrantService.revoke(msme.user.id, grantA.id);
    await rejectsWith(accessGrantService.resolveGuest(grantA.token), "ACCESS_REVOKED");
    await prisma.accessGrant.update({ where: { id: grantB.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await rejectsWith(accessGrantService.resolveGuest(grantB.token), "ACCESS_EXPIRED");
    await rejectsWith(accessGrantService.resolveGuest("x".repeat(43)), "INVALID_ACCESS_LINK");
  });

  await test("F2: legacy and malformed snapshots degrade conservatively and never read live rows", async () => {
    const msme = await makeMsme({ gstExpiresInDays: 90 });
    const buyer = await makeBuyer("g");
    const passport = await passportService.generate(msme.user.id);
    const consentId = await approvedConsent(msme, buyer, ["gstin"], ["GST_CERTIFICATE", "UDYAM_CERTIFICATE"]);
    const guest = await guestToken(msme, ["gstin"], ["GST_CERTIFICATE", "UDYAM_CERTIFICATE"]);

    // Rewrite to the pre-fix shape: no snapshotSchema, no embedded evidence.
    const legacy = { ...(passport.snapshotJson as Record<string, unknown>) };
    delete legacy.snapshotSchema; delete legacy.evidence;
    deliberatelyRewritten.add(passport.id);
    await prisma.passport.update({ where: { id: passport.id }, data: { snapshotJson: legacy as never } });
    await prisma.document.updateMany({ where: { businessId: msme.business.id }, data: { evidenceStatus: "REJECTED", confidence: 0, issuedAt: new Date("2001-01-01") } });

    const view: any = await trustViewService.getTrustView(buyer.id, consentId);
    const guestView: any = await accessGrantService.resolveGuest(guest.token);
    assert(view.metadata.evidenceBasis === "LEGACY_SNAPSHOT" && guestView.grant.evidenceBasis === "LEGACY_SNAPSHOT", "legacy basis not reported");
    assert(canon(view.evidence) === canon(guestView.evidence), "legacy registered and guest evidence differ");
    for (const item of view.evidence) {
      assert(item.evidenceStatus !== "REJECTED" && item.confidence > 0, "legacy evidence picked up live row state");
      assert(item.issuedAt === null && item.expiresAt === null && item.uploadedAt === null && item.source === null, "legacy evidence filled gaps from live rows");
      assert(item.crossCheckMethod === "INTERNAL_METADATA_CHECK" && item.checkedAt, "legacy assessment metadata missing");
    }

    // An empty legacy snapshot and assorted garbage must not throw and must not fall back to live rows.
    for (const garbage of [{}, null, [], "text", 7, { documentConfidence: "nope" }, { documentConfidence: [null, 3, { documentType: "GST_CERTIFICATE", status: "X", confidence: "high" }] }, { snapshotSchema: 2, evidence: "bad" }, { snapshotSchema: 2, evidence: [{ docType: "GST_CERTIFICATE" }] }]) {
      const read = readPinnedEvidence(garbage, ["GST_CERTIFICATE"]);
      assert(read.evidence.length === 0, `garbage snapshot ${JSON.stringify(garbage)} produced evidence`);
    }
    await prisma.passport.update({ where: { id: passport.id }, data: { snapshotJson: {} } });
    const empty: any = await trustViewService.getTrustView(buyer.id, consentId);
    assert(empty.evidence.length === 0 && Object.keys(empty.sharedFields).length === 0, "empty legacy snapshot produced data");
  });

  await test("F2: a legacy snapshot's recorded expiry check yields an EXPIRED historical lifecycle", async () => {
    const msme = await makeMsme({ gstExpiresInDays: 90 });
    const buyer = await makeBuyer("h");
    await prisma.document.updateMany({ where: { businessId: msme.business.id, docType: "GST_CERTIFICATE" }, data: { expiresAt: new Date(Date.now() - 86400000) } });
    const passport = await passportService.generate(msme.user.id);
    const legacy = { ...(passport.snapshotJson as Record<string, unknown>) };
    delete legacy.snapshotSchema; delete legacy.evidence;
    deliberatelyRewritten.add(passport.id);
    await prisma.passport.update({ where: { id: passport.id }, data: { snapshotJson: legacy as never } });
    const consentId = await approvedConsent(msme, buyer, ["gstin"], ["GST_CERTIFICATE"]);
    const view: any = await trustViewService.getTrustView(buyer.id, consentId);
    assert(view.evidence[0].lifecycle.state === "EXPIRED" && view.evidence[0].evidenceStatus === "EXPIRED", "legacy expired evidence not reported as expired");
  });

  await test("F4: validateSnapshot and buildEvidenceRecords reject incomplete or inconsistent snapshots", async () => {
    const msme = await makeMsme();
    const passport = await passportService.generate(msme.user.id);
    const good = passport.snapshotJson as Record<string, any>;
    const expected = { profileId: passport.id, businessId: msme.business.id, version: passport.version };
    validateSnapshot(good, expected);
    const clone = () => JSON.parse(JSON.stringify(good));
    const bad: [string, unknown][] = [
      ["empty object", {}], ["null", null], ["array", []],
      ["wrong profile id", { ...clone(), profileId: "other" }], ["wrong version", { ...clone(), version: 99 }],
      ["missing summary metric", { ...clone(), summary: { trustReadiness: 1 } }], ["NaN", { ...clone(), summary: { ...good.summary, freshness: NaN } }],
      ["undefined member", { ...clone(), gaps: undefined }], ["no evidence array", (() => { const s = clone(); delete s.evidence; return s; })()],
      ["evidence disagrees", (() => { const s = clone(); s.evidence[0].confidence = 99; return s; })()],
      ["duplicate evidence", (() => { const s = clone(); s.evidence.push(s.evidence[0]); return s; })()],
      ["bad date", (() => { const s = clone(); s.evidence[0].uploadedAt = "never"; return s; })()],
      ["wrong schema", { ...clone(), snapshotSchema: 1 }]
    ];
    for (const [name, snapshot] of bad) {
      let rejected = false;
      try { validateSnapshot(snapshot, expected); } catch (error) { rejected = error instanceof SnapshotConstructionError; }
      assert(rejected, `validator accepted: ${name}`);
    }
    let missing = false;
    try { buildEvidenceRecords([], { documentConfidence: [{ documentId: "ghost" }] } as never); } catch (error) { missing = error instanceof SnapshotConstructionError; }
    assert(missing, "buildEvidenceRecords accepted an assessment with no document");
  });

  await test("F4: a snapshot-construction failure leaves no passport, no audit row and no partial writes", async () => {
    const msme = await makeMsme();
    await passportService.generate(msme.user.id);
    const baseline = { passports: (await passports(msme.business.id)).length, audits: await generatedAudits(msme.business.id) };
    const businessBefore = await prisma.business.findUniqueOrThrow({ where: { id: msme.business.id } });
    const docsBefore = canon(await prisma.document.findMany({ where: { businessId: msme.business.id }, orderBy: { id: "asc" } }));

    // Corrupt data the engine cannot read: an evidence row with a document type outside the enum.
    await prisma.$executeRawUnsafe(`INSERT INTO "Document" ("id","businessId","docType","filePath","originalName","mimeType") VALUES ('bogus_doc','${msme.business.id}','NOT_A_TYPE','x','x','application/pdf')`);
    let failed = false;
    try { await passportService.generate(msme.user.id); } catch { failed = true; }
    assert(failed, "generation unexpectedly succeeded with an unreadable document");
    await prisma.$executeRawUnsafe(`DELETE FROM "Document" WHERE "id"='bogus_doc'`);

    assert((await passports(msme.business.id)).length === baseline.passports, "a passport row was left behind");
    assert(await generatedAudits(msme.business.id) === baseline.audits, "an audit row refers to a failed snapshot");
    const businessAfter = await prisma.business.findUniqueOrThrow({ where: { id: msme.business.id } });
    assert(canon(businessAfter) === canon(businessBefore), "failed generation left partial business writes");
    assert(canon(await prisma.document.findMany({ where: { businessId: msme.business.id }, orderBy: { id: "asc" } })) === docsBefore, "failed generation left partial document writes");
    const next = await passportService.generate(msme.user.id);
    assert(next.version === baseline.passports + 1, "versions are no longer contiguous after a failure");
  });

  await test("F4: a database persistence failure rolls everything back (passport insert, then audit insert)", async () => {
    const msme = await makeMsme();
    await passportService.generate(msme.user.id);
    const baseline = { passports: (await passports(msme.business.id)).length, audits: await generatedAudits(msme.business.id) };
    const businessBefore = canon(await prisma.business.findUniqueOrThrow({ where: { id: msme.business.id } }));

    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_passport_insert BEFORE INSERT ON "Passport" BEGIN SELECT RAISE(ABORT, 'injected passport failure'); END`);
    try {
      let failed = false;
      try { await passportService.generate(msme.user.id); } catch { failed = true; }
      assert(failed, "generation survived an injected passport-insert failure");
    } finally { await prisma.$executeRawUnsafe(`DROP TRIGGER fail_passport_insert`); }
    assert((await passports(msme.business.id)).length === baseline.passports && await generatedAudits(msme.business.id) === baseline.audits, "rows left behind after passport-insert failure");
    assert(canon(await prisma.business.findUniqueOrThrow({ where: { id: msme.business.id } })) === businessBefore, "business was written despite a failed generation");

    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_audit_insert BEFORE INSERT ON "AuditLog" WHEN NEW."action" = 'TRUST_PROFILE_GENERATED' BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END`);
    try {
      let failed = false;
      try { await passportService.generate(msme.user.id); } catch { failed = true; }
      assert(failed, "generation survived an injected audit-insert failure");
    } finally { await prisma.$executeRawUnsafe(`DROP TRIGGER fail_audit_insert`); }
    assert((await passports(msme.business.id)).length === baseline.passports, "passport survived a failed audit write (not atomic)");
    assert(await generatedAudits(msme.business.id) === baseline.audits, "audit row left behind");
    const ok = await passportService.generate(msme.user.id);
    assert(ok.version === baseline.passports + 1 && await generatedAudits(msme.business.id) === baseline.audits + 1, "recovery after failures did not produce exactly one passport and one audit row");
  });

  await test("F4: preconditions still return the original errors without side effects", async () => {
    counter += 1;
    const registered = await authService.register({ role: "MSME", name: "Empty", organizationName: "Empty Co", email: `empty${counter}-${runId}@example.test`, password: "password123" });
    await prisma.business.update({ where: { userId: registered.user.id }, data: { legalName: null } });
    await rejectsWith(passportService.generate(registered.user.id), "INSUFFICIENT_BUSINESS_DATA");
    const buyer = await makeBuyer("nobiz");
    await rejectsWith(passportService.generate(buyer.id), "NOT_FOUND");
    const business = await prisma.business.findUniqueOrThrow({ where: { userId: registered.user.id } });
    assert((await passports(business.id)).length === 0, "a passport was created for an ineligible business");
  });

  await test("F4: concurrent generation yields unique contiguous versions, complete snapshots and one audit row each", async () => {
    const msme = await makeMsme();
    const seenIncomplete: string[] = [];
    let polling = true;
    const poller = (async () => {
      while (polling) {
        for (const row of await prisma.passport.findMany({ where: { businessId: msme.business.id } })) {
          const snapshot = row.snapshotJson as Record<string, unknown> | null;
          if (!snapshot || Object.keys(snapshot).length === 0 || snapshot.profileId !== row.id || snapshot.snapshotSchema !== 2) seenIncomplete.push(row.id);
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();

    const settled = await Promise.allSettled(Array.from({ length: 8 }, () => passportService.generate(msme.user.id)));
    polling = false; await poller;

    const fulfilled = settled.filter((item) => item.status === "fulfilled");
    const rejected = settled.filter((item): item is PromiseRejectedResult => item.status === "rejected");
    assert(rejected.length === 0, `concurrent generations failed: ${rejected.map((item) => String(item.reason)).join(" | ")}`);
    const rows = await passports(msme.business.id);
    assert(rows.length === fulfilled.length, "row count differs from successful generations");
    assert(rows.every((row, index) => row.version === index + 1), `versions are not contiguous: ${rows.map((row) => row.version).join(",")}`);
    assert(rows.every((row) => (row.snapshotJson as any).version === row.version && (row.snapshotJson as any).profileId === row.id), "snapshot identity does not match its row");
    assert(await generatedAudits(msme.business.id) === rows.length, "audit rows do not match passports one-to-one");
    assert(seenIncomplete.length === 0, `an incomplete snapshot was observable: ${seenIncomplete.join(",")}`);
  });

  await test("F4: pinning, versioning and return shape are preserved", async () => {
    const msme = await makeMsme();
    const buyer = await makeBuyer("pin");
    const v1 = await passportService.generate(msme.user.id);
    const v2 = await passportService.generate(msme.user.id);
    assert(v1.version === 1 && v2.version === 2 && v1.id !== v2.id && /^c[0-9a-z]{24}$/.test(v2.id), "id/version shape changed");
    assert(Object.keys(v2.snapshotJson as object).length > 10 && v2.businessId === msme.business.id, "returned passport is incomplete");
    const consentId = await approvedConsent(msme, buyer, ["gstin"], []);
    const consent = await prisma.consentRequest.findUniqueOrThrow({ where: { id: consentId } });
    assert(consent.approvedPassportId === v2.id, "consent did not pin the latest passport");
    assert(((await passportService.getMine(msme.user.id)) as any).id === v2.id, "getMine does not return the latest passport");
  });

  await test("global: no generated Passport row has an empty or incomplete snapshot", async () => {
    const rows = await prisma.passport.findMany();
    assert(rows.length > 10, "expected many passports from the tests above");
    const bad = rows.filter((row) => !deliberatelyRewritten.has(row.id) && (!row.snapshotJson || Object.keys(row.snapshotJson as object).length === 0 || (row.snapshotJson as any).profileId !== row.id || (row.snapshotJson as any).snapshotSchema !== 2));
    assert(bad.length === 0, `incomplete snapshots: ${bad.map((row) => row.id).join(",")}`);
  });
} finally {
  await prisma.$disconnect();
  rmSync(dbDir, { recursive: true, force: true });
  rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true });
}

console.log(`\n${results.length} passed, ${failures} failed.`);
if (failures > 0) process.exit(1);
console.log("Snapshot integrity tests passed.");
