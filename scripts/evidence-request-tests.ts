import { execSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const id = `evidence-request-${Date.now()}`;
const port = 4700 + Math.floor(Math.random() * 120);
const base = `http://127.0.0.1:${port}`;
const dbDir = path.join(root, "prisma", ".tmp-evidence-request", id);
const databaseUrl = `file:./.tmp-evidence-request/${id}/test.db`;
const uploads = path.join(root, ".tmp-evidence-request-uploads", id);
let server: ChildProcessWithoutNullStreams | undefined;
let passed = 0;

function environment() { return { ...process.env, DATABASE_URL: databaseUrl, UPLOAD_DIR: uploads, PORT: String(port), NODE_ENV: "test", JWT_SECRET: "evidence-request-test-secret-0123456789" }; }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); passed += 1; console.log(`PASS ${message}`); }
async function call(method: string, url: string, options: { token?: string; body?: unknown; expected?: number[] } = {}) {
  const headers: HeadersInit = {}; if (options.token) headers.Authorization = `Bearer ${options.token}`; if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${url}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const text = await response.text(); const data = text ? JSON.parse(text) : {};
  if (!(options.expected ?? [200, 201]).includes(response.status)) throw new Error(`${method} ${url}: ${response.status} ${text}`);
  return { response, data };
}
async function register(email: string, role: string, name: string) { const result = await call("POST", "/api/auth/register", { body: { role, name, organizationName: name, email, password: "password123" }, expected: [201] }); return result.data.token as string; }
async function waitForServer() { const until = Date.now() + 15000; while (Date.now() < until) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 150)); } throw new Error("server did not start"); }

async function main() {
  mkdirSync(dbDir, { recursive: true }); mkdirSync(uploads, { recursive: true });
  execSync("npm run db:init", { cwd: root, env: environment(), stdio: "inherit" });
  execSync("npx prisma migrate deploy", { cwd: root, env: environment(), stdio: "inherit" });
  server = spawn(process.execPath, [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), "src/server.ts"], { cwd: root, env: environment() });
  server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`)); server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`)); await waitForServer();
  const msme = await register(`case-msme-${id}@example.test`, "MSME", "Synthetic Textiles");
  const buyer = await register(`case-buyer-${id}@example.test`, "BUYER", "Synthetic Buyers");
  const bank = await register(`case-bank-${id}@example.test`, "BANK", "Synthetic Bank");
  const other = await register(`case-other-${id}@example.test`, "BUYER", "Other Buyers");
  await call("POST", "/api/business", { token: msme, body: { legalName: "Synthetic Textiles", gstin: "33ABCDE1234F1Z5", udyamNumber: "UDYAM-TEST-0001", pan: "ABCDE1234F", address: "Synthetic Chennai", turnoverBand: "1Cr-5Cr" }, expected: [201] });
  const business = await call("GET", "/api/business/me", { token: msme }); const gstin = business.data.business.gstin as string;
  const assignment = await call("POST", "/api/onboarding/assignments", { token: buyer, body: { businessGstin: gstin, packKey: "vendor-onboarding", packVersion: "1.0", purpose: "Synthetic review" }, expected: [201] });
  const assignmentId = assignment.data.assignment.id as string; await call("PATCH", `/api/onboarding/assignments/${assignmentId}/accept`, { token: msme });
  const caseAttempts = await Promise.allSettled([1, 2].map(() => call("POST", `/api/onboarding/assignments/${assignmentId}/evidence-requests`, { token: buyer, body: { requirementKey: "GST_CERTIFICATE", requestKind: "MISSING_EVIDENCE", reason: "Please provide the current GST certificate." }, expected: [201] })));
  const created = caseAttempts.find((result): result is PromiseFulfilledResult<{ response: Response; data: any }> => result.status === "fulfilled");
  const requestId = created?.value.data.request.id as string; assert(caseAttempts.filter((result) => result.status === "fulfilled").length === 1 && created?.value.data.request.status === "OPEN", "reviewer can create one targeted evidence request under concurrent retries");
  assert(!JSON.stringify(created?.value.data.request).includes("filePath") && !JSON.stringify(created?.value.data.request).includes("evidenceStatus"), "requester response contains no private evidence metadata");
  await call("GET", `/api/onboarding/evidence-requests/${requestId}`, { token: other, expected: [403] }); assert(true, "other requester cannot read the case");
  await call("POST", `/api/onboarding/evidence-requests/${requestId}/respond`, { token: other, body: { responseType: "CLARIFICATION", clarification: "Spoofed response" }, expected: [403] }); assert(true, "other requester cannot respond as the MSME");
  await call("POST", `/api/onboarding/evidence-requests/${requestId}/respond`, { token: msme, body: { responseType: "DOCUMENT_REFERENCE", documentId: "not-owned-by-business" }, expected: [400] }); assert(true, "malformed or cross-business document references are rejected");
  const response = await call("POST", `/api/onboarding/evidence-requests/${requestId}/respond`, { token: msme, body: { responseType: "CLARIFICATION", clarification: "The synthetic certificate is being prepared." } }); assert(response.data.request.status === "RESPONDED", "MSME can respond with a clarification");
  const reviewed = await call("PATCH", `/api/onboarding/evidence-requests/${requestId}/review`, { token: buyer, body: { decision: "ACTION_REQUIRED" } }); assert(reviewed.data.request.status === "ACTION_REQUIRED", "reviewer can request another action");
  const second = await call("POST", `/api/onboarding/evidence-requests/${requestId}/respond`, { token: msme, body: { responseType: "CLARIFICATION", clarification: "The synthetic certificate remains available for consent review." } }); assert(second.data.request.status === "RESPONDED", "action-required case supports a re-response loop");
  const resolved = await call("PATCH", `/api/onboarding/evidence-requests/${requestId}/review`, { token: buyer, body: { decision: "RESOLVED" } }); assert(resolved.data.request.status === "RESOLVED", "reviewer can resolve a responded case");
  await call("PATCH", `/api/onboarding/evidence-requests/${requestId}/review`, { token: buyer, body: { decision: "RESOLVED" }, expected: [409] }); assert(true, "terminal case transitions are concurrency-safe");
  const incoming = await call("GET", "/api/onboarding/evidence-requests?scope=incoming", { token: msme }); assert(incoming.data.requests.some((item: any) => item.id === requestId), "MSME sees its targeted request history");
  const outgoing = await call("GET", "/api/onboarding/evidence-requests?scope=outgoing", { token: buyer }); assert(outgoing.data.requests.some((item: any) => item.status === "RESOLVED"), "requester sees the resolved case status");
  const notifications = await call("GET", "/api/notifications", { token: msme }); assert(notifications.data.notifications?.some((item: any) => item.message.includes("follow-up")), "MSME receives a follow-up notification");
  const bankAssignment = await call("POST", "/api/onboarding/assignments", { token: bank, body: { businessGstin: gstin, packKey: "vendor-onboarding", packVersion: "1.0", purpose: "Synthetic bank review" }, expected: [201] });
  const bankAssignmentId = bankAssignment.data.assignment.id as string;
  await call("PATCH", `/api/onboarding/assignments/${bankAssignmentId}/accept`, { token: msme });
  const bankRequest = await call("POST", `/api/onboarding/assignments/${bankAssignmentId}/evidence-requests`, { token: bank, body: { requirementKey: "GST_CERTIFICATE", requestKind: "CLARIFICATION", reason: "Please clarify the synthetic GST evidence." }, expected: [201] });
  assert(bankRequest.data.request.requester.role === "BANK" && bankRequest.data.request.requester.identity.status === "UNVERIFIED" && bankRequest.data.request.status === "OPEN", "bank reviewers receive the same safe evidence-request contract");
  await call("GET", `/api/onboarding/evidence-requests/${bankRequest.data.request.id}`, { token: msme });
  await call("POST", `/api/onboarding/evidence-requests/${bankRequest.data.request.id}/respond`, { token: msme, body: { responseType: "CLARIFICATION", clarification: "Synthetic clarification for bank review." } });
  const insufficient = await call("PATCH", `/api/onboarding/evidence-requests/${bankRequest.data.request.id}/review`, { token: bank, body: { decision: "INSUFFICIENT", note: "Synthetic evidence remains insufficient." } });
  assert(insufficient.data.request.status === "INSUFFICIENT", "bank reviewers can mark a case insufficient without granting consent");
  const bankMe = await call("GET", "/api/auth/me", { token: bank });
  execSync(`npx tsx scripts/requester-assurance.ts suspend --user-id ${bankMe.data.user.id} --operator-id evidence-request-test-operator --suspension-reason synthetic-review-hold`, { cwd: root, env: environment(), stdio: "ignore" });
  await call("GET", `/api/onboarding/evidence-requests/${bankRequest.data.request.id}`, { token: bank, expected: [403] }); assert(true, "suspended requester cannot access an existing evidence-request detail");
  await call("POST", `/api/onboarding/assignments/${bankAssignmentId}/evidence-requests`, { token: bank, body: { requirementKey: "UDYAM_CERTIFICATE", requestKind: "MISSING_EVIDENCE", reason: "Synthetic request after suspension." }, expected: [403] }); assert(true, "suspended requester cannot create a new evidence request");
  console.log(`EVIDENCE REQUEST TESTS PASSED: ${passed}`);
}

async function run() { try { await main(); } finally { if (server && !server.killed) { server.kill(); await new Promise((resolve) => setTimeout(resolve, 400)); } for (const target of [dbDir, uploads]) if (existsSync(target)) { try { rmSync(target, { recursive: true, force: true }); } catch {} } } }
void run().catch((error) => { console.error(error); process.exitCode = 1; });
