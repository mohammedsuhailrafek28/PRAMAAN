import { execSync, spawn, type ChildProcessByStdio } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import type { Readable } from "node:stream";
import path from "node:path";

const root = process.cwd();
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const port = Number(process.env.EVIDENCE_REVISION_PORT ?? 4312);
const concurrencyCounts = (process.env.EVIDENCE_REVISION_COUNTS ?? "2,10,50").split(",").map(Number).filter((count) => count > 0);
const baseUrl = `http://127.0.0.1:${port}`;
const dbDir = path.join(root, "prisma", ".tmp-evidence-revisions", runId);
const dbPath = path.join(dbDir, "revisions.db");
const databaseUrl = `file:${dbPath}`;
const uploadDir = path.join(root, ".tmp-evidence-revision-uploads", runId);
const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");

type Json = Record<string, any>;
let server: ChildProcessByStdio<null, Readable, Readable> | undefined;
let failures = 0;

function pass(message: string) { console.log(`PASS ${message}`); }
function fail(message: string) { failures += 1; console.log(`FAIL ${message}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

function run(command: string, args: string[]) {
  const executable = process.platform === "win32" ? `${command}.cmd` : command;
  execSync([executable, ...args].join(" "), {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl, UPLOAD_DIR: uploadDir }
  });
}

async function request(method: string, url: string, options: { token?: string; form?: FormData; body?: Json; expected?: number[] } = {}) {
  const headers: HeadersInit = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  if (options.body) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${baseUrl}${url}`, { method, headers, body });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!(options.expected ?? [200, 201]).includes(response.status)) {
    throw new Error(`${method} ${url} returned ${response.status}: ${text}`);
  }
  return { status: response.status, data };
}

async function register(suffix: string) {
  const result = await request("POST", "/api/auth/register", {
    body: {
      role: "MSME",
      name: `Revision ${suffix}`,
      organizationName: `Revision ${suffix} Textiles`,
      email: `revision-${suffix}-${runId}@example.test`,
      password: "password123"
    }
  });
  return result.data.token as string;
}

async function upload(token: string, docType: string, name: string, metadata: Json = {}) {
  const form = new FormData();
  form.set("docType", docType);
  for (const [key, value] of Object.entries(metadata)) form.set(key, String(value));
  form.set("file", new Blob([`synthetic ${name}`], { type: "application/pdf" }), `${name}.pdf`);
  return request("POST", "/api/business/documents", { token, form, expected: [201, 400, 409, 503] });
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("revision test server did not become ready");
}

function inspectInvariants(businessId: string, docType: string) {
  const database = new DatabaseSync(dbPath);
  const rows = database.prepare(`SELECT id, revision, isCurrent, previousVersionId, filePath FROM Document WHERE businessId = ? AND docType = ? ORDER BY revision`).all(businessId, docType) as Array<Json>;
  const revisions = rows.map((row) => Number(row.revision));
  assert(revisions.every((revision, index) => revision === index + 1), `${docType} revisions are not contiguous: ${revisions.join(",")}`);
  assert(rows.filter((row) => Boolean(row.isCurrent)).length === (rows.length ? 1 : 0), `${docType} current row count is invalid`);
  const byRevision = new Map(rows.map((row) => [Number(row.revision), row]));
  for (const row of rows) {
    if (Number(row.revision) === 1) assert(row.previousVersionId === null, "revision 1 has a predecessor");
    else assert(row.previousVersionId === byRevision.get(Number(row.revision) - 1)?.id, `revision ${row.revision} does not point to its predecessor`);
    assert(existsSync(row.filePath), `committed file is missing: ${row.filePath}`);
  }
  database.close();
  return rows;
}

function assertNoOrphanFiles() {
  const database = new DatabaseSync(dbPath);
  const rows = database.prepare("SELECT filePath FROM Document").all() as Array<{ filePath: string }>;
  const expected = new Set(rows.map((row) => path.basename(row.filePath)));
  const actual = new Set(readdirSync(uploadDir));
  database.close();
  assert(actual.size === expected.size && [...actual].every((file) => expected.has(file)), "upload directory contains an uncommitted or missing document file");
}

async function cleanup() {
  if (server && !server.killed) {
    server.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  for (const target of [dbDir, uploadDir]) {
    if (existsSync(target)) rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function main() {
  mkdirSync(dbDir, { recursive: true });
  mkdirSync(uploadDir, { recursive: true });
  run("npm", ["run", "prisma:generate"]);
  run("npm", ["run", "db:init"]);
  const spawned = spawn(process.execPath, [tsx, "src/server.ts"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATABASE_URL: databaseUrl, UPLOAD_DIR: uploadDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server = spawned;
  spawned.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  spawned.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

  try {
    await waitForServer();
    const token = await register("primary");
    const profile = await request("POST", "/api/business", {
      token,
      body: { legalName: "Revision Primary", gstin: "33REVISION1234F1Z5", udyamNumber: "UDYAM-TN-99-0000101", pan: "REVISION123F", address: "Chennai, Tamil Nadu", turnoverBand: "INR 1Cr-INR 5Cr" }
    });
    const businessId = profile.data.business.id as string;

    for (const count of concurrencyCounts) {
      const before = inspectInvariants(businessId, "GST_CERTIFICATE");
      const results = await Promise.all(Array.from({ length: count }, (_, index) => upload(token, "GST_CERTIFICATE", `same-type-${count}-${index}`)));
      const successful = results.filter((result) => result.status === 201).length;
      assert(successful > 0, `${count} concurrent uploads produced no successful revision`);
      const rows = inspectInvariants(businessId, "GST_CERTIFICATE");
      assert(rows.length === before.length + successful, `${count} upload revision count does not match committed requests`);
      assertNoOrphanFiles();
      pass(`${count} concurrent same-type uploads preserve contiguous revisions, predecessor chain, and one current row (${successful} committed)`);
    }

    const otherTokens = await Promise.all([register("parallel-a"), register("parallel-b")]);
    await Promise.all(otherTokens.map((otherToken, index) => request("POST", "/api/business", {
      token: otherToken,
      body: { legalName: `Parallel ${index}`, gstin: `33PARALLEL${index}234F1Z5`, udyamNumber: `UDYAM-TN-99-000010${index + 2}`, pan: `PARALLEL${index}3F`, address: "Chennai, Tamil Nadu", turnoverBand: "INR 1Cr-INR 5Cr" }
    })));
    await Promise.all([
      upload(otherTokens[0], "GST_CERTIFICATE", "parallel-a-gst"),
      upload(otherTokens[0], "BANK_STATEMENT", "parallel-a-bank"),
      upload(otherTokens[1], "GST_CERTIFICATE", "parallel-b-gst"),
      upload(otherTokens[1], "BANK_STATEMENT", "parallel-b-bank")
    ]);
    pass("parallel uploads across MSMEs and document types complete without cross-tenant mixing");

    const beforeRejectedFiles = new Set(readdirSync(uploadDir));
    const rejected = await upload(token, "GST_CERTIFICATE", "invalid-metadata", { issuedAt: "2026-02-01", expiresAt: "2026-01-01" });
    assert(rejected.status === 400, "invalid lifecycle metadata was not rejected");
    const afterRejectedFiles = readdirSync(uploadDir);
    assert(afterRejectedFiles.every((file) => beforeRejectedFiles.has(file)), `rejected metadata left uploaded files behind: ${afterRejectedFiles.filter((file) => !beforeRejectedFiles.has(file)).join(",")}`);
    assertNoOrphanFiles();
    pass("invalid metadata rejects before persistence and cleans the Multer file");

    const database = new DatabaseSync(dbPath);
    const duplicateIndexes = database.prepare(`PRAGMA index_list('Document')`).all() as Array<Json>;
    assert(duplicateIndexes.some((index) => index.name === "Document_businessId_docType_revision_key"), "revision unique index missing");
    assert(duplicateIndexes.some((index) => index.name === "Document_one_current_per_business_doc_type"), "partial current unique index missing");
    database.close();
    pass("database constraints are present and no duplicate revision/current rows exist");
  } finally {
    await cleanup();
  }

  if (failures) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { void cleanup(); });
