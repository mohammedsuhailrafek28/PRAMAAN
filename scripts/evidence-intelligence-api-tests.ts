// End-to-end API tests for the owner evidence review, against a real server and an isolated SQLite database.
import assert from "node:assert/strict";
import { execSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { PrismaClient } from "@prisma/client";
import { bankStatement, buildPdf, gstCertificate, makeGstin, udyamCertificate } from "./fixtures/synthetic-pdf.js";

const root = process.cwd();
const port = Number(process.env.EVIDENCE_INTELLIGENCE_PORT ?? 4311);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const databaseUrl = `file:./.tmp-evidence-intelligence/${runId}/ei.db`;
const dbDir = path.join(root, "prisma", ".tmp-evidence-intelligence", runId);
const uploadsDir = path.join(root, ".tmp-evidence-intelligence-uploads", runId);
const baseUrl = `http://127.0.0.1:${port}`;
const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
let server: ChildProcessWithoutNullStreams | undefined;

type Json = Record<string, any>;
const PAN = "ABCDE1234F";
const GSTIN = makeGstin("27", PAN);
const NAME = "Sunrise Textiles Private Limited";
const UDYAM = "UDYAM-MH-12-0001234";
const ACCOUNT = "123456789012";
const pass = (message: string) => console.log(`PASS ${message}`);

async function request(method: string, url: string, options: { token?: string; body?: unknown; form?: FormData; expected?: number[] } = {}) {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(options.body); }
  const response = await fetch(`${baseUrl}${url}`, { method, headers, body });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!(options.expected ?? [200, 201]).includes(response.status)) throw new Error(`${method} ${url} returned ${response.status}: ${text}`);
  return { status: response.status, data, text, headers: response.headers };
}

async function register(role: string, email: string, organizationName: string) {
  const result = await request("POST", "/api/auth/register", { body: { role, name: `${role} Evidence Test`, organizationName, email, password: "password123" } });
  return { token: result.data.token as string, user: result.data.user as Json };
}

async function upload(token: string, docType: string, bytes: Buffer, mime = "application/pdf", expected = [201]) {
  const form = new FormData();
  form.set("docType", docType);
  form.set("source", "MSME_SUBMITTED");
  form.set("file", new Blob([new Uint8Array(bytes)], { type: mime }), `${docType}.pdf`);
  return request("POST", "/api/business/documents", { token, form, expected });
}

const profile = (overrides: Json = {}) => ({ legalName: NAME, gstin: GSTIN, udyamNumber: UDYAM, pan: PAN, address: "Plot 4, Pune, Maharashtra", turnoverBand: "INR1Cr-INR5Cr", ...overrides });
const gstPdf = (overrides: Json = {}) => buildPdf(gstCertificate({ gstin: GSTIN, legalName: NAME, pan: PAN, ...overrides }), { compress: true });
const udyamPdf = (overrides: Json = {}) => buildPdf(udyamCertificate({ number: UDYAM, name: NAME, ...overrides }));
const bankPdf = (overrides: Json = {}) => buildPdf(bankStatement({ holder: NAME, account: ACCOUNT, ifsc: "HDFC0001234", ...overrides }));

/** Removes GSTIN occurrences (the GSTIN legitimately embeds the PAN and is shown to its owner) before scanning for raw PAN. */
const withoutGstin = (text: string) => text.split(GSTIN).join("[GSTIN]");
const assertNoSensitive = (text: string, label: string, allowGstin = false) => {
  const scanned = allowGstin ? withoutGstin(text) : text;
  assert(!scanned.includes(PAN), `${label}: raw PAN present`);
  assert(!scanned.includes(ACCOUNT), `${label}: raw account number present`);
  if (!allowGstin) assert(!text.includes(GSTIN), `${label}: GSTIN present`);
};

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Evidence intelligence test server did not become ready.");
}

async function cleanup() {
  if (server && !server.killed) {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 1500);
      server?.once("exit", () => { clearTimeout(timeout); resolve(); });
      server?.kill();
    });
  }
  for (const target of [dbDir, uploadsDir]) if (existsSync(target)) rmSync(target, { recursive: true, force: true, maxRetries: 5 });
}

async function main() {
  mkdirSync(dbDir, { recursive: true });
  execSync("npm run db:init", { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl, UPLOAD_DIR: uploadsDir }, stdio: "ignore" });
  server = spawn(process.execPath, [tsx, "src/server.ts"], { cwd: root, env: { ...process.env, PORT: String(port), DATABASE_URL: databaseUrl, UPLOAD_DIR: uploadsDir } });
  let serverLog = "";
  server.stdout.on("data", (chunk) => { serverLog += String(chunk); });
  server.stderr.on("data", (chunk) => { serverLog += String(chunk); });
  await waitForServer();
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

  // ---- fixtures: owner A (consistent), owner B (different business), buyer
  const a = await register("MSME", `ei-a-${runId}@example.test`, NAME);
  await request("POST", "/api/business", { token: a.token, body: profile() });
  await upload(a.token, "GST_CERTIFICATE", gstPdf());
  await upload(a.token, "UDYAM_CERTIFICATE", udyamPdf());
  await upload(a.token, "BANK_STATEMENT", bankPdf());
  const gstinB = makeGstin("29", "PQRST6789K");
  const b = await register("MSME", `ei-b-${runId}@example.test`, "Moonrise Traders Private Limited");
  await request("POST", "/api/business", { token: b.token, body: profile({ legalName: "Moonrise Traders Private Limited", gstin: gstinB, pan: "PQRST6789K", udyamNumber: "UDYAM-KA-01-0009999" }) });
  await upload(b.token, "GST_CERTIFICATE", buildPdf(gstCertificate({ gstin: gstinB, legalName: "Moonrise Traders Private Limited", pan: "PQRST6789K" })));
  const buyer = await register("BUYER", `ei-buyer-${runId}@example.test`, "Buyer Evidence Org");

  // ---- authentication and role
  await request("GET", "/api/evidence-intelligence/review", { expected: [401] });
  await request("GET", "/api/evidence-intelligence/review", { token: buyer.token, expected: [403] });
  await request("POST", "/api/evidence-intelligence/corrections", { token: buyer.token, body: { claim: "gstin", sourceDocumentId: null, source: "DOCUMENT_TEXT", confirm: true }, expected: [403] });
  pass("review and correction endpoints reject unauthenticated callers and requester roles");

  // ---- consistent profile
  const first = await request("GET", "/api/evidence-intelligence/review", { token: a.token });
  const review = first.data.review as Json;
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal(review.sourceVerificationPerformed, false);
  assert.equal(review.documents.length, 3);
  assert(review.documents.every((d: Json) => d.extractionStatus === "EXTRACTED"), "all three synthetic documents should be readable");
  for (const claim of ["legalName", "gstin", "pan", "udyamNumber"]) assert.equal(review.reconciliations.find((r: Json) => r.claim === claim).status, "MATCHED", claim);
  assert.deepEqual(review.plan.actions, []);
  assert(review.plan.unresolved.some((u: Json) => u.issueId === "GAP:bankAccount" && u.reason === "NOT_SUPPORTED_BY_DESIGN"));
  assert(/does not authenticate/i.test(review.limitations.join(" ")));
  assertNoSensitive(first.text, "owner review", true);
  assert(!/filePath|uploads[\\/]/.test(first.text), "stored file paths must not be exposed");
  pass("owner review shows extracted claims, MATCHED reconciliation, and masks PAN and account numbers");

  // ---- determinism
  const second = await request("GET", "/api/evidence-intelligence/review", { token: a.token });
  const strip = (value: Json) => JSON.stringify({ ...value.review, generatedAt: null });
  assert.equal(strip(second.data), strip(first.data));
  pass("re-evaluation of unchanged state is deterministic");

  // ---- tenant isolation
  const reviewB = (await request("GET", "/api/evidence-intelligence/review", { token: b.token })).data.review as Json;
  assert(reviewB.documents.every((d: Json) => !review.documents.some((x: Json) => x.documentId === d.documentId)));
  assert(!JSON.stringify(reviewB).includes(NAME) && !JSON.stringify(reviewB).includes(GSTIN));
  assert(!JSON.stringify(review).includes("Moonrise") && !JSON.stringify(review).includes(gstinB));
  await request("POST", "/api/evidence-intelligence/corrections", { token: b.token, body: { claim: "gstin", sourceDocumentId: review.documents[0].documentId, source: "DOCUMENT_TEXT", confirm: true }, expected: [409] });
  pass("owners only ever see their own documents; another owner's document id cannot drive a correction");

  // ---- conflict, proposal, strict confirmation
  const typo = GSTIN.slice(0, 2) + "XXXXX" + GSTIN.slice(7);
  await request("PATCH", "/api/business/me", { token: a.token, body: profile({ gstin: typo }) });
  await request("POST", "/api/passport/generate", { token: a.token }); // pinned snapshot that contains the mistyped claim
  const passportBefore = (await request("GET", "/api/passport/me", { token: a.token })).data.passport as Json;
  const conflicted = (await request("GET", "/api/evidence-intelligence/review", { token: a.token })).data.review as Json;
  assert.equal(conflicted.reconciliations.find((r: Json) => r.claim === "gstin").status, "CONFLICTED");
  assert.equal(conflicted.plan.actions.length, 1);
  const proposal = conflicted.plan.actions[0];
  assert.equal(proposal.type, "CORRECT_CLAIM");
  assert.equal(proposal.requiresOwnerConfirmation, true);
  assert.equal(proposal.resolution, "VERIFIED_BY_RULES");
  assert.equal(conflicted.plan.benchmark.plannedDocuments, 0);
  assert(!("proposedValue" in proposal), "the raw proposed value is not sent to the client");
  assert.equal((await request("GET", "/api/business/me", { token: a.token })).data.business.gstin, typo, "reviewing never overwrites the declaration");
  const body = { claim: proposal.claim, sourceDocumentId: proposal.sourceDocumentId, source: proposal.source };
  await request("POST", "/api/evidence-intelligence/corrections", { token: a.token, body, expected: [400] });
  await request("POST", "/api/evidence-intelligence/corrections", { token: a.token, body: { ...body, confirm: false }, expected: [400] });
  await request("POST", "/api/evidence-intelligence/corrections", { token: a.token, body: { ...body, confirm: true, value: "ATTACKER1234Z" }, expected: [400] });
  await request("POST", "/api/evidence-intelligence/corrections", { token: a.token, body: { ...body, claim: "pan", confirm: true }, expected: [409] });
  assert.equal((await request("GET", "/api/business/me", { token: a.token })).data.business.gstin, typo, "rejected requests change nothing");
  pass("a mismatch is shown, a single correction is proposed, and nothing changes without strict owner confirmation (client cannot supply values)");

  // ---- consent granted before the correction, to prove no consent or snapshot rewriting
  const consent = await request("POST", "/api/consent-requests", { token: buyer.token, body: { businessGstin: typo, requestedFields: ["legalBusinessName"], requestedEvidenceTypes: [], purpose: "Vendor Onboarding" } });
  const consentId = consent.data.consentRequestId as string;
  await request("PATCH", `/api/consent-requests/${consentId}/approve`, { token: a.token, body: { approvedFields: ["legalBusinessName"], approvedEvidenceTypes: [], durationDays: 2 } });
  const viewBefore = (await request("GET", `/api/trust-view/${consentId}`, { token: buyer.token })).text;
  const consentRowBefore = JSON.stringify(await prisma.consentRequest.findUnique({ where: { id: consentId } }));

  // ---- confirmed correction
  const corrected = (await request("POST", "/api/evidence-intelligence/corrections", { token: a.token, body: { ...body, confirm: true } })).data.review as Json;
  assert.equal((await request("GET", "/api/business/me", { token: a.token })).data.business.gstin, GSTIN);
  assert.equal(corrected.reconciliations.find((r: Json) => r.claim === "gstin").status, "MATCHED");
  assert.deepEqual(corrected.plan.actions, []);
  assert(corrected.plan.benchmark.issuesClosedByPlan === 0 && corrected.plan.unresolved.length === 1, "only the by-design gap remains");
  pass("confirmed correction applies the server-derived value and the review re-evaluates to MATCHED");

  // ---- snapshot / consent non-regression
  const passportAfter = (await request("GET", "/api/passport/me", { token: a.token })).data.passport as Json;
  assert.equal(passportAfter.id, passportBefore.id);
  assert.equal(passportAfter.version, passportBefore.version);
  assert.equal(JSON.stringify(passportAfter.snapshotJson), JSON.stringify(passportBefore.snapshotJson), "existing Passport snapshot is unchanged");
  const stored = await prisma.passport.findMany({ where: { business: { userId: a.user.id } } });
  assert.equal(stored.length, 1, "no new Passport was created by the review");
  assert.equal(JSON.stringify(await prisma.consentRequest.findUnique({ where: { id: consentId } })), consentRowBefore, "consent record is unchanged");
  assert.equal((await request("GET", `/api/trust-view/${consentId}`, { token: buyer.token })).text, viewBefore, "approved requester still sees the pinned snapshot");
  pass("existing Passport snapshots and consent grants are untouched by the review and the correction");

  // ---- audit and notifications carry no sensitive values
  const audit = await request("GET", "/api/audit-logs", { token: a.token });
  assert(audit.data.logs.some((log: Json) => log.metadata?.origin === "EVIDENCE_REVIEW_OWNER_CONFIRMED_CORRECTION"));
  assertNoSensitive(JSON.stringify(audit.data.logs.filter((log: Json) => log.metadata?.origin === "EVIDENCE_REVIEW_OWNER_CONFIRMED_CORRECTION")), "audit row");
  for (const token of [a.token, buyer.token]) assertNoSensitive((await request("GET", "/api/notifications", { token })).text, "notifications");
  assertNoSensitive(serverLog, "server log");
  pass("no raw PAN, account number or extracted value appears in audit rows, notifications or server logs");

  // ---- hostile uploads
  const bomb = Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 0 /Filter /FlateDecode >>\nstream\n`, "latin1"), deflateSync(Buffer.alloc(40 * 1024 * 1024)), Buffer.from("\nendstream\nendobj\n")]);
  await upload(a.token, "BANK_STATEMENT", bomb);
  let hostile = await request("GET", "/api/evidence-intelligence/review", { token: a.token });
  assert(hostile.data.review.documents.find((d: Json) => d.docType === "BANK_STATEMENT").extractionStatus === "REJECTED" || hostile.data.review.documents.find((d: Json) => d.docType === "BANK_STATEMENT").extractionStatus === "UNREADABLE", "decompression bomb is refused or unreadable, never read");
  assert(hostile.data.review.plan.actions.some((x: Json) => x.id === "SUBMIT:BANK_STATEMENT" && (x.reason === "REJECTED_FILE" || x.reason === "UNREADABLE")));
  await upload(a.token, "BANK_STATEMENT", Buffer.from("MZ\x90\x00 definitely not a pdf"));
  hostile = await request("GET", "/api/evidence-intelligence/review", { token: a.token });
  assert.equal(hostile.data.review.documents.find((d: Json) => d.docType === "BANK_STATEMENT").extractionStatus, "UNSUPPORTED");
  await upload(a.token, "BANK_STATEMENT", Buffer.alloc(6 * 1024 * 1024), "application/pdf", [400, 413, 500]);
  pass("decompression bombs, non-PDF bytes and oversized uploads are rejected safely and reported to the owner");

  // ---- stored-path confinement
  const victim = await prisma.document.findFirst({ where: { business: { userId: a.user.id }, docType: "UDYAM_CERTIFICATE", isCurrent: true } });
  await prisma.document.update({ where: { id: victim!.id }, data: { filePath: path.join(root, "package.json") } });
  const escaped = await request("GET", "/api/evidence-intelligence/review", { token: a.token });
  assert.equal(escaped.data.review.documents.find((d: Json) => d.docType === "UDYAM_CERTIFICATE").extractionStatus, "UNREADABLE");
  assert(!escaped.text.includes("pramaan") && !escaped.text.includes('"name"'), "content outside the upload directory is never read or returned");
  pass("a tampered stored path outside the upload directory is never read");

  // ---- replacement flow
  await upload(a.token, "BANK_STATEMENT", bankPdf());
  await upload(a.token, "UDYAM_CERTIFICATE", udyamPdf());
  const replaced = (await request("GET", "/api/evidence-intelligence/review", { token: a.token })).data.review as Json;
  assert(replaced.documents.every((d: Json) => d.extractionStatus === "EXTRACTED"));
  assert.deepEqual(replaced.plan.actions, []);
  pass("replacing unreadable/rejected documents re-evaluates cleanly");

  await prisma.$disconnect();
}

main()
  .then(async () => { await cleanup(); console.log("\nAll evidence-intelligence API tests passed"); })
  .catch(async (error) => { console.error(error); await cleanup(); process.exit(1); });
