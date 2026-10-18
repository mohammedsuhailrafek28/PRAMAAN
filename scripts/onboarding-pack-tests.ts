import { execSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const id = `onboarding-${Date.now()}`;
const port = 4300 + Math.floor(Math.random() * 200);
const base = `http://127.0.0.1:${port}`;
const dbDir = path.join(root, "prisma", ".tmp-onboarding", id);
const databaseUrl = `file:./.tmp-onboarding/${id}/test.db`;
const uploads = path.join(root, ".tmp-onboarding-uploads", id);
let server: ChildProcessWithoutNullStreams | undefined;
let passed = 0;

function env() { return { ...process.env, DATABASE_URL: databaseUrl, UPLOAD_DIR: uploads, PORT: String(port), NODE_ENV: "test", JWT_SECRET: "onboarding-test-secret-0123456789" }; }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); passed += 1; console.log(`PASS ${message}`); }
async function call(method: string, url: string, options: { token?: string; body?: unknown; expected?: number[] } = {}) {
  const headers: HeadersInit = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) { headers["Content-Type"] = "application/json"; }
  const response = await fetch(`${base}${url}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!(options.expected ?? [200, 201]).includes(response.status)) throw new Error(`${method} ${url}: ${response.status} ${text}`);
  return { response, data };
}
async function blocked(method: string, url: string, token: string, code: string) {
  const result = await call(method, url, { token, expected: [403, 404] });
  assert(result.data.error?.code === code || result.data.error?.code === "FORBIDDEN", `${method} ${url} is blocked`);
}
async function waitForServer() {
  const until = Date.now() + 15000;
  while (Date.now() < until) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 150)); }
  throw new Error("server did not start");
}
async function register(email: string, role: string, name: string) {
  const result = await call("POST", "/api/auth/register", { body: { role, name, organizationName: name, email, password: "password123" }, expected: [201] });
  return { token: result.data.token as string, userId: result.data.user.id as string };
}

async function main() {
  mkdirSync(dbDir, { recursive: true }); mkdirSync(uploads, { recursive: true });
  execSync("npm run db:init", { cwd: root, env: env(), stdio: "inherit" });
  execSync("npx prisma migrate deploy", { cwd: root, env: env(), stdio: "inherit" });
  server = spawn(process.execPath, [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), "src/server.ts"], { cwd: root, env: env() });
  server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  await waitForServer();

  const msme = await register("pack-msme@example.test", "MSME", "Sharma Textiles");
  const buyer = await register("pack-buyer@example.test", "BUYER", "Acme Buyers");
  const otherBuyer = await register("pack-other@example.test", "BUYER", "Other Buyers");
  await call("POST", "/api/business", { token: msme.token, body: { legalName: "Sharma Textiles", gstin: "33ABCDE1234F1Z5", udyamNumber: "UDYAM-TN-01-0001234", pan: "ABCDE1234F", address: "Chennai, Tamil Nadu", turnoverBand: "1Cr-5Cr" }, expected: [201] });
  const packs = await call("GET", "/api/onboarding/packs", { token: buyer.token });
  assert(packs.data.packs.length === 1 && packs.data.packs[0].version === "1.0", "published vendor pack is immutable version 1.0");
  assert(packs.data.packs[0].requirements.length === 3 && packs.data.packs[0].requirements.some((item: any) => item.required === false), "pack exposes required and optional requirements");
  const created = await call("POST", "/api/onboarding/assignments", { token: buyer.token, body: { businessGstin: "33ABCDE1234F1Z5", packKey: "vendor-onboarding", packVersion: "1.0", purpose: "Supplier onboarding" }, expected: [201] });
  const assignmentId = created.data.assignment.id as string;
  assert(created.data.assignment.status === "REQUESTED", "buyer can create a request for an existing MSME");
  assert(created.data.assignment.checklist.every((item: any) => !("evidenceStatus" in item) && !("originalName" in item) && !("filePath" in item)), "requester checklist contains progress only, never private evidence metadata");
  const incoming = await call("GET", "/api/onboarding/assignments?scope=incoming", { token: msme.token });
  assert(incoming.data.assignments.some((item: any) => item.id === assignmentId), "owning MSME receives the incoming assignment");
  await blocked("GET", `/api/onboarding/assignments/${assignmentId}`, otherBuyer.token, "FORBIDDEN");
  await blocked("GET", "/api/onboarding/assignments?scope=incoming", buyer.token, "FORBIDDEN");
  const accepted = await call("PATCH", `/api/onboarding/assignments/${assignmentId}/accept`, { token: msme.token });
  assert(accepted.data.assignment.status === "ACCEPTED", "owning MSME can accept a pending assignment");
  const outgoing = await call("GET", "/api/onboarding/assignments?scope=outgoing", { token: buyer.token });
  assert(outgoing.data.assignments[0].status === "ACCEPTED", "requester can track accepted assignment progress");
  assert(outgoing.data.assignments[0].checklist.every((item: any) => ["OUTSTANDING", "RECEIVED"].includes(item.status)), "requester receives only coarse checklist states");
  const cancelled = await call("PATCH", `/api/onboarding/assignments/${assignmentId}/cancel`, { token: buyer.token });
  assert(cancelled.data.assignment.status === "CANCELLED", "requester can cancel its own active assignment");
  await call("PATCH", `/api/onboarding/assignments/${assignmentId}/cancel`, { token: otherBuyer.token, expected: [403] }).catch(() => { throw new Error("cross-requester cancellation unexpectedly succeeded"); });
  const duplicateResults = await Promise.allSettled([
    call("POST", "/api/onboarding/assignments", { token: buyer.token, body: { businessGstin: "33ABCDE1234F1Z5", packKey: "vendor-onboarding", packVersion: "1.0", purpose: "Supplier onboarding" }, expected: [201] }),
    call("POST", "/api/onboarding/assignments", { token: buyer.token, body: { businessGstin: "33ABCDE1234F1Z5", packKey: "vendor-onboarding", packVersion: "1.0", purpose: "Supplier onboarding" }, expected: [201] })
  ]);
  assert(duplicateResults.filter((result) => result.status === "fulfilled").length === 1, "concurrent duplicate assignment creation is rejected by the unique active key");
  execSync(`npx tsx scripts/requester-assurance.ts suspend --user-id ${buyer.userId} --operator-id onboarding-test-operator --suspension-reason synthetic-test-suspension`, { cwd: root, env: env(), stdio: "ignore" });
  await call("POST", "/api/onboarding/assignments", { token: buyer.token, body: { businessGstin: "33ABCDE1234F1Z5", packKey: "vendor-onboarding", packVersion: "1.0", purpose: "Supplier onboarding" }, expected: [403] });
  assert(true, "suspended requester cannot initiate a new onboarding request");
  console.log(`ONBOARDING PACK TESTS PASSED: ${passed}`);
}

async function run() {
  try { await main(); } finally {
    if (server && !server.killed) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 1500);
        server?.once("exit", () => { clearTimeout(timeout); resolve(); });
        server?.kill();
      });
    }
    for (const target of [dbDir, uploads]) if (existsSync(target)) {
      try { rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (error) { console.warn(`WARN Could not remove ${target}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
}
void run().catch((error) => { console.error(error); process.exitCode = 1; });
