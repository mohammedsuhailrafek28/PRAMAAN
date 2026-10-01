import { execSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const root = process.cwd();
const port = Number(process.env.RELIABILITY_PORT ?? 4201);
const baseUrl = `http://127.0.0.1:${port}`;
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const dbDir = path.join(root, "prisma", ".tmp-reliability", runId);
const dbPath = path.join(dbDir, "reliability.db");
const databaseUrl = `file:./.tmp-reliability/${runId}/reliability.db`;
const uploadDir = path.join(root, ".tmp-reliability-uploads", runId);

type Json = Record<string, any>;
let server: ChildProcessWithoutNullStreams | undefined;
let failures = 0;
const timings = new Map<string, number[]>();

function pass(message: string) { console.log(`PASS ${message}`); }
function fail(message: string) { failures += 1; console.log(`FAIL ${message}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

function run(command: string, args: string[]) {
  const executable = process.platform === "win32" ? `${command}.cmd` : command;
  execSync([executable, ...args].join(" "), { cwd: root, stdio: "inherit", env: { ...process.env, DATABASE_URL: databaseUrl, UPLOAD_DIR: uploadDir } });
}

async function request(method: string, url: string, options: { token?: string; body?: unknown; form?: FormData; expected?: number[] } = {}) {
  const started = performance.now();
  const headers: HeadersInit = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(options.body); }
  const response = await fetch(`${baseUrl}${url}`, { method, headers, body });
  const elapsed = performance.now() - started;
  const key = `${method} ${url.split("?")[0]}`;
  timings.set(key, [...(timings.get(key) ?? []), elapsed]);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!(options.expected ?? [200, 201]).includes(response.status)) throw new Error(`${method} ${url} returned ${response.status}: ${text}`);
  return { status: response.status, data };
}

async function blocked(method: string, url: string, token: string | undefined, codes: string[], label: string) {
  const result = await request(method, url, { token, expected: [400, 401, 403, 404, 409, 410] });
  assert(codes.includes(result.data.error?.code), `${label}: got ${result.data.error?.code}`);
  assert(!JSON.stringify(result.data).match(/stack|passwordHash|tokenHash|filePath/i), `${label}: sensitive error data leaked`);
  return result;
}

async function register(role: string, suffix: string) {
  const result = await request("POST", "/api/auth/register", { body: { role, name: `${role} ${suffix}`, organizationName: `${role} ${suffix} Org`, email: `${role.toLowerCase()}-${suffix}-${runId}@example.test`, password: "password123" } });
  return result.data.token as string;
}

async function upload(token: string, docType: string, source: string) {
  const form = new FormData();
  form.set("docType", docType);
  form.set("source", source);
  form.set("file", new Blob([`synthetic ${docType} ${source}`], { type: "application/pdf" }), `${docType.toLowerCase()}-${source}.pdf`);
  return request("POST", "/api/business/documents", { token, form });
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Reliability server did not become ready.");
}

async function cleanup() {
  if (server && !server.killed) {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 1500);
      server?.once("exit", () => { clearTimeout(timeout); resolve(); });
      server?.kill();
    });
  }
  for (const target of [dbDir, uploadDir]) {
    if (!existsSync(target)) continue;
    try { rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (error) { console.warn(`WARN Could not remove temporary reliability directory ${target}: ${error instanceof Error ? error.message : String(error)}`); }
  }
}

async function main() {
  mkdirSync(dbDir, { recursive: true });
  run("npm", ["run", "prisma:generate"]);
  run("npm", ["run", "db:init"]);
  server = spawn(process.execPath, [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), "src/server.ts"], { cwd: root, env: { ...process.env, PORT: String(port), DATABASE_URL: databaseUrl, UPLOAD_DIR: uploadDir } });
  server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  try {
    await waitForServer();
    const msmeA = await register("MSME", "a");
    const msmeB = await register("MSME", "b");
    const buyerA = await register("BUYER", "a");
    const buyerB = await register("BUYER", "b");
    const bank = await register("BANK", "a");
    const profile = { legalName: "Reliability Textiles", gstin: "33RELIA1234F1Z5", udyamNumber: "UDYAM-TN-99-0000001", pan: "RELIA1234F", address: "Chennai, Tamil Nadu", turnoverBand: "INR 1Cr-INR 5Cr" };
    await request("POST", "/api/business", { token: msmeA, body: profile });
    await upload(msmeA, "GST_CERTIFICATE", "v1");
    await upload(msmeA, "UDYAM_CERTIFICATE", "v1");
    await upload(msmeA, "BANK_STATEMENT", "v1");
    await request("POST", "/api/business/cross-check", { token: msmeA });
    const passportV1 = await request("POST", "/api/passport/generate", { token: msmeA });
    pass("clean database, profile, evidence, cross-check, and Trust Profile setup");

    const msmeBProfile = await request("GET", "/api/business/me", { token: msmeB });
    assert(msmeBProfile.data.business.gstin === null && msmeBProfile.data.business.documents.length === 0, "MSME B received MSME A business data");
    await blocked("GET", "/api/passport/me", msmeB, ["NOT_FOUND"], "MSME B cannot read MSME A passport");
    await blocked("GET", "/api/business/me", buyerA, ["FORBIDDEN"], "buyer cannot read MSME profile");
    await blocked("GET", "/api/consent-requests?scope=incoming", buyerA, ["FORBIDDEN"], "buyer cannot read incoming requests");
    await blocked("GET", "/api/consent-requests?scope=outgoing", msmeB, ["FORBIDDEN"], "MSME cannot read outgoing requests");
    await blocked("GET", "/api/business/me", "not.a.jwt", ["UNAUTHORIZED"], "invalid JWT is rejected");
    await blocked("GET", "/api/business/me", undefined, ["UNAUTHORIZED"], "missing auth is rejected");
    pass("authorization boundaries and malformed/stale authentication fail safely");

    await blocked("POST", "/api/consent-requests", buyerA, ["VALIDATION_ERROR"], "unknown disclosure field rejected");
    await request("POST", "/api/consent-requests", { token: buyerA, body: { businessGstin: profile.gstin, requestedFields: ["gstin", "gstin", "udyamNumber"], requestedEvidenceTypes: ["GST_CERTIFICATE", "GST_CERTIFICATE"], purpose: "Vendor Onboarding" } }).then((result) => assert((result.data.consent.requestedFields as string[]).length === 2 && (result.data.consent.requestedEvidenceTypes as string[]).length === 1, "duplicate disclosure keys were not normalized"));
    await blocked("POST", "/api/consent-requests", buyerA, ["VALIDATION_ERROR"], "empty disclosure scope rejected");
    await blocked("POST", "/api/consent-requests", buyerA, ["VALIDATION_ERROR"], "field key in evidence array rejected");
    const hugeScope = Array.from({ length: 1001 }, (_, index) => `unknown-${index}`);
    await request("POST", "/api/consent-requests", { token: buyerA, body: { businessGstin: profile.gstin, requestedFields: hugeScope }, expected: [400] }).then((result) => {
      assert(result.data.error?.code === "VALIDATION_ERROR", "huge unsupported scope did not return validation error");
    });
    pass("requested-to-approved disclosure boundaries reject unknown, empty, mixed, and duplicate abuse");

    const requestA = await request("POST", "/api/consent-requests", { token: buyerA, body: { businessGstin: profile.gstin, requestedFields: ["gstin"], requestedEvidenceTypes: [], purpose: "Vendor Onboarding" } });
    const consentId = requestA.data.consentRequestId as string;
    await blocked("PATCH", `/api/consent-requests/${consentId}/approve`, msmeA, ["VALIDATION_ERROR"], "unrequested field approval rejected");
    const approvalResults = await Promise.allSettled([
      request("PATCH", `/api/consent-requests/${consentId}/approve`, { token: msmeA, body: { approvedFields: ["gstin"], durationDays: 7 } }),
      request("PATCH", `/api/consent-requests/${consentId}/approve`, { token: msmeA, body: { approvedFields: ["gstin"], durationDays: 7 } })
    ]);
    assert(approvalResults.filter((item) => item.status === "fulfilled").length === 1, "concurrent approval did not produce one winner");
    assert(approvalResults.filter((item) => item.status === "rejected" && String(item.reason).includes("409")).length === 1, "concurrent approval did not produce one conflict");
    await blocked("GET", `/api/trust-view/${consentId}`, buyerB, ["FORBIDDEN"], "second verifier cannot use another verifier consent");
    await blocked("GET", `/api/trust-view/${consentId}`, bank, ["FORBIDDEN"], "bank cannot use buyer consent");
    const viewV1 = await request("GET", `/api/trust-view/${consentId}`, { token: buyerA });
    assert(viewV1.data.metadata.passportVersion === passportV1.data.version, "consent did not pin v1");
    assert(Object.keys(viewV1.data.sharedFields).join(",") === "gstin", "Trust View disclosed outside approved scope");
    pass("approval race, verifier isolation, minimal Trust View, and snapshot v1 pinning hold");

    await request("PATCH", "/api/business/me", { token: msmeA, body: { ...profile, turnoverBand: "INR 5Cr-INR 10Cr" } });
    await upload(msmeA, "GST_CERTIFICATE", "v2");
    const passportV2 = await request("POST", "/api/passport/generate", { token: msmeA });
    const oldView = await request("GET", `/api/trust-view/${consentId}`, { token: buyerA });
    assert(oldView.data.metadata.passportVersion === passportV1.data.version, "registered consent shifted to latest profile");
    assert(oldView.data.sharedFields.gstin.value === profile.gstin, "old consent value changed after replacement");
    assert(passportV2.data.version > passportV1.data.version, "v2 was not generated");
    const newConsent = await request("POST", "/api/consent-requests", { token: buyerA, body: { businessGstin: profile.gstin, requestedFields: ["turnoverBand"], purpose: "Vendor Onboarding" } });
    const newConsentId = newConsent.data.consentRequestId as string;
    await request("PATCH", `/api/consent-requests/${newConsentId}/approve`, { token: msmeA, body: { approvedFields: ["turnoverBand"], durationDays: 7 } });
    const newView = await request("GET", `/api/trust-view/${newConsentId}`, { token: buyerA });
    assert(newView.data.metadata.passportVersion === passportV2.data.version, "new consent did not use v2");
    await request("PATCH", `/api/consent-requests/${newConsentId}/revoke`, { token: msmeA });
    await blocked("GET", `/api/trust-view/${newConsentId}`, buyerA, ["CONSENT_REVOKED"], "revoked registered consent remains blocked");
    pass("business mutation and evidence replacement do not shift old authorization; new consent uses v2 and revocation holds");

    const guest = await request("POST", "/api/access-grants", { token: msmeA, body: { purpose: "Vendor onboarding", scope: { fields: ["gstin"], evidenceTypes: ["GST_CERTIFICATE"] }, durationHours: 24 } });
    const guestToken = (guest.data.grant.secureUrl as string).split("/verify/")[1];
    const guestView = await request("GET", `/api/public/verify/${guestToken}`);
    assert(guestView.data.grant.profileVersion === passportV2.data.version, "guest did not pin v2");
    assert(!JSON.stringify(guestView.data).match(/filePath|originalName|mimeType|pan|turnoverBand/i), "guest response leaked private document metadata");
    const guestRevoke = await Promise.allSettled([
      request("PATCH", `/api/access-grants/${guest.data.grant.id}/revoke`, { token: msmeA }),
      request("PATCH", `/api/access-grants/${guest.data.grant.id}/revoke`, { token: msmeA })
    ]);
    assert(guestRevoke.filter((item) => item.status === "fulfilled").length === 1, "concurrent guest revoke did not produce one winner");
    await blocked("GET", `/api/public/verify/${guestToken}`, undefined, ["ACCESS_REVOKED"], "revoked guest link remains blocked");
    pass("guest scope, pinned version, metadata redaction, and revoke idempotency hold");

    const expiryRequest = await request("POST", "/api/consent-requests", { token: buyerA, body: { businessGstin: profile.gstin, requestedFields: ["gstin"], purpose: "Vendor Onboarding" } });
    const expiryId = expiryRequest.data.consentRequestId as string;
    await request("PATCH", `/api/consent-requests/${expiryId}/approve`, { token: msmeA, body: { approvedFields: ["gstin"], durationDays: 1 } });
    const db = new DatabaseSync(dbPath);
    db.prepare('UPDATE "ConsentRequest" SET "expiresAt" = ? WHERE "id" = ?').run(new Date(0).toISOString(), expiryId);
    db.close();
    await blocked("GET", `/api/trust-view/${expiryId}`, buyerA, ["CONSENT_EXPIRED"], "expired registered consent denied");
    await blocked("GET", `/api/trust-view/${expiryId}`, buyerA, ["CONSENT_EXPIRED"], "repeated expired consent denied");
    const audit = await request("GET", "/api/audit-logs", { token: msmeA });
    const expiredEvents = audit.data.logs.filter((entry: Json) => entry.action === "CONSENT_EXPIRED" && entry.consentRequestId === expiryId);
    assert(expiredEvents.length === 1, "expiry audit was not deduplicated");
    pass("expiry boundary behavior and repeated-read audit deduplication hold");

    for (const [key, values] of timings) {
      if (!values.length) continue;
      values.sort((a, b) => a - b);
      const percentile = (ratio: number) => Math.round(values[Math.min(values.length - 1, Math.floor(values.length * ratio))]);
      console.log(`PERF ${key} p50=${percentile(0.5)}ms p95=${percentile(0.95)}ms worst=${Math.round(values[values.length - 1])}ms`);
    }
    pass("latency samples captured for authentication, profile, consent, Trust View, audit, and guest paths");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await cleanup();
  }
  if (failures) { console.log(`Reliability test failed with ${failures} failure(s).`); process.exit(1); }
  console.log("Reliability test passed.");
}

main().catch(async (error) => { await cleanup(); console.error(error); process.exit(1); });
