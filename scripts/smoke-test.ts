import { execFileSync, execSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const port = Number(process.env.SMOKE_PORT ?? 4100);
const baseUrl = `http://127.0.0.1:${port}`;
const dbPath = path.join(root, "prisma", "dev.db");
const uploadsDir = path.join(root, "uploads");
const fixturesDir = path.join(root, "test-fixtures");

type Json = Record<string, any>;

let server: ChildProcessWithoutNullStreams | undefined;
let failures = 0;

function log(message: string) {
  console.log(message);
}

function pass(message: string) {
  log(`PASS ${message}`);
}

function fail(message: string) {
  failures += 1;
  log(`FAIL ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command: string, args: string[]) {
  log(`RUN ${command} ${args.join(" ")}`);
  if (process.platform === "win32") {
    execSync(`${command} ${args.join(" ")}`, { cwd: root, stdio: "inherit", env: process.env });
    return;
  }

  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env
  });
}

function npmCmd() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function request(
  method: string,
  url: string,
  options: { token?: string; body?: unknown; form?: FormData; expected?: number[] } = {}
) {
  const headers: HeadersInit = {};
  let body: BodyInit | undefined;

  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${baseUrl}${url}`, { method, headers, body });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  const expected = options.expected ?? [200, 201];
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${url} returned ${response.status}: ${text}`);
  }
  return { status: response.status, data };
}

async function expectBlocked(
  method: string,
  url: string,
  token: string | undefined,
  allowedCodes: string[],
  message: string
) {
  const result = await request(method, url, { token, expected: [401, 403, 404, 410] });
  const code = result.data.error?.code;
  assert(allowedCodes.includes(code), `${message}: expected ${allowedCodes.join("/")} got ${code}`);
  return result;
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error("Server did not become ready.");
}

function startServer() {
  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  server = spawn(process.execPath, [tsxCli, "src/server.ts"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATABASE_URL: "file:./dev.db" }
  });

  server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
}

function cleanup() {
  if (server && !server.killed) server.kill();
}

function createFixture(name: string, content: string) {
  mkdirSync(fixturesDir, { recursive: true });
  const filePath = path.join(fixturesDir, name);
  if (!existsSync(filePath)) writeFileSync(filePath, content);
  return filePath;
}

async function uploadDocument(token: string, docType: string, filePath: string) {
  const form = new FormData();
  form.set("docType", docType);
  form.set("file", new Blob([readFileSync(filePath)], { type: "application/pdf" }), path.basename(filePath));
  return request("POST", "/api/business/documents", { token, form });
}

function getActions(audit: Json) {
  return audit.logs.map((logEntry: Json) => logEntry.action);
}

async function main() {
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(1);
  });

  if (existsSync(dbPath)) rmSync(dbPath, { force: true });
  if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true, force: true });
  mkdirSync(uploadsDir, { recursive: true });

  run(npmCmd(), ["run", "prisma:generate"]);
  run(npmCmd(), ["run", "db:init"]);

  startServer();
  await waitForServer();

  try {
    const health = await request("GET", "/api/health");
    assert(health.data.status === "healthy", "health status is not healthy");
    assert(health.data.service === "Pramaan Backend", "health service missing");
    assert(health.data.version === "1.0.0", "health version missing");
    assert(typeof health.data.uptimeSeconds === "number", "health uptime missing");
    assert(health.data.database?.connected === true, "database not reachable");
    assert(health.data.database?.provider === "sqlite", "database provider missing");
    assert(health.data.timestamp, "health timestamp missing");
    pass("A. health endpoint returns status, uptime, DB reachability, timestamp");

    const msmeRegistration = await request("POST", "/api/auth/register", {
      body: {
        role: "MSME",
        name: "Ravi Sharma",
        organizationName: "Sharma Textiles",
        email: "msme-smoke@pramaan.demo",
        password: "password123"
      }
    });
    const msmeToken = msmeRegistration.data.token;
    assert(msmeToken, "MSME token missing");
    await expectBlocked("GET", "/api/business/me", undefined, ["UNAUTHORIZED"], "unauthenticated business route");
    pass("B. MSME auth returns JWT and protected route rejects unauthenticated access");

    const businessInput = {
      legalName: "Sharma Textiles",
      gstin: "33ABCDE1234F1Z5",
      udyamNumber: "UDYAM-TN-01-0001234",
      pan: "ABCDE1234F",
      address: "Chennai, Tamil Nadu",
      turnoverBand: "₹1Cr–₹5Cr"
    };
    await request("POST", "/api/business", { token: msmeToken, body: businessInput });
    const business = await request("GET", "/api/business/me", { token: msmeToken });
    for (const [key, value] of Object.entries(businessInput)) {
      assert(business.data.business[key] === value, `business ${key} mismatch`);
    }
    pass("C. MSME business profile saves and fetches expected values");

    const gstFile = createFixture("gst-certificate.pdf", "%PDF-1.4 smoke GST certificate\n");
    const udyamFile = createFixture("udyam-certificate.pdf", "%PDF-1.4 smoke Udyam certificate\n");
    const bankFile = createFixture("bank-statement.pdf", "%PDF-1.4 smoke bank statement\n");
    const gstUpload = await uploadDocument(msmeToken, "GST_CERTIFICATE", gstFile);
    const udyamUpload = await uploadDocument(msmeToken, "UDYAM_CERTIFICATE", udyamFile);
    const bankUpload = await uploadDocument(msmeToken, "BANK_STATEMENT", bankFile);
    assert(gstUpload.data.documentId && udyamUpload.data.documentId && bankUpload.data.documentId, "document IDs missing");
    pass("D. multipart document uploads are recorded");

    const verification = await request("POST", "/api/business/verify", { token: msmeToken });
    const fields = verification.data.fieldResults.map((item: Json) => item.field);
    assert(verification.data.verificationStatus === "VERIFIED", "business not verified");
    assert(fields.includes("gstin"), "GSTIN result missing");
    assert(fields.includes("pan"), "PAN result missing");
    assert(fields.includes("udyamNumber"), "Udyam result missing");
    assert(fields.includes("bankStatement"), "document-present check missing");
    assert(verification.data.metadata?.liveGovernmentVerification === false, "response claims live government verification");
    pass("E. rule-based verification marks business VERIFIED without live government claims");

    const passportCreate = await request("POST", "/api/passport/generate", { token: msmeToken });
    assert(passportCreate.data.passportId, "passport ID missing");
    const passport = await request("GET", "/api/passport/me", { token: msmeToken });
    const snapshot = passport.data.passport.snapshotJson;
    for (const field of [
      "legalBusinessName",
      "gstin",
      "gstinVerified",
      "udyamNumber",
      "udyamVerified",
      "panMasked",
      "turnoverBand",
      "generatedAt",
      "version"
    ]) {
      assert(Object.prototype.hasOwnProperty.call(snapshot, field), `passport snapshot missing ${field}`);
    }
    pass("F. passport generation and owner fetch return required snapshot fields");

    const buyerRegistration = await request("POST", "/api/auth/register", {
      body: {
        role: "BUYER",
        name: "Ananya Iyer",
        organizationName: "Acme Retail Buyers",
        email: "buyer-smoke@pramaan.demo",
        password: "password123"
      }
    });
    const buyerToken = buyerRegistration.data.token;
    assert(buyerToken, "Buyer token missing");
    pass("G. buyer auth returns JWT");

    const consentCreate = await request("POST", "/api/consent-requests", {
      token: buyerToken,
      body: {
        businessGstin: businessInput.gstin,
        requestedFields: ["legalBusinessName", "gstin", "gstinVerified", "udyamNumber", "complianceStatus"]
      }
    });
    const consentId = consentCreate.data.consentRequestId;
    assert(consentCreate.data.status === "PENDING", "consent not pending");
    let msmeNotifications = await request("GET", "/api/notifications", { token: msmeToken });
    assert(
      msmeNotifications.data.notifications.some((item: Json) => item.message.includes("Acme Retail Buyers")),
      "MSME request notification missing"
    );
    let audit = await request("GET", "/api/audit-logs", { token: msmeToken });
    assert(getActions(audit.data).includes("REQUESTED"), "REQUESTED audit missing");
    pass("H. buyer creates pending consent request, MSME notification and REQUESTED audit exist");

    const incoming = await request("GET", "/api/consent-requests?scope=incoming", { token: msmeToken });
    assert(incoming.data.requests.some((item: Json) => item.id === consentId), "incoming request missing");
    pass("I. MSME sees incoming buyer request");

    const approve = await request("PATCH", `/api/consent-requests/${consentId}/approve`, {
      token: msmeToken,
      body: {
        approvedFields: ["legalBusinessName", "gstin", "gstinVerified", "udyamNumber"],
        durationDays: 7
      }
    });
    assert(approve.data.status === "APPROVED", "consent not approved");
    assert(approve.data.expiresAt, "expiresAt missing");
    let buyerNotifications = await request("GET", "/api/notifications", { token: buyerToken });
    assert(
      buyerNotifications.data.notifications.some((item: Json) => item.message.includes("granted access")),
      "buyer approval notification missing"
    );
    audit = await request("GET", "/api/audit-logs", { token: msmeToken });
    assert(getActions(audit.data).includes("APPROVED"), "APPROVED audit missing");
    pass("J. MSME approves selected fields only and approval is audited/notified");

    const trustView = await request("GET", `/api/trust-view/${consentId}`, { token: buyerToken });
    const sharedKeys = Object.keys(trustView.data.sharedFields);
    const expectedShared = ["legalBusinessName", "gstin", "gstinVerified", "udyamNumber"];
    assert(sharedKeys.length === expectedShared.length, `unexpected shared field count: ${sharedKeys.join(",")}`);
    for (const field of expectedShared) assert(sharedKeys.includes(field), `approved field missing: ${field}`);
    for (const forbidden of [
      "documents",
      "rawDocuments",
      "pan",
      "panMasked",
      "turnoverBand",
      "bankVerificationStatus",
      "complianceStatus"
    ]) {
      assert(!sharedKeys.includes(forbidden), `unapproved field leaked: ${forbidden}`);
    }
    audit = await request("GET", "/api/audit-logs", { token: msmeToken });
    assert(getActions(audit.data).includes("VIEWED"), "VIEWED audit missing");
    pass("K. buyer dynamic trust view returns only approved fields and records VIEWED");

    const otherBuyer = await request("POST", "/api/auth/register", {
      body: {
        role: "BUYER",
        name: "Other Buyer",
        organizationName: "Other Buyer Co",
        email: "other-buyer-smoke@pramaan.demo",
        password: "password123"
      }
    });
    await expectBlocked(
      "GET",
      `/api/trust-view/${consentId}`,
      otherBuyer.data.token,
      ["FORBIDDEN"],
      "other buyer trust view"
    );
    await expectBlocked("GET", "/api/passport/me", buyerToken, ["FORBIDDEN"], "buyer direct passport");
    await expectBlocked(
      "GET",
      `/api/business/documents/${gstUpload.data.documentId}`,
      buyerToken,
      ["FORBIDDEN"],
      "buyer raw document fetch"
    );
    pass("L. unauthorized trust-view, passport, and raw document access are blocked");

    const revoke = await request("PATCH", `/api/consent-requests/${consentId}/revoke`, { token: msmeToken });
    assert(revoke.data.status === "REVOKED", "consent not revoked");
    buyerNotifications = await request("GET", "/api/notifications", { token: buyerToken });
    assert(
      buyerNotifications.data.notifications.some((item: Json) => item.message.includes("revoked")),
      "buyer revoke notification missing"
    );
    audit = await request("GET", "/api/audit-logs", { token: msmeToken });
    assert(getActions(audit.data).includes("REVOKED"), "REVOKED audit missing");
    pass("M. MSME revokes consent and revocation is audited/notified");

    const revokedView = await expectBlocked(
      "GET",
      `/api/trust-view/${consentId}`,
      buyerToken,
      ["CONSENT_REVOKED"],
      "revoked trust view"
    );
    assert(!revokedView.data.sharedFields, "revoked response leaked sharedFields");
    pass("N. buyer trust-view after revoke is blocked with CONSENT_REVOKED");

    audit = await request("GET", "/api/audit-logs", { token: msmeToken });
    const actions = getActions(audit.data);
    for (const action of ["BUSINESS_VERIFIED", "PASSPORT_GENERATED", "REQUESTED", "APPROVED", "VIEWED", "REVOKED"]) {
      assert(actions.includes(action), `audit lifecycle missing ${action}`);
    }
    pass("O. audit lifecycle contains all required actions");

    msmeNotifications = await request("GET", "/api/notifications", { token: msmeToken });
    buyerNotifications = await request("GET", "/api/notifications", { token: buyerToken });
    assert(msmeNotifications.data.notifications.length > 0, "MSME notifications missing");
    assert(buyerNotifications.data.notifications.length > 0, "buyer notifications missing");
    pass("P. notification lifecycle has expected MSME and buyer messages");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    cleanup();
  }

  if (failures > 0) {
    log(`\nSmoke test failed with ${failures} failure(s).`);
    process.exit(1);
  }

  log("\nSmoke test passed.");
}

main().catch((error) => {
  cleanup();
  console.error(error);
  process.exit(1);
});
