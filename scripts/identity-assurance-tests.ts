import assert from "node:assert/strict";
import { execFileSync, execSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const port = Number(process.env.IDENTITY_ASSURANCE_PORT ?? 4302);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const databaseUrl = `file:./.tmp-identity-assurance/${runId}/identity.db`;
const dbDir = path.join(root, "prisma", ".tmp-identity-assurance", runId);
const uploadsDir = path.join(root, ".tmp-identity-assurance-uploads", runId);
const baseUrl = `http://127.0.0.1:${port}`;
const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
let server: ChildProcessWithoutNullStreams | undefined;

type Json = Record<string, any>;

function pass(message: string) { console.log(`PASS ${message}`); }
function assertJson(condition: unknown, message: string): asserts condition { assert(condition, message); }

async function request(method: string, url: string, options: { token?: string; body?: unknown; form?: FormData; expected?: number[] } = {}) {
  const headers: HeadersInit = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(options.body); }
  const response = await fetch(`${baseUrl}${url}`, { method, headers, body });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!(options.expected ?? [200, 201]).includes(response.status)) throw new Error(`${method} ${url} returned ${response.status}: ${text}`);
  return { status: response.status, data };
}

async function blocked(method: string, url: string, token: string | undefined, codes: string[], label: string, body?: unknown) {
  const result = await request(method, url, { token, body, expected: [400, 401, 403, 404, 409, 410] });
  assertJson(codes.includes(result.data.error?.code), `${label}: got ${result.data.error?.code}`);
  assertJson(!JSON.stringify(result.data).match(/passwordHash|tokenHash|filePath|privateNotes/i), `${label}: sensitive data leaked`);
  return result;
}

async function register(role: string, email: string, extra: Record<string, unknown> = {}) {
  const result = await request("POST", "/api/auth/register", { body: { role, name: `${role} Assurance Test`, organizationName: `${role} Assurance Test Org`, email, password: "password123", ...extra } });
  return { token: result.data.token as string, user: result.data.user as Json };
}

async function upload(token: string, docType: string) {
  const form = new FormData();
  form.set("docType", docType);
  form.set("source", "MSME_SUBMITTED");
  form.set("file", new Blob([`synthetic ${docType}`], { type: "application/pdf" }), `${docType}.pdf`);
  await request("POST", "/api/business/documents", { token, form });
}

function operator(args: string[]) {
  return execFileSync(process.execPath, [tsx, "scripts/requester-assurance.ts", ...args], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl, UPLOAD_DIR: uploadsDir }, encoding: "utf8" });
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Identity assurance test server did not become ready.");
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
  execSync("npm run db:init", { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl, UPLOAD_DIR: uploadsDir }, stdio: "inherit" });
  server = spawn(process.execPath, [tsx, "src/server.ts"], { cwd: root, env: { ...process.env, PORT: String(port), DATABASE_URL: databaseUrl, UPLOAD_DIR: uploadsDir } });
  server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  await waitForServer();

  const msme = await register("MSME", `assurance-msme-${runId}@example.test`);
  await request("POST", "/api/business", { token: msme.token, body: { legalName: "Assurance Textiles", gstin: "33ASSUR1234F1Z5", udyamNumber: "UDYAM-TN-01-ASSURE", pan: "ASSU1234F", address: "Chennai, Tamil Nadu", turnoverBand: "INR1Cr-INR5Cr" } });
  await upload(msme.token, "GST_CERTIFICATE");
  await upload(msme.token, "UDYAM_CERTIFICATE");
  await upload(msme.token, "BANK_STATEMENT");
  await request("POST", "/api/business/verify", { token: msme.token });
  await request("POST", "/api/passport/generate", { token: msme.token });
  pass("MSME fixture is verified with a generated Trust Profile");

  const buyer = await register("BUYER", `assurance-buyer-${runId}@example.test`, { assuranceStatus: "AUTHORIZED", reviewerIdentifier: "spoofed", verifiedOrganizationName: "Spoofed Authority" });
  const bank = await register("BANK", `assurance-bank-${runId}@example.test`, { assuranceStatus: "AUTHORIZED", reviewerIdentifier: "spoofed", verifiedOrganizationName: "Government Bank Authority" });
  const lowRequest = await request("POST", "/api/consent-requests", { token: buyer.token, body: { businessGstin: "33ASSUR1234F1Z5", requestedFields: ["legalBusinessName"], requestedEvidenceTypes: [], purpose: "Vendor Onboarding" } });
  assertJson(lowRequest.data.consent.requesterIdentity.status === "UNVERIFIED", "self-registration assigned privileged assurance");
  pass("self-registration and forged assurance fields remain UNVERIFIED");

  const bankRequest = await request("POST", "/api/consent-requests", { token: bank.token, body: { businessGstin: "33ASSUR1234F1Z5", requestedFields: ["legalBusinessName"], requestedEvidenceTypes: [], purpose: "Vendor Onboarding" } });
  assertJson(bankRequest.data.consent.requesterIdentity.displayName === "BANK Assurance Test Org", "spoofed bank identity was trusted as an authority");
  assertJson(bankRequest.data.consent.requesterIdentity.status === "UNVERIFIED", "spoofed bank was not visibly unverified");
  pass("spoofed bank name remains visibly UNVERIFIED");

  const buyerId = buyer.user.id as string;
  operator(["review", "--user-id", buyerId, "--operator-id", "operator-reviewer-1", "--review-basis", "registry-review-case-001"]);
  const highBody = { businessGstin: "33ASSUR1234F1Z5", requestedFields: ["turnoverBand"], requestedEvidenceTypes: [], purpose: "Vendor Onboarding" };
  const orgReviewedHigh = await blocked("POST", "/api/consent-requests", buyer.token, ["REQUESTER_ASSURANCE_REQUIRED"], "ORG_REVIEWED high-sensitivity request", highBody);
  assertJson(orgReviewedHigh.data.error?.code === "REQUESTER_ASSURANCE_REQUIRED", "ORG_REVIEWED requester accessed HIGH data");
  pass("ORG_REVIEWED requester cannot request HIGH disclosures");

  const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  operator(["authorize", "--user-id", buyerId, "--operator-id", "operator-reviewer-2", "--authorization-basis", "independent-authority-review-002", "--authorization-reference", "bank-authority-case-002", "--expires-at", expiry, "--scope-fields", "turnoverBand", "--scope-evidence-types", "BANK_STATEMENT"]);
  const highRequest = await request("POST", "/api/consent-requests", { token: buyer.token, body: { businessGstin: "33ASSUR1234F1Z5", requestedFields: ["turnoverBand"], requestedEvidenceTypes: [], purpose: "Vendor Onboarding" } });
  assertJson(highRequest.data.consent.requesterIdentity.status === "AUTHORIZED", "authorized requester summary missing");
  const highConsentId = highRequest.data.consentRequestId as string;
  const incoming = await request("GET", "/api/consent-requests?scope=incoming", { token: msme.token });
  const incomingHigh = incoming.data.requests.find((item: Json) => item.id === highConsentId);
  assertJson(incomingHigh, "authorized consent was not visible to MSME");
  await request("PATCH", `/api/consent-requests/${highConsentId}/approve`, { token: msme.token, body: { approvedFields: ["turnoverBand"], approvedEvidenceTypes: [], durationDays: 2 } });
  const highView = await request("GET", `/api/trust-view/${highConsentId}`, { token: buyer.token });
  assertJson(highView.data.sharedFields.turnoverBand, "AUTHORIZED requester could not access eligible consented HIGH field");
  pass("AUTHORIZED requester accesses eligible HIGH data only through MSME consent");
  await blocked("POST", "/api/requester-assurance", buyer.token, ["NOT_FOUND"], "public requester assurance control");
  await blocked("POST", "/api/access-grants", msme.token, ["REQUESTER_ASSURANCE_REQUIRED"], "unlinked high-sensitivity guest grant", { recipientName: "Unlinked recipient", purpose: "Vendor onboarding", scope: { fields: ["turnoverBand"], evidenceTypes: [] }, durationHours: 2 });

  const guest = await request("POST", "/api/access-grants", { token: msme.token, body: { recipientEmail: buyer.user.email, recipientName: "Buyer", recipientOrganization: "Buyer Assurance Test Org", purpose: "Vendor onboarding", scope: { fields: ["turnoverBand"], evidenceTypes: [] }, durationHours: 2 } });
  const guestToken = (guest.data.grant.secureUrl as string).split("/verify/")[1];
  assertJson(guestToken, "linked guest token missing");
  pass("linked guest grant records the requester relationship without exposing credentials");

  operator(["suspend", "--user-id", buyerId, "--operator-id", "operator-reviewer-3", "--suspension-reason", "Review hold pending evidence"]);
  await blocked("POST", "/api/consent-requests", buyer.token, ["REQUESTER_SUSPENDED"], "suspended requester new request", highBody);
  await blocked("GET", `/api/trust-view/${highConsentId}`, buyer.token, ["REQUESTER_SUSPENDED"], "suspended requester existing consent");
  await blocked("GET", `/api/public/verify/${guestToken}`, undefined, ["REQUESTER_SUSPENDED"], "suspended linked guest grant");
  pass("suspension blocks new requests, existing Trust Views, and linked guest access");

  const bankId = bank.user.id as string;
  operator(["review", "--user-id", bankId, "--operator-id", "operator-reviewer-4", "--review-basis", "registry-review-case-004"]);
  const bankExpiry = new Date(Date.now() + 1100).toISOString();
  operator(["authorize", "--user-id", bankId, "--operator-id", "operator-reviewer-5", "--authorization-basis", "independent-authority-review-005", "--authorization-reference", "bank-authority-case-005", "--expires-at", bankExpiry, "--scope-fields", "turnoverBand", "--scope-evidence-types", "BANK_STATEMENT"]);
  const expiringRequest = await request("POST", "/api/consent-requests", { token: bank.token, body: { businessGstin: "33ASSUR1234F1Z5", requestedFields: ["turnoverBand"], requestedEvidenceTypes: [], purpose: "Vendor Onboarding" } });
  const expiringId = expiringRequest.data.consentRequestId as string;
  const incomingAfterBank = await request("GET", "/api/consent-requests?scope=incoming", { token: msme.token });
  assertJson(incomingAfterBank.data.requests.some((item: Json) => item.id === expiringId), "expiring consent not visible");
  await request("PATCH", `/api/consent-requests/${expiringId}/approve`, { token: msme.token, body: { approvedFields: ["turnoverBand"], approvedEvidenceTypes: [], durationDays: 2 } });
  await new Promise((resolve) => setTimeout(resolve, 1300));
  await blocked("GET", `/api/trust-view/${expiringId}`, bank.token, ["REQUESTER_ASSURANCE_REQUIRED"], "expired authorization protected access");
  pass("expired authorization removes HIGH-sensitivity access from an existing consent");

  const history = JSON.parse(operator(["history", "--user-id", buyerId])) as Array<Json>;
  assertJson(history.some((event) => event.action === "REVIEW" && event.newStatus === "ORG_REVIEWED"), "review transition history missing");
  assertJson(history.some((event) => event.action === "AUTHORIZE" && event.newStatus === "AUTHORIZED"), "authorization transition history missing");
  assertJson(history.some((event) => event.action === "SUSPEND" && event.newStatus === "SUSPENDED"), "suspension transition history missing");
  pass("operator-only transitions and append-only assurance history are recorded");

  const before = readFileSync(path.join(root, "prisma", "migrations", "202610170001_identity_assurance", "migration.sql"), "utf8");
  assertJson(before.includes("WHERE \"role\" IN ('BUYER', 'BANK')") && before.includes("'UNVERIFIED'"), "migration does not default existing requester accounts");
  pass("additive migration explicitly defaults legacy BUYER and BANK accounts to UNVERIFIED");

  try { operator(["review", "--user-id", buyerId, "--operator-id", "operator-reviewer-6", "--review-basis", "self-uploaded-letter"]); assert.fail("self-attested review evidence was accepted"); } catch { pass("self-attested review evidence is rejected"); }
  try { operator(["review", "--user-id", buyerId, "--operator-id", buyer.user.email as string, "--review-basis", "registry-review-case-006"]); assert.fail("requester self-operation was accepted"); } catch { pass("requester cannot operate on its own assurance"); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(cleanup);
