// End-to-end API tests for scanned-document review: real server, isolated SQLite database, real Python worker, scanned PDFs
// from the synthetic evaluation corpus. Exits 2 (not "pass") when the worker's Python dependencies are missing.
import assert from "node:assert/strict";
import { execFileSync, execSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { makeGstin } from "./fixtures/synthetic-pdf.js";
import { workerAvailable } from "../src/modules/evidenceIntelligence/worker-client.js";

const root = process.cwd();
const port = Number(process.env.EVIDENCE_OCR_PORT ?? 4312);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const databaseUrl = `file:./.tmp-evidence-ocr/${runId}/ei.db`;
const dbDir = path.join(root, "prisma", ".tmp-evidence-ocr", runId);
const uploadsDir = path.join(root, ".tmp-evidence-ocr-uploads", runId);
const baseUrl = `http://127.0.0.1:${port}`;
const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
let server: ChildProcessWithoutNullStreams | undefined;
let corpus = "";

type Json = Record<string, any>;
const pass = (message: string) => console.log(`PASS ${message}`);

async function rawRequest(method: string, url: string, options: { token?: string; body?: unknown; form?: FormData; expected?: number[] } = {}) {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(options.body); }
  const response = await fetch(`${baseUrl}${url}`, { method, headers, body });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!(options.expected ?? [200, 201]).includes(response.status)) throw new Error(`${method} ${url} returned ${response.status}: ${text}`);
  return { status: response.status, data, text };
}

type RequestOptions = { token?: string; body?: unknown; form?: FormData; expected?: number[] };
/** Reviews are produced by jobs: start one and poll it, returning the same shape GET /review used to return. */
async function request(method: string, url: string, options: RequestOptions = {}) {
  if (method !== "GET" || url !== "/api/evidence-intelligence/review" || !options.token) return rawRequest(method, url, options);
  const started = await rawRequest("POST", "/api/evidence-intelligence/jobs", { token: options.token, expected: [202, 401, 403, 404] });
  if (started.status !== 202) return started;
  const jobId = started.data.job.id as string;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const polled = await rawRequest("GET", `/api/evidence-intelligence/jobs/${jobId}`, { token: options.token });
    const status = polled.data.job.status as string;
    if (status === "SUCCEEDED") return { ...polled, data: { review: polled.data.review, job: polled.data.job, resultState: polled.data.resultState } };
    if (status === "FAILED" || status === "CANCELLED") throw new Error(`review job ${status}: ${polled.text}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("review job did not finish in time");
}
const register = async (role: string, email: string, organizationName: string) => {
  const result = await request("POST", "/api/auth/register", { body: { role, name: `${role} OCR Test`, organizationName, email, password: "password123" } });
  return { token: result.data.token as string };
};
async function upload(token: string, docType: string, bytes: Buffer) {
  const form = new FormData();
  form.set("docType", docType);
  form.set("source", "MSME_SUBMITTED");
  form.set("file", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), `${docType}.pdf`);
  return request("POST", "/api/business/documents", { token, form, expected: [201] });
}
async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("OCR test server did not become ready.");
}
async function cleanup() {
  if (server && !server.killed) {
    await new Promise<void>((resolve) => { const timeout = setTimeout(resolve, 1500); server?.once("exit", () => { clearTimeout(timeout); resolve(); }); server?.kill(); });
  }
  for (const target of [dbDir, uploadsDir, corpus]) if (target && existsSync(target)) rmSync(target, { recursive: true, force: true, maxRetries: 5 });
}

async function main() {
  if (!(await workerAvailable())) { console.error("SKIPPED (not passed): Python worker dependencies are not installed."); process.exit(2); }
  corpus = mkdtempSync(path.join(os.tmpdir(), "pramaan-ocr-api-corpus-"));
  execFileSync(process.platform === "win32" ? "python" : "python3", ["-m", "evidence_eval.generate_corpus", "--out", corpus, "--quick"], { cwd: path.join(root, "python"), stdio: "ignore", timeout: 240_000 });
  const cases = (JSON.parse(readFileSync(path.join(corpus, "manifest.json"), "utf8")) as { cases: Json[] }).cases;
  const gstScan = cases.find((item) => item.docType === "GST_CERTIFICATE" && item.variant === "scan300") as Json;
  const udyamScan = cases.find((item) => item.docType === "UDYAM_CERTIFICATE" && item.variant === "scan300") as Json;
  const bankMixed = cases.find((item) => item.docType === "BANK_STATEMENT" && item.variant === "text_then_scanned_pages") as Json;
  const read = (item: Json) => readFileSync(path.join(corpus, item.file));

  mkdirSync(dbDir, { recursive: true });
  execSync("npm run db:init", { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl, UPLOAD_DIR: uploadsDir }, stdio: "ignore" });
  server = spawn(process.execPath, [tsx, "src/server.ts"], { cwd: root, env: { ...process.env, PORT: String(port), DATABASE_URL: databaseUrl, UPLOAD_DIR: uploadsDir } });
  let serverLog = "";
  server.stdout.on("data", (chunk) => { serverLog += String(chunk); });
  server.stderr.on("data", (chunk) => { serverLog += String(chunk); });
  await waitForServer();
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

  const entity = gstScan.entity as Json;
  const profile = (overrides: Json = {}) => ({ legalName: entity.legalName, gstin: entity.gstin, udyamNumber: udyamScan.entity.udyamNumber, pan: entity.pan, address: "Plot 4, Pune, Maharashtra", turnoverBand: "INR1Cr-INR5Cr", ...overrides });

  // ---- owner A: scanned GST certificate that agrees with the declaration
  const a = await register("MSME", `ocr-a-${runId}@example.test`, entity.legalName);
  await request("POST", "/api/business", { token: a.token, body: profile() });
  await upload(a.token, "GST_CERTIFICATE", read(gstScan));
  const started = Date.now();
  const first = (await request("GET", "/api/evidence-intelligence/review", { token: a.token })).data.review as Json;
  const reviewMs = Date.now() - started;
  const gst = first.documents.find((d: Json) => d.docType === "GST_CERTIFICATE");
  assert.equal(gst.engine, "HYBRID");
  assert.ok(gst.ocrPages >= 1, "scanned page was OCR'd");
  const gstinField = gst.fields.find((f: Json) => f.field === "gstin");
  assert.equal(gstinField.method, "OCR");
  assert.equal(gstinField.needsReview, true, "an identifier read from a scan asks the owner to check it");
  assert.ok(gstinField.reviewReasons.includes("OCR_IDENTIFIER"));
  assert.equal(first.reconciliations.find((r: Json) => r.claim === "gstin").status, "MATCHED");
  assert.equal(first.reconciliations.find((r: Json) => r.claim === "legalName").status, "MATCHED");
  assert.ok(first.plan.actions.every((x: Json) => x.type === "SUBMIT_DOCUMENT" && x.reason === "MISSING"), "agreement proposes no correction; only the not-yet-uploaded documents are requested");
  // The corpus gives each document its own fictional entity, so the other document types are reviewed under their own owners.
  const bankEntity = bankMixed.entity as Json;
  const d = await register("MSME", `ocr-d-${runId}@example.test`, bankEntity.legalName);
  await request("POST", "/api/business", { token: d.token, body: profile({ legalName: bankEntity.legalName, gstin: bankEntity.gstin, pan: bankEntity.pan, udyamNumber: bankEntity.udyamNumber }) });
  await upload(d.token, "BANK_STATEMENT", read(bankMixed));
  const bankReview = (await request("GET", "/api/evidence-intelligence/review", { token: d.token })).data.review as Json;
  const bank = bankReview.documents.find((x: Json) => x.docType === "BANK_STATEMENT");
  assert.ok(bank.table && bank.table.rowCount === bankMixed.truth.rows.length && bank.table.reliable, "mixed text+scan statement table recovered");
  assert.ok(bank.table.preview.length <= 8 && bank.table.preview.every((row: Json) => row.description.length <= 80));
  const accountField = bank.fields.find((f: Json) => f.field === "accountNumber");
  assert.match(accountField.displayValue, /^[X*]+\d{4}$/);
  const udyamEntity = udyamScan.entity as Json;
  const e = await register("MSME", `ocr-e-${runId}@example.test`, udyamEntity.legalName);
  await request("POST", "/api/business", { token: e.token, body: profile({ legalName: udyamEntity.legalName, gstin: udyamEntity.gstin, pan: udyamEntity.pan, udyamNumber: udyamEntity.udyamNumber }) });
  await upload(e.token, "UDYAM_CERTIFICATE", read(udyamScan));
  const udyamReview = (await request("GET", "/api/evidence-intelligence/review", { token: e.token })).data.review as Json;
  assert.equal(udyamReview.reconciliations.find((r: Json) => r.claim === "udyamNumber").status, "MATCHED");
  assert.equal(udyamReview.reconciliations.find((r: Json) => r.claim === "legalName").status, "MATCHED");
  pass(`scanned GST/Udyam and a mixed text+scan bank statement are read end to end through the API (review took ${Math.round(reviewMs / 1000)} s)`);

  // ---- a second review is served from the bounded cache (no second OCR run)
  const t1 = Date.now();
  await request("GET", "/api/evidence-intelligence/review", { token: a.token });
  assert.ok(Date.now() - t1 < reviewMs * 0.6 || Date.now() - t1 < 3000, "second review reuses the cached structured result");
  pass("an unchanged document is not OCR'd again within the cache window");

  // ---- owner B declares a DIFFERENT valid GSTIN than the scanned certificate shows: uncertain reading, never a conflict or a correction
  const otherGstin = makeGstin("27", "ABCDE1234F");
  const b = await register("MSME", `ocr-b-${runId}@example.test`, entity.legalName);
  await request("POST", "/api/business", { token: b.token, body: profile({ gstin: otherGstin, pan: "ABCDE1234F" }) });
  await upload(b.token, "GST_CERTIFICATE", read(gstScan));
  const mismatch = (await request("GET", "/api/evidence-intelligence/review", { token: b.token })).data.review as Json;
  const gstinRec = mismatch.reconciliations.find((r: Json) => r.claim === "gstin");
  assert.equal(gstinRec.status, "UNREADABLE");
  assert.equal(gstinRec.needsOwnerReview, true);
  assert.ok(gstinRec.comparisons.some((c: Json) => c.outcome === "UNCERTAIN" && c.method === "OCR"));
  assert.ok(!mismatch.plan.actions.some((x: Json) => x.type === "CORRECT_CLAIM" && x.claim === "gstin"), "no correction is proposed from a scanned reading");
  assert.ok(mismatch.plan.unresolved.some((u: Json) => u.issueId === "REVIEW:gstin" && u.reason === "READING_UNCERTAIN"));
  await request("POST", "/api/evidence-intelligence/corrections", { token: b.token, body: { claim: "gstin", sourceDocumentId: gst.documentId, source: "DOCUMENT_TEXT", confirm: true }, expected: [409] });
  const stored = await prisma.business.findFirst({ where: { gstin: otherGstin } });
  assert.ok(stored, "the declared GSTIN is untouched");
  pass("a scanned value that differs from the declaration asks the owner to check; it is not a conflict and cannot be applied as a correction");

  // ---- tenant isolation and privacy
  const c = await register("MSME", `ocr-c-${runId}@example.test`, "Other Owner Pvt Ltd");
  await request("POST", "/api/business", { token: c.token, body: profile({ legalName: "Other Owner Pvt Ltd", gstin: makeGstin("29", "PQRST6789K"), pan: "PQRST6789K", udyamNumber: "UDYAM-KA-01-0009999" }) });
  const own = (await request("GET", "/api/evidence-intelligence/review", { token: c.token })).data.review as Json;
  assert.equal(own.documents.length, 0, "an owner never sees another owner's documents or readings");
  // A GSTIN legitimately contains the PAN in positions 3-12 (the owner's own GSTIN is shown to the owner), so GSTINs are removed first.
  const everything = (JSON.stringify(first) + JSON.stringify(mismatch)).split(entity.gstin).join("[GSTIN]").split(otherGstin).join("[GSTIN]");
  assert.ok(!everything.includes(entity.pan), "no raw PAN in the review");
  assert.ok(!/\b\d{9,}\b/.test(JSON.stringify(bank.table.preview)), "no long digit runs in the statement preview");
  assert.ok(!serverLog.includes(entity.pan) && !serverLog.includes(entity.gstin), "server log has no PAN/GSTIN");
  const audit = await request("GET", "/api/audit-logs", { token: a.token });
  assert.ok(!JSON.stringify(audit.data).includes(entity.pan));
  pass("extracted values stay with the owning MSME; PAN, account numbers and GSTIN do not reach logs, audit rows or other tenants");

  await prisma.$disconnect();
}

main()
  .then(async () => { await cleanup(); console.log("\nAll scanned-document API tests passed"); })
  .catch(async (error) => { console.error(error); await cleanup(); process.exit(1); });
