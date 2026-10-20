// End-to-end tests for asynchronous evidence-review jobs: long-running work and polling, de-duplication, reuse of cached
// results, ownership, stale document revisions, queue capacity, cancellation, worker failure, server restart and sensitive
// output. Runs a real server against an isolated SQLite database, with a SLOW stand-in worker so jobs stay running long
// enough to observe (it sleeps, then runs the real worker; "crash" makes it fail).
import assert from "node:assert/strict";
import { execSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { bankStatement, buildPdf, gstCertificate, makeGstin, udyamCertificate } from "./fixtures/synthetic-pdf.js";

const root = process.cwd();
const port = Number(process.env.EVIDENCE_JOBS_PORT ?? 4312);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const databaseUrl = `file:./.tmp-evidence-jobs/${runId}/jobs.db`;
const dbDir = path.join(root, "prisma", ".tmp-evidence-jobs", runId);
const uploadsDir = path.join(root, ".tmp-evidence-jobs-uploads", runId);
const fakeWorkerDir = path.join(root, ".tmp-evidence-jobs-worker", runId);
const baseUrl = `http://127.0.0.1:${port}`;
const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const realPython = path.join(root, "python");
let server: ChildProcessWithoutNullStreams | undefined;
let serverLog = "";

type Json = Record<string, any>;
const pass = (message: string) => console.log(`PASS ${message}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const PAN = "ABCDE1234F";
const GSTIN = makeGstin("27", PAN);
const ACCOUNT = "123456789012";
const UDYAM = "UDYAM-MH-12-0001234";
const NAME = "Sunrise Textiles Private Limited";

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
  return { status: response.status, data, text };
}

let counter = 0;
async function newOwner(documents: Array<"GST" | "UDYAM" | "BANK"> = ["GST"]) {
  counter += 1;
  const pan = `ABCDE${String(1000 + counter)}F`;
  const gstin = makeGstin("27", pan);
  const name = `Job Test Traders ${counter} Private Limited`;
  const registered = await request("POST", "/api/auth/register", { body: { role: "MSME", name: `Owner ${counter}`, organizationName: name, email: `jobs-${counter}-${runId}@example.test`, password: "password123" } });
  const token = registered.data.token as string;
  await request("POST", "/api/business", { token, body: { legalName: name, gstin, udyamNumber: `UDYAM-MH-12-${String(2000 + counter).padStart(7, "0")}`, pan, address: "Plot 4, Pune, Maharashtra", turnoverBand: "INR1Cr-INR5Cr" } });
  const owner = { token, gstin, pan, name };
  for (const kind of documents) await uploadDoc(owner, kind);
  return owner;
}
type Owner = Awaited<ReturnType<typeof newOwner>>;

async function uploadDoc(owner: Owner, kind: "GST" | "UDYAM" | "BANK") {
  const form = new FormData();
  const docType = { GST: "GST_CERTIFICATE", UDYAM: "UDYAM_CERTIFICATE", BANK: "BANK_STATEMENT" }[kind];
  const bytes = kind === "GST" ? buildPdf(gstCertificate({ gstin: owner.gstin, legalName: owner.name, pan: owner.pan }))
    : kind === "UDYAM" ? buildPdf(udyamCertificate({ number: UDYAM, name: owner.name }))
      : buildPdf(bankStatement({ holder: owner.name, account: ACCOUNT, ifsc: "HDFC0001234" }));
  form.set("docType", docType);
  form.set("source", "MSME_SUBMITTED");
  form.set("file", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), `${docType}.pdf`);
  // Distinct bytes per upload so a "new revision" is not collapsed into the previous one.
  return request("POST", "/api/business/documents", { token: owner.token, form });
}

const startJob = (owner: Owner, expected = [202]) => request("POST", "/api/evidence-intelligence/jobs", { token: owner.token, expected });
const getJob = (owner: { token: string }, id: string, expected = [200]) => request("GET", `/api/evidence-intelligence/jobs/${id}`, { token: owner.token, expected });
async function waitFor(owner: { token: string }, id: string, done: (job: Json) => boolean, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const polled = await getJob(owner, id);
    if (done(polled.data.job)) return polled;
    if (Date.now() > until) throw new Error(`job ${id} did not reach the expected state: ${polled.text}`);
    await sleep(300);
  }
}
const finished = (job: Json) => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.status);

/** A stand-in for evidence_worker.worker that waits (delay.txt seconds) or crashes (mode.txt) and then runs the real worker. */
function installFakeWorker() {
  mkdirSync(path.join(fakeWorkerDir, "evidence_worker"), { recursive: true });
  writeFileSync(path.join(fakeWorkerDir, "evidence_worker", "__init__.py"), "");
  writeFileSync(path.join(fakeWorkerDir, "evidence_worker", "worker.py"), [
    "import os, sys, time",
    "here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))",
    "def read(name, default):",
    "    try: return open(os.path.join(here, name)).read().strip()",
    "    except OSError: return default",
    "if read('mode.txt', 'ok') == 'crash': sys.exit(3)",
    "time.sleep(float(read('delay.txt', '0')))",
    "for name in [m for m in sys.modules if m == 'evidence_worker' or m.startswith('evidence_worker.')]: del sys.modules[name]",
    `sys.path[:] = [p for p in sys.path if os.path.abspath(p or '.') != here]`,
    `sys.path.insert(0, ${JSON.stringify(realPython)})`,
    "import runpy",
    "runpy.run_module('evidence_worker.worker', run_name='__main__', alter_sys=True)"
  ].join("\n"));
}
const setDelay = (seconds: number) => writeFileSync(path.join(fakeWorkerDir, "delay.txt"), String(seconds));
const setMode = (mode: "ok" | "crash") => writeFileSync(path.join(fakeWorkerDir, "mode.txt"), mode);

function startServer() {
  server = spawn(process.execPath, [tsx, "src/server.ts"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATABASE_URL: databaseUrl, UPLOAD_DIR: uploadsDir, EVIDENCE_WORKER_MODE: "local", EVIDENCE_WORKER_DIR: fakeWorkerDir, EVIDENCE_REVIEW_QUEUE_MAX: "4", EVIDENCE_REVIEW_CONCURRENCY: "2" }
  });
  server.stdout.on("data", (chunk) => { serverLog += String(chunk); });
  server.stderr.on("data", (chunk) => { serverLog += String(chunk); });
}
async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch { /* starting */ }
    await sleep(250);
  }
  throw new Error("Jobs test server did not become ready.");
}
async function stopServer(signal: NodeJS.Signals = "SIGTERM") {
  if (!server || server.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    server?.once("exit", () => { clearTimeout(timeout); resolve(); });
    server?.kill(signal);
  });
}
async function cleanup() {
  await stopServer();
  for (const target of [dbDir, uploadsDir, fakeWorkerDir]) if (existsSync(target)) rmSync(target, { recursive: true, force: true, maxRetries: 5 });
}
const extractTempDirs = () => readdirSync(os.tmpdir()).filter((name) => name.startsWith("pramaan-extract-")).length;

async function main() {
  mkdirSync(dbDir, { recursive: true });
  installFakeWorker();
  setDelay(0);
  setMode("ok");
  execSync("npm run db:init", { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl, UPLOAD_DIR: uploadsDir }, stdio: "ignore" });
  startServer();
  await waitForServer();
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const tmpBefore = extractTempDirs();

  // ---- the migration created the table and the one-active-job-per-business index
  const indexes = await prisma.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='EvidenceReviewJob'");
  assert(indexes.some((index) => /one_active_per_business/i.test(index.name)), "partial unique index exists");
  pass("migration creates EvidenceReviewJob with the one-active-job-per-business index");

  // ---- access control
  const buyer = await request("POST", "/api/auth/register", { body: { role: "BUYER", name: "Buyer", organizationName: "Buyer Org", email: `jobs-buyer-${runId}@example.test`, password: "password123" } });
  await request("POST", "/api/evidence-intelligence/jobs", { expected: [401] });
  await request("POST", "/api/evidence-intelligence/jobs", { token: buyer.data.token, expected: [403] });
  await request("GET", "/api/evidence-intelligence/jobs/anything", { token: buyer.data.token, expected: [403] });
  pass("jobs require an MSME owner (401 anonymous, 403 requester)");

  // ---- a long-running job: id returned at once, progress visible while polling, review delivered at the end
  setDelay(3);
  const alpha = await newOwner(["GST", "UDYAM", "BANK"]);
  const snapshotTables = async () => JSON.stringify({
    passports: await prisma.passport.findMany(), consents: await prisma.consentRequest.findMany(), grants: await prisma.accessGrant.findMany(),
    business: await prisma.business.findMany({ orderBy: { id: "asc" } }), audit: await prisma.auditLog.count(), notifications: await prisma.notification.count(),
    readiness: await prisma.readinessEvaluation.count(), reports: await prisma.generatedReport.count()
  });
  const before = await snapshotTables();
  const startedAt = Date.now();
  const started = await startJob(alpha);
  assert(Date.now() - startedAt < 2500, "the start request returns promptly even though reading takes longer");
  assert(["QUEUED", "RUNNING"].includes(started.data.job.status));
  assert.equal(started.data.job.docsTotal, 3);
  assert.equal(started.data.review, undefined, "no review before the job has finished");
  const alphaJob = started.data.job.id as string;
  const seenSteps = new Set<string>();
  const seenDone = new Set<number>();
  const result = await waitFor(alpha, alphaJob, (job) => { if (job.currentStep) seenSteps.add(job.currentStep); seenDone.add(job.docsDone); return finished(job); });
  assert.equal(result.data.job.status, "SUCCEEDED");
  assert.equal(result.data.resultState, "READY");
  assert.equal(result.data.review.documents.length, 3);
  assert(seenSteps.size >= 2 && [...seenSteps].every((step) => /^READING:[A-Z_]+$/.test(step)), `progress steps observed: ${[...seenSteps].join(",")}`);
  assert(seenDone.size >= 2, "documents-done advanced while polling");
  assert.equal(result.data.job.docsDone, 3);
  assert.equal(result.data.job.degraded, false);
  assert.equal(result.data.job.isolation, "LOCAL_PROCESS");
  pass("a long job returns an id at once, shows per-document progress while polling, then delivers the review");

  // ---- jobs do not alter consent, Passport, trust or audit/notification state
  assert.equal(await snapshotTables(), before);
  pass("a finished job leaves consent, Passport, business/trust fields, audit rows and notifications untouched");

  // ---- unchanged revisions are reused: an immediate SUCCEEDED job, no worker run
  setDelay(30);
  const reused = Date.now();
  const again = await startJob(alpha);
  assert.equal(again.data.job.status, "SUCCEEDED");
  assert.equal(again.data.reused, "CACHED_RESULTS");
  assert(Date.now() - reused < 3000, "answered from cache without reading documents");
  const fromCache = await getJob(alpha, again.data.job.id);
  assert.equal(fromCache.data.resultState, "READY");
  pass("unchanged document revisions are not re-read: a repeat start succeeds immediately from cache");

  // ---- ownership
  const mallory = await newOwner(["GST"]);
  await getJob(mallory, alphaJob, [404]);
  await request("POST", `/api/evidence-intelligence/jobs/${alphaJob}/cancel`, { token: mallory.token, expected: [404] });
  await getJob(mallory, "does-not-exist", [404]);
  const stillThere = await getJob(alpha, alphaJob);
  assert.equal(stillThere.data.job.status, "SUCCEEDED");
  pass("another tenant gets 404 (same as a missing job) for status and cancel, and the job is unaffected");

  // ---- de-duplication: starting twice joins the single active job
  setDelay(6);
  const beta = await newOwner(["GST"]);
  const first = await startJob(beta);
  const second = await startJob(beta);
  assert.equal(second.data.job.id, first.data.job.id);
  assert.equal(second.data.reused, "ACTIVE_JOB");
  const parallel = await Promise.all([startJob(beta), startJob(beta), startJob(beta)]);
  assert(parallel.every((response) => response.data.job.id === first.data.job.id));
  const betaUser = await prisma.user.findFirstOrThrow({ where: { email: `jobs-${counter}-${runId}@example.test` } });
  assert.equal(await prisma.evidenceReviewJob.count({ where: { userId: betaUser.id, status: { in: ["QUEUED", "RUNNING"] } } }), 1);
  pass("duplicate and concurrent starts join the one active job instead of queueing more");

  // ---- changed documents supersede the running job; the old result is never shown as current
  await uploadDoc(beta, "UDYAM");
  const superseding = await startJob(beta);
  assert.notEqual(superseding.data.job.id, first.data.job.id);
  assert.equal(superseding.data.job.docsTotal, 2);
  const old = await getJob(beta, first.data.job.id);
  assert.equal(old.data.job.status, "CANCELLED");
  assert.equal(old.data.job.errorCode, "SUPERSEDED");
  assert.equal(old.data.review, undefined);
  pass("replacing a document supersedes the running job (old one cancelled, not shown as current)");

  // ---- a succeeded job whose documents changed afterwards is STALE and carries no review
  setDelay(0);
  const done = await waitFor(beta, superseding.data.job.id, finished);
  assert.equal(done.data.job.status, "SUCCEEDED");
  await uploadDoc(beta, "BANK");
  const stale = await getJob(beta, superseding.data.job.id);
  assert.equal(stale.data.resultState, "STALE");
  assert.equal(stale.data.review, undefined);
  await request("GET", "/api/evidence-intelligence/review", { token: beta.token, expected: [409] });
  pass("results of an older document revision are reported STALE with no review; /review is 409 until a new job runs");

  // ---- queue capacity (max 4 active, 2 running)
  setDelay(8);
  const crowd: Owner[] = [];
  for (let index = 0; index < 4; index += 1) crowd.push(await newOwner(["GST"]));
  const accepted = [];
  for (const owner of crowd) accepted.push(await startJob(owner));
  const overflow = await newOwner(["GST"]);
  const full = await startJob(overflow, [503]);
  assert.equal(full.data.error.code, "QUEUE_FULL");
  const states = await Promise.all(accepted.map((response, index) => getJob(crowd[index], response.data.job.id)));
  assert(states.filter((state) => state.data.job.status === "RUNNING").length <= 2, "no more than two jobs run at once");
  assert(states.some((state) => state.data.job.status === "QUEUED"), "the rest wait in the queue");
  pass("at most two jobs run at once, four are admitted, and the fifth is refused with 503 QUEUE_FULL");

  // ---- cancellation: a queued and a running job end CANCELLED; the worker is stopped
  const queued = states.find((state) => state.data.job.status === "QUEUED")!;
  const queuedOwner = crowd[states.indexOf(queued)];
  const cancelledQueued = await request("POST", `/api/evidence-intelligence/jobs/${queued.data.job.id}/cancel`, { token: queuedOwner.token, expected: [200] });
  assert.equal(cancelledQueued.data.job.status, "CANCELLED");
  const runningIndex = states.findIndex((state) => state.data.job.status === "RUNNING");
  const cancelledRunning = await request("POST", `/api/evidence-intelligence/jobs/${states[runningIndex].data.job.id}/cancel`, { token: crowd[runningIndex].token, expected: [200] });
  assert.equal(cancelledRunning.data.job.status, "CANCELLED");
  assert.equal(cancelledRunning.data.job.errorCode, "CANCELLED_BY_OWNER");
  await sleep(1500);
  assert.equal((await getJob(crowd[runningIndex], states[runningIndex].data.job.id)).data.job.status, "CANCELLED", "a cancelled job never flips back to running/succeeded");
  const freed = await startJob(overflow);
  assert(["QUEUED", "RUNNING"].includes(freed.data.job.status), "cancelling frees capacity");
  pass("queued and running jobs can be cancelled, stay cancelled, and free their capacity");

  // drain: let the remaining crowd jobs finish so the next tests start from a quiet queue
  setDelay(0);
  for (let index = 0; index < crowd.length; index += 1) {
    const id = accepted[index].data.job.id as string;
    await waitFor(crowd[index], id, finished, 120_000);
  }
  await waitFor(overflow, freed.data.job.id, finished, 120_000);

  // ---- worker failure: the job completes explicitly degraded; no content is invented
  setMode("crash");
  const flaky = await newOwner(["GST"]);
  const flakyStart = await startJob(flaky);
  const flakyDone = await waitFor(flaky, flakyStart.data.job.id, finished);
  assert.equal(flakyDone.data.job.status, "SUCCEEDED");
  assert.equal(flakyDone.data.job.degraded, true, "the owner is told the isolated worker was unavailable");
  setMode("ok");
  pass("a crashing worker yields an explicitly degraded job, never a silent success");

  // ---- sensitive output: job payloads, the table row and the server log carry no extracted or identifying values
  const row = await prisma.evidenceReviewJob.findUnique({ where: { id: alphaJob } });
  const sensitive = JSON.stringify([result.data.job, started.data, row]);
  for (const secret of [PAN, GSTIN, ACCOUNT, UDYAM, alpha.gstin, alpha.pan]) assert(!sensitive.includes(secret), "job payload/row contains a sensitive value");
  for (const secret of [ACCOUNT, alpha.pan, alpha.gstin, UDYAM]) assert(!serverLog.includes(secret), "server log contains a sensitive value");
  pass("job status payloads, job rows and server logs contain no PAN, GSTIN, account or Udyam number");

  // ---- restart: a running job is explicitly failed, cached results are gone (corrections ask for a re-run)
  setDelay(20);
  const crashy = await newOwner(["GST"]);
  const crashyJob = await startJob(crashy);
  await waitFor(crashy, crashyJob.data.job.id, (job) => job.status === "RUNNING");
  await stopServer("SIGKILL");
  startServer();
  await waitForServer();
  const afterRestart = await getJob(crashy, crashyJob.data.job.id);
  assert.equal(afterRestart.data.job.status, "FAILED");
  assert.equal(afterRestart.data.job.errorCode, "SERVER_RESTARTED");
  const bootJob = await startJob(crashy);
  assert(["QUEUED", "RUNNING"].includes(bootJob.data.job.status), "the owner can start again after a restart");
  await request("GET", "/api/evidence-intelligence/review", { token: alpha.token, expected: [409] });
  const correction = await request("POST", "/api/evidence-intelligence/corrections", { token: alpha.token, body: { claim: "gstin", sourceDocumentId: null, source: "DOCUMENT_TEXT", confirm: true }, expected: [409] });
  assert.equal(correction.data.error.code, "REVIEW_EXPIRED");
  const oldJob = await getJob(alpha, alphaJob);
  assert.equal(oldJob.data.resultState, "EXPIRED");
  pass("after a server kill the running job is FAILED/SERVER_RESTARTED, results are EXPIRED, corrections need a fresh review");

  // ---- orphaned job rows (server alive, nobody working on them) are failed on the next poll
  setDelay(0);
  await waitFor(crashy, bootJob.data.job.id, finished, 90_000);
  const orphanOwner = await newOwner(["GST"]);
  const orphanUser = await prisma.user.findFirstOrThrow({ where: { email: `jobs-${counter}-${runId}@example.test` } });
  const orphanBusiness = await prisma.business.findFirstOrThrow({ where: { userId: orphanUser.id } });
  const orphan = await prisma.evidenceReviewJob.create({ data: { businessId: orphanBusiness.id, userId: orphanBusiness.userId, status: "RUNNING", fingerprint: "x", docsTotal: 1, startedAt: new Date(), heartbeatAt: new Date() } });
  const orphaned = await getJob(orphanOwner, orphan.id);
  assert.equal(orphaned.data.job.status, "FAILED");
  assert.equal(orphaned.data.job.errorCode, "JOB_INTERRUPTED");
  pass("a RUNNING job nobody is working on is failed explicitly instead of polling forever");

  // ---- cleanup guarantees
  await stopServer();
  assert.equal(extractTempDirs(), tmpBefore, "no worker temp directories left behind");
  pass("no isolated worker temp directories remain after cancelled, crashed and killed jobs");

  await prisma.$disconnect();
}

main()
  .then(async () => { await cleanup(); console.log("\nAll evidence review job tests passed"); })
  .catch(async (error) => { console.error(error); console.error(serverLog.slice(-1500)); await cleanup(); process.exit(1); });
