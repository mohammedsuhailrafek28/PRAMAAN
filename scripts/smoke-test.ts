import { execFileSync, execSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const port = Number(process.env.SMOKE_PORT ?? 4100);
const baseUrl = `http://127.0.0.1:${port}`;
const smokeId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const smokeDbDir = path.join(root, "prisma", ".tmp-smoke", smokeId);
const databaseUrl = `file:./.tmp-smoke/${smokeId}/smoke.db`;
const uploadsDir = path.join(root, ".tmp-smoke-uploads", smokeId);
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
    execSync(`${command} ${args.join(" ")}`, { cwd: root, stdio: "inherit", env: { ...process.env, DATABASE_URL: databaseUrl, UPLOAD_DIR: uploadsDir } });
    return;
  }

  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl, UPLOAD_DIR: uploadsDir }
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

async function rawRequest(
  method: string,
  url: string,
  options: { token?: string; expected?: number[] } = {}
) {
  const headers: HeadersInit = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await fetch(`${baseUrl}${url}`, { method, headers });
  const buffer = Buffer.from(await response.arrayBuffer());
  const expected = options.expected ?? [200];
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${url} returned ${response.status}: ${buffer.toString("utf8")}`);
  }
  return { status: response.status, headers: response.headers, buffer, text: buffer.toString("utf8") };
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
    env: { ...process.env, PORT: String(port), DATABASE_URL: databaseUrl, UPLOAD_DIR: uploadsDir }
  });

  server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
}

function killServer() {
  if (server && !server.killed) server.kill();
}

async function cleanup() {
  if (server && !server.killed) {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 1500);
      server?.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      server?.kill();
    });
  }

  for (const dir of [smokeDbDir, uploadsDir]) {
    if (!existsSync(dir)) continue;
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      console.warn(`WARN Could not remove temporary smoke directory ${dir}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
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
  process.on("exit", killServer);
  process.on("SIGINT", () => {
    killServer();
    process.exit(1);
  });

  if (existsSync(smokeDbDir)) rmSync(smokeDbDir, { recursive: true, force: true });
  if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true, force: true });
  mkdirSync(smokeDbDir, { recursive: true });
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
    const gstUpload = await uploadDocument(msmeToken, "GST_CERTIFICATE", gstFile);
    const udyamUpload = await uploadDocument(msmeToken, "UDYAM_CERTIFICATE", udyamFile);
    assert(gstUpload.data.documentId && udyamUpload.data.documentId, "document IDs missing");
    pass("D. multipart identity document uploads are recorded");

    const crossCheck = await request("POST", "/api/business/cross-check", { token: msmeToken });
    const fields = crossCheck.data.profile.fieldConfidence.map((item: Json) => item.field);
    assert(crossCheck.data.trustStatus === "CROSS_CHECKED", "business not internally cross-checked");
    assert(fields.includes("gstin"), "GSTIN result missing");
    assert(fields.includes("pan"), "PAN result missing");
    assert(fields.includes("udyamNumber"), "Udyam result missing");
    assert(crossCheck.data.profile.documentConfidence.length >= 2, "document confidence checks missing");
    assert(crossCheck.data.profile.summary.trustReadiness >= 0, "trust readiness missing");
    assert(crossCheck.data.profile.sourceVerificationPerformed === false, "response claims source verification");
    assert(
      !crossCheck.data.profile.fieldConfidence.some((item: Json) => item.status === "SOURCE_VERIFIED"),
      "SOURCE_VERIFIED was produced without a source adapter"
    );
    pass("E. internal cross-check returns field confidence, document confidence, and trust metrics");

    const passportCreate = await request("POST", "/api/passport/generate", { token: msmeToken });
    assert(passportCreate.data.passportId, "passport ID missing");
    const passport = await request("GET", "/api/passport/me", { token: msmeToken });
    const snapshot = passport.data.passport.snapshotJson;
    for (const field of [
      "legalBusinessName",
      "gstin",
      "udyamNumber",
      "summary",
      "fieldConfidence",
      "documentConfidence",
      "generatedAt",
      "version"
    ]) {
      assert(Object.prototype.hasOwnProperty.call(snapshot, field), `passport snapshot missing ${field}`);
    }
    assert(snapshot.sourceVerificationPerformed === false, "profile claims source verification");
    pass("F. Business Trust Profile generation and owner fetch return evidence-backed snapshot fields");

    const profileList = await request("GET", "/api/readiness-profiles");
    assert(profileList.data.profiles.length === 4, "readiness profiles missing");
    pass("G. available readiness profiles are listed");

    const vendorReadiness = await request("POST", "/api/readiness-profiles/vendor-onboarding/evaluate", { token: msmeToken });
    assert(typeof vendorReadiness.data.result.score === "number", "vendor readiness score missing");
    assert(vendorReadiness.data.result.level, "vendor readiness level missing");
    assert(vendorReadiness.data.requirements.length > 0, "vendor requirements missing");
    assert(vendorReadiness.data.nextActions.length > 0, "vendor next actions missing");
    assert(vendorReadiness.data.requirements.some((item: Json) => item.requirementId === "vendor_bank_evidence" && item.status === "MISSING"), "missing bank evidence requirement not detected");
    pass("H. Vendor Onboarding Readiness returns score, level, requirements, missing item, and next actions");

    const loanReadiness = await request("POST", "/api/readiness-profiles/loan-application-preparation/evaluate", { token: msmeToken });
    assert(loanReadiness.data.profile.purpose === "LOAN_APPLICATION_PREPARATION", "loan readiness purpose mismatch");
    assert(loanReadiness.data.result.score !== vendorReadiness.data.result.score || loanReadiness.data.requirements.length !== vendorReadiness.data.requirements.length, "purpose-specific readiness result did not differ");
    pass("I. Loan Application Preparation produces a different purpose-specific result");

    const bankFile = createFixture("bank-statement.pdf", "%PDF-1.4 smoke bank statement\n");
    const bankUpload = await uploadDocument(msmeToken, "BANK_STATEMENT", bankFile);
    assert(bankUpload.data.documentId, "bank document ID missing");
    await request("POST", "/api/business/cross-check", { token: msmeToken });
    await request("POST", "/api/passport/generate", { token: msmeToken });
    const improvedVendorReadiness = await request("POST", "/api/readiness-profiles/vendor-onboarding/evaluate", { token: msmeToken });
    assert(improvedVendorReadiness.data.result.score >= vendorReadiness.data.result.score, "vendor readiness did not improve after bank evidence");
    assert(!improvedVendorReadiness.data.requirements.some((item: Json) => item.requirementId === "vendor_bank_evidence" && item.status === "MISSING"), "bank evidence remained missing after upload");
    pass("J. adding missing bank evidence improves the relevant readiness result");

    const reportTypes = await request("GET", "/api/report-types", { token: msmeToken });
    assert(reportTypes.data.reportTypes.length === 5, "report types missing");
    pass("K. report types are listed");

    const trustReport = await request("POST", "/api/reports/generate", {
      token: msmeToken,
      body: { reportType: "BUSINESS_TRUST_PROFILE" }
    });
    const trustReportId = trustReport.data.report.reportId;
    assert(trustReportId, "trust report ID missing");
    assert(trustReport.data.document.reportType === "BUSINESS_TRUST_PROFILE", "trust report type mismatch");
    assert(!JSON.stringify(trustReport.data.document).includes("uploads\\"), "trust report leaked local path");
    pass("L. Business Trust Profile Report is generated as safe JSON");

    const vendorReport = await request("POST", "/api/reports/generate", {
      token: msmeToken,
      body: { reportType: "VENDOR_ONBOARDING_READINESS" }
    });
    const vendorReportId = vendorReport.data.report.reportId;
    const oldBusinessName = vendorReport.data.document.business.businessName;
    assert(vendorReport.data.document.requirements.length > 0, "vendor report requirements missing");
    assert(vendorReport.data.document.provenance.readinessEvaluationId, "vendor report readiness provenance missing");
    pass("M. Vendor Onboarding Readiness Report is generated with readiness provenance");

    const reportList = await request("GET", "/api/reports", { token: msmeToken });
    assert(reportList.data.reports.some((item: Json) => item.reportId === vendorReportId), "report metadata missing");
    assert(!reportList.data.reports.some((item: Json) => item.snapshotJson), "report list leaked full snapshots");
    const fetchedVendorReport = await request("GET", `/api/reports/${vendorReportId}`, { token: msmeToken });
    assert(fetchedVendorReport.data.document.business.businessName === oldBusinessName, "retrieved report snapshot mismatch");
    pass("N. reports list returns metadata and retrieval returns stored snapshot");

    const htmlPreview = await rawRequest("GET", `/api/reports/${vendorReportId}/preview`, { token: msmeToken });
    assert(htmlPreview.headers.get("content-type")?.includes("text/html"), "HTML preview content type missing");
    assert(htmlPreview.headers.get("cache-control")?.includes("no-store"), "HTML preview cache header missing");
    assert(htmlPreview.text.includes(vendorReportId), "HTML preview missing report ID");
    assert(htmlPreview.text.includes(oldBusinessName), "HTML preview missing business name");
    assert(htmlPreview.text.includes("Limitations and Disclaimer"), "HTML preview missing limitations");
    assert(!htmlPreview.text.includes("uploads/") && !htmlPreview.text.includes("uploads\\"), "HTML preview leaked local path");
    const htmlDownload = await rawRequest("GET", `/api/reports/${vendorReportId}/html`, { token: msmeToken });
    assert(htmlDownload.headers.get("content-disposition")?.includes(".html"), "HTML download disposition missing");
    const pdfDownload = await rawRequest("GET", `/api/reports/${vendorReportId}/pdf`, { token: msmeToken });
    assert(pdfDownload.headers.get("content-type")?.includes("application/pdf"), "PDF content type missing");
    assert(pdfDownload.buffer.subarray(0, 4).toString("utf8") === "%PDF", "PDF signature missing");
    pass("N2. report HTML preview, HTML download, and PDF download render stored snapshot");

    await request("PATCH", "/api/business/me", {
      token: msmeToken,
      body: { ...businessInput, legalName: "Sharma Textiles Updated" }
    });
    const oldReportAfterUpdate = await request("GET", `/api/reports/${vendorReportId}`, { token: msmeToken });
    assert(oldReportAfterUpdate.data.document.business.businessName === oldBusinessName, "old report mutated after business update");
    const oldHtmlAfterUpdate = await rawRequest("GET", `/api/reports/${vendorReportId}/preview`, { token: msmeToken });
    assert(oldHtmlAfterUpdate.text.includes(oldBusinessName), "old HTML did not preserve old business name");
    assert(!oldHtmlAfterUpdate.text.includes("Sharma Textiles Updated"), "old HTML was recalculated from updated business");
    const oldPdfAfterUpdate = await rawRequest("GET", `/api/reports/${vendorReportId}/pdf`, { token: msmeToken });
    assert(oldPdfAfterUpdate.buffer.subarray(0, 4).toString("utf8") === "%PDF", "old PDF after update invalid");
    const newTrustReport = await request("POST", "/api/reports/generate", {
      token: msmeToken,
      body: { reportType: "BUSINESS_TRUST_PROFILE" }
    });
    assert(newTrustReport.data.document.business.businessName === "Sharma Textiles Updated", "new report did not reflect updated business");
    pass("O. old report remains immutable and new report reflects new state");

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
    await expectBlocked("GET", "/api/reports", buyerToken, ["FORBIDDEN"], "buyer report list");
    await expectBlocked("GET", `/api/reports/${vendorReportId}`, buyerToken, ["FORBIDDEN"], "buyer report retrieve");
    await expectBlocked("GET", `/api/reports/${vendorReportId}/preview`, buyerToken, ["FORBIDDEN"], "buyer report HTML preview");
    await expectBlocked("GET", `/api/reports/${vendorReportId}/pdf`, buyerToken, ["FORBIDDEN"], "buyer report PDF download");
    const bankRegistration = await request("POST", "/api/auth/register", {
      body: {
        role: "BANK",
        name: "Karan Mehta",
        organizationName: "Kisan NBFC",
        email: "bank-smoke@pramaan.demo",
        password: "password123"
      }
    });
    await expectBlocked("GET", `/api/reports/${vendorReportId}/html`, bankRegistration.data.token, ["FORBIDDEN"], "bank report HTML download");
    const otherMsme = await request("POST", "/api/auth/register", {
      body: {
        role: "MSME",
        name: "Other MSME",
        organizationName: "Other MSME Co",
        email: "other-msme-smoke@pramaan.demo",
        password: "password123"
      }
    });
    await expectBlocked("GET", `/api/reports/${vendorReportId}/preview`, otherMsme.data.token, ["NOT_FOUND"], "other MSME report preview");
    await expectBlocked("GET", "/api/reports/not-a-real-report/preview", msmeToken, ["NOT_FOUND"], "guessed report preview");
    pass("P. buyer auth returns JWT and cannot access report APIs");

    const revokeReport = await request("POST", `/api/reports/${trustReportId}/revoke`, { token: msmeToken });
    assert(revokeReport.data.report.revokedAt, "report revoke timestamp missing");
    const revokedReport = await request("GET", `/api/reports/${trustReportId}`, { token: msmeToken });
    assert(revokedReport.data.report.revokedAt, "revoked report not visible to owner");
    const revokedHtml = await rawRequest("GET", `/api/reports/${trustReportId}/preview`, { token: msmeToken });
    assert(revokedHtml.text.includes("REVOKED"), "revoked HTML missing revoked state");
    const revokedPdf = await rawRequest("GET", `/api/reports/${trustReportId}/pdf`, { token: msmeToken });
    assert(revokedPdf.buffer.subarray(0, 4).toString("utf8") === "%PDF", "revoked PDF signature missing");
    pass("Q. owner revokes report non-destructively and can still see revoked status");

    const consentCreate = await request("POST", "/api/consent-requests", {
      token: buyerToken,
      body: {
        businessGstin: businessInput.gstin,
        requestedFields: ["legalBusinessName", "gstin", "udyamNumber", "summary", "limitations"]
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
    assert(getActions(audit.data).includes("CONSENT_REQUESTED"), "CONSENT_REQUESTED audit missing");
    pass("R. buyer creates pending consent request, MSME notification and CONSENT_REQUESTED audit exist");

    const incoming = await request("GET", "/api/consent-requests?scope=incoming", { token: msmeToken });
    assert(incoming.data.requests.some((item: Json) => item.id === consentId), "incoming request missing");
    pass("S. MSME sees incoming buyer request");

    const approve = await request("PATCH", `/api/consent-requests/${consentId}/approve`, {
      token: msmeToken,
      body: {
        approvedFields: ["legalBusinessName", "gstin", "udyamNumber", "summary"],
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
    assert(getActions(audit.data).includes("CONSENT_APPROVED"), "CONSENT_APPROVED audit missing");
    pass("T. MSME approves selected fields only and approval is audited/notified");

    const trustView = await request("GET", `/api/trust-view/${consentId}`, { token: buyerToken });
    const sharedKeys = Object.keys(trustView.data.sharedFields);
    const expectedShared = ["legalBusinessName", "gstin", "udyamNumber", "summary"];
    assert(sharedKeys.length === expectedShared.length, `unexpected shared field count: ${sharedKeys.join(",")}`);
    for (const field of expectedShared) assert(sharedKeys.includes(field), `approved field missing: ${field}`);
    assert(trustView.data.sharedFields.gstin.evidenceStatus, "approved field missing evidence status");
    assert(typeof trustView.data.sharedFields.gstin.confidence === "number", "approved field missing confidence");
    assert(trustView.data.sharedFields.gstin.confidenceReason, "approved field missing confidence reason");
    for (const forbidden of [
      "documents",
      "rawDocuments",
      "pan",
      "turnoverBand",
      "bankAccount",
      "fieldConfidence",
      "documentConfidence",
      "limitations",
      "readiness",
      "readinessEvaluations",
      "reports",
      "reportId"
    ]) {
      assert(!sharedKeys.includes(forbidden), `unapproved field leaked: ${forbidden}`);
    }
    audit = await request("GET", "/api/audit-logs", { token: msmeToken });
    assert(getActions(audit.data).includes("TRUST_PROFILE_VIEWED"), "TRUST_PROFILE_VIEWED audit missing");
    pass("U. buyer dynamic trust view returns only approved fields, no report data, and records VIEWED");

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
    pass("V. unauthorized trust-view, passport, and raw document access are blocked");

    const revoke = await request("PATCH", `/api/consent-requests/${consentId}/revoke`, { token: msmeToken });
    assert(revoke.data.status === "REVOKED", "consent not revoked");
    buyerNotifications = await request("GET", "/api/notifications", { token: buyerToken });
    assert(
      buyerNotifications.data.notifications.some((item: Json) => item.message.includes("revoked")),
      "buyer revoke notification missing"
    );
    audit = await request("GET", "/api/audit-logs", { token: msmeToken });
    assert(getActions(audit.data).includes("CONSENT_REVOKED"), "CONSENT_REVOKED audit missing");
    pass("W. MSME revokes consent and revocation is audited/notified");

    const revokedView = await expectBlocked(
      "GET",
      `/api/trust-view/${consentId}`,
      buyerToken,
      ["CONSENT_REVOKED"],
      "revoked trust view"
    );
    assert(!revokedView.data.sharedFields, "revoked response leaked sharedFields");
    pass("X. buyer trust-view after revoke is blocked with CONSENT_REVOKED");

    audit = await request("GET", "/api/audit-logs", { token: msmeToken });
    const actions = getActions(audit.data);
    for (const action of [
      "BUSINESS_CROSS_CHECKED",
      "TRUST_PROFILE_GENERATED",
      "CONSENT_REQUESTED",
      "CONSENT_APPROVED",
      "TRUST_PROFILE_VIEWED",
      "CONSENT_REVOKED",
      "READINESS_PROFILE_EVALUATED",
      "REPORT_GENERATED",
      "REPORT_REVOKED",
      "REPORT_HTML_VIEWED",
      "REPORT_HTML_DOWNLOADED",
      "REPORT_PDF_DOWNLOADED"
    ]) {
      assert(actions.includes(action), `audit lifecycle missing ${action}`);
    }
    pass("Y. audit lifecycle contains all required actions");

    msmeNotifications = await request("GET", "/api/notifications", { token: msmeToken });
    buyerNotifications = await request("GET", "/api/notifications", { token: buyerToken });
    assert(msmeNotifications.data.notifications.length > 0, "MSME notifications missing");
    assert(buyerNotifications.data.notifications.length > 0, "buyer notifications missing");
    pass("Z. notification lifecycle has expected MSME and buyer messages");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await cleanup();
  }

  if (failures > 0) {
    log(`\nSmoke test failed with ${failures} failure(s).`);
    process.exit(1);
  }

  log("\nSmoke test passed.");
}

main().catch((error) => {
  killServer();
  console.error(error);
  process.exit(1);
});
