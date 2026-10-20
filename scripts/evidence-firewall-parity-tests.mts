// Evidence Decision Firewall: authorization parity with the CANONICAL consent, guest-link and Identity Assurance
// behaviour. Every case is run through the real services (getTrustView, resolveGuest, enforceDisclosureAccess)
// on an isolated, synthetic SQLite database and through the pure firewall; the allow/deny outcomes must agree.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const dbDir = path.join(root, "prisma", ".tmp-firewall-parity", runId);
process.env.DATABASE_URL = `file:${path.join(dbDir, "test.db").split(path.sep).join("/")}`;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "firewall-parity-test-secret-0123456789";
mkdirSync(dbDir, { recursive: true });
execSync("npm run db:init", { cwd: root, stdio: "ignore", env: process.env });

const { prisma } = await import("../src/config/prisma.js");
const assurance = await import("../src/modules/requesterAssurance/assurance.service.js");
const trustViewService = await import("../src/modules/trustView/trustView.service.js");
const accessGrantService = await import("../src/modules/accessGrant/accessGrant.service.js");
const { evaluateConclusion } = await import("../src/modules/evidenceFirewall/evidence-firewall.js");
const { assurancePermits, effectiveAssuranceStatus } = await import("../src/modules/evidenceFirewall/firewall-authorization.js");
type AuthorizationContext = import("../src/modules/evidenceFirewall/firewall.types.js").AuthorizationContext;

let failures = 0;
let checked = 0;
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function test(name: string, run: () => Promise<void>) {
  try { await run(); console.log(`PASS ${name}`); } catch (error) { failures += 1; console.error(`FAIL ${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); }
}
const day = (offset: number) => new Date(Date.now() + offset * 86400000);
let counter = 0;
const PASSPORT = "passport-parity-1";

async function seedBusiness() {
  const owner = await prisma.user.create({ data: { role: "MSME", name: "Owner", organizationName: "Sharma Textiles", email: `owner-${runId}@x.test`, passwordHash: "x" } });
  const business = await prisma.business.create({ data: { userId: owner.id, legalName: "Sharma Textiles", gstin: "33ABCDE1234F1Z5" } });
  const snapshot = { profileId: PASSPORT, businessId: business.id, snapshotSchema: 2, version: 1, generatedAt: new Date().toISOString(), lastCalculatedAt: new Date().toISOString(), summary: {}, fieldConfidence: [], documentConfidence: [], evidence: [], gaps: [], contradictions: [], limitations: [], sourceVerificationPerformed: false };
  const passport = await prisma.passport.create({ data: { id: PASSPORT, businessId: business.id, version: 1, snapshotJson: snapshot } });
  return { business, passport, snapshot };
}

type AssuranceCase = { status: string; expires: Date | null; scope: unknown };
async function seedRequester(spec: AssuranceCase | null) {
  counter += 1;
  const user = await prisma.user.create({ data: { role: "BUYER", name: `Buyer ${counter}`, organizationName: `Buyer Org ${counter}`, email: `buyer${counter}-${runId}@x.test`, passwordHash: "x" } });
  if (spec) await prisma.requesterAssurance.create({ data: { userId: user.id, status: spec.status, authorizationExpiresAt: spec.expires, authorizationScope: spec.scope as never } });
  return user;
}

const toContext = (assuranceRow: { status: string; authorizationExpiresAt: Date | null; authorizationScope: unknown } | null, base: Omit<AuthorizationContext, "requester">): AuthorizationContext => ({
  ...base,
  requester: assuranceRow ? { assuranceStatus: assuranceRow.status, authorizationExpiresAt: assuranceRow.authorizationExpiresAt?.toISOString() ?? null, authorizationScope: assuranceRow.authorizationScope } : null
});

const firewallAllows = (snapshot: unknown, authorization: AuthorizationContext) =>
  evaluateConclusion({ snapshot, snapshotPassportId: PASSPORT, authorization, request: { kind: "FIELD_NOT_CONTRADICTED", field: "gstin" }, now: new Date().toISOString() }).verdict !== "NOT_DISCLOSABLE";

const realAllows = async (call: () => Promise<unknown>) => { try { await call(); return true; } catch (error) { assert((error as { status?: number }).status !== undefined || (error as { statusCode?: number }).statusCode !== undefined || (error as { code?: string }).code !== undefined, `unexpected failure: ${error}`); return false; } };

const SCOPES: unknown[] = [null, { fields: [], evidenceTypes: [] }, { fields: ["turnoverBand"], evidenceTypes: [] }, { fields: [], evidenceTypes: ["BANK_STATEMENT"] }, { fields: ["turnoverBand"], evidenceTypes: ["BANK_STATEMENT"] }, { fields: ["turnoverBand", 7], evidenceTypes: "BANK_STATEMENT" }, ["turnoverBand"], "garbage"];
const ITEM_SETS: Array<[string, string[], string[]]> = [
  ["LOW only", ["gstin", "address"], ["GST_CERTIFICATE"]], ["HIGH field", ["gstin", "turnoverBand"], []], ["HIGH evidence", ["gstin"], ["BANK_STATEMENT"]],
  ["HIGH field and evidence", ["gstin", "turnoverBand"], ["BANK_STATEMENT"]], ["LOW with LOW evidence", ["gstin", "udyamNumber", "ownerName"], ["GST_CERTIFICATE", "UDYAM_CERTIFICATE"]]
];
const STATUSES = ["UNVERIFIED", "ORG_REVIEWED", "AUTHORIZED", "SUSPENDED", "BOGUS_STATUS"];
const EXPIRIES: Array<Date | null> = [null, day(1), day(-1)];

const seeded = await seedBusiness();

await test("Identity Assurance parity: assurancePermits and effectiveAssuranceStatus agree with enforceDisclosureAccess and effectiveStatus", async () => {
  for (const status of STATUSES) for (const expires of EXPIRIES) for (const scope of SCOPES) {
    const user = await seedRequester({ status, expires, scope });
    const row = await prisma.requesterAssurance.findUniqueOrThrow({ where: { userId: user.id } });
    const nowMs = Date.now();
    assert(assurance.effectiveStatus(row as never, new Date(nowMs)) === effectiveAssuranceStatus(row.status, row.authorizationExpiresAt?.toISOString() ?? null, nowMs), `effective status differs for ${status} ${expires?.toISOString()}`);
    for (const [label, fields, evidenceTypes] of ITEM_SETS) {
      const real = await realAllows(() => assurance.enforceDisclosureAccess({ id: user.id, role: "BUYER" }, fields, evidenceTypes, "ACCESS"));
      const mine = assurancePermits({ assuranceStatus: row.status, authorizationExpiresAt: row.authorizationExpiresAt?.toISOString() ?? null, authorizationScope: row.authorizationScope }, "CONSENT", { fields, evidenceTypes }, nowMs);
      checked += 1;
      assert(real === mine, `parity break: status=${status} expires=${expires?.toISOString() ?? null} scope=${JSON.stringify(scope)} items=${label}: real=${real} firewall=${mine}`);
    }
  }
});

await test("guest creation guard parity: HIGH scope without a registered requester", async () => {
  for (const [label, fields, evidenceTypes] of ITEM_SETS) {
    const requires = assurance.requiresIndependentAuthorization(fields, evidenceTypes);
    checked += 1;
    assert(assurancePermits(null, "GUEST_LINK", { fields, evidenceTypes }, Date.now()) === !requires, `guest guard differs for ${label}`);
    assert(assurancePermits(null, "CONSENT", { fields, evidenceTypes }, Date.now()) === false, "a consent always has a requester");
  }
});

await test("consent parity: firewall authorisation equals getTrustView for every lifecycle and assurance combination", async () => {
  const lifecycles: Array<[string, { status: string; expiresAt: Date | null; revokedAt?: Date | null; pinned: boolean }]> = [
    ["approved, live", { status: "APPROVED", expiresAt: day(5), pinned: true }], ["approved, no expiry", { status: "APPROVED", expiresAt: null, pinned: true }],
    ["approved but past expiry", { status: "APPROVED", expiresAt: day(-1), pinned: true }], ["pending", { status: "PENDING", expiresAt: null, pinned: true }],
    ["rejected", { status: "REJECTED", expiresAt: null, pinned: true }], ["revoked", { status: "REVOKED", expiresAt: day(5), revokedAt: day(-1), pinned: true }],
    ["marked expired", { status: "EXPIRED", expiresAt: day(-1), pinned: true }], ["approved but not pinned", { status: "APPROVED", expiresAt: day(5), pinned: false }]
  ];
  const requesters: Array<[string, AssuranceCase | null]> = [
    ["no assurance record", null], ["UNVERIFIED", { status: "UNVERIFIED", expires: null, scope: null }], ["ORG_REVIEWED", { status: "ORG_REVIEWED", expires: null, scope: null }],
    ["SUSPENDED", { status: "SUSPENDED", expires: null, scope: null }], ["AUTHORIZED, scope covers HIGH", { status: "AUTHORIZED", expires: day(30), scope: { fields: ["turnoverBand"], evidenceTypes: ["BANK_STATEMENT"] } }],
    ["AUTHORIZED, expired", { status: "AUTHORIZED", expires: day(-1), scope: { fields: ["turnoverBand"], evidenceTypes: ["BANK_STATEMENT"] } }], ["AUTHORIZED, scope too narrow", { status: "AUTHORIZED", expires: day(30), scope: { fields: ["address"], evidenceTypes: [] } }]
  ];
  for (const [lifeName, life] of lifecycles) for (const [reqName, spec] of requesters) for (const [itemName, fields, evidenceTypes] of ITEM_SETS) {
    const user = await seedRequester(spec);
    const consent = await prisma.consentRequest.create({ data: {
      requesterId: user.id, businessId: seeded.business.id, requestedFields: fields, requestedEvidenceTypes: evidenceTypes, approvedFields: fields, approvedEvidenceTypes: evidenceTypes,
      status: life.status as never, approvedAt: new Date(), expiresAt: life.expiresAt, revokedAt: life.revokedAt ?? null, approvedPassportId: life.pinned ? PASSPORT : null
    } });
    const real = await realAllows(() => trustViewService.getTrustView(user.id, consent.id));
    const assuranceRow = await prisma.requesterAssurance.findUnique({ where: { userId: user.id } });
    // The adapter reads the consent's current row, as getTrustView does after expireIfNeeded.
    const row = await prisma.consentRequest.findUniqueOrThrow({ where: { id: consent.id } });
    const mine = firewallAllows(seeded.snapshot, toContext(assuranceRow ?? { status: "UNVERIFIED", authorizationExpiresAt: null, authorizationScope: null }, {
      channel: "CONSENT", status: row.status, expiresAt: life.expiresAt?.toISOString() ?? null, revokedAt: life.revokedAt?.toISOString() ?? null, pinnedPassportId: row.approvedPassportId,
      approvedFields: row.approvedFields as string[], approvedEvidenceTypes: row.approvedEvidenceTypes as string[]
    }));
    checked += 1;
    assert(real === mine, `consent parity break: ${lifeName} / ${reqName} / ${itemName}: getTrustView=${real} firewall=${mine}`);
  }
});

await test("guest-link parity: firewall authorisation equals resolveGuest", async () => {
  const links: Array<[string, { status: string; expiresAt: Date; revokedAt: Date | null }]> = [
    ["active", { status: "ACTIVE", expiresAt: day(5), revokedAt: null }], ["expired", { status: "ACTIVE", expiresAt: day(-1), revokedAt: null }],
    ["revoked", { status: "REVOKED", expiresAt: day(5), revokedAt: day(-1) }]
  ];
  const requesters: Array<[string, AssuranceCase | null | "none"]> = [
    ["unregistered guest", "none"], ["linked UNVERIFIED", { status: "UNVERIFIED", expires: null, scope: null }], ["linked SUSPENDED", { status: "SUSPENDED", expires: null, scope: null }],
    ["linked AUTHORIZED", { status: "AUTHORIZED", expires: day(30), scope: { fields: ["turnoverBand"], evidenceTypes: ["BANK_STATEMENT"] } }]
  ];
  for (const [linkName, link] of links) for (const [reqName, spec] of requesters) for (const [itemName, fields, evidenceTypes] of ITEM_SETS) {
    const user = spec === "none" ? null : await seedRequester(spec);
    counter += 1;
    const token = `${"g".repeat(40)}${counter}${runId.replace(/[^A-Za-z0-9]/g, "")}`;
    await prisma.accessGrant.create({ data: {
      businessId: seeded.business.id, createdByUserId: seeded.business.userId, purpose: "Business verification", scopeJson: { fields, evidenceTypes }, requesterId: user?.id ?? null,
      passportId: PASSPORT, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: link.expiresAt, revokedAt: link.revokedAt, status: link.status as never
    } });
    const real = await realAllows(() => accessGrantService.resolveGuest(token));
    const assuranceRow = user ? await prisma.requesterAssurance.findUnique({ where: { userId: user.id } }) : null;
    const mine = firewallAllows(seeded.snapshot, toContext(assuranceRow, {
      channel: "GUEST_LINK", status: link.status === "REVOKED" ? "REVOKED" : "ACTIVE", expiresAt: link.expiresAt.toISOString(), revokedAt: link.revokedAt?.toISOString() ?? null,
      pinnedPassportId: PASSPORT, approvedFields: fields, approvedEvidenceTypes: evidenceTypes
    }));
    checked += 1;
    // Unregistered guests with HIGH scope cannot be created in the real system (creation guard), so redemption has no
    // canonical outcome for them; the firewall is deliberately stricter there.
    if (spec === "none" && assurance.requiresIndependentAuthorization(fields, evidenceTypes)) { assert(mine === false, "firewall must deny an unregistered guest with HIGH scope"); continue; }
    assert(real === mine, `guest parity break: ${linkName} / ${reqName} / ${itemName}: resolveGuest=${real} firewall=${mine}`);
  }
});

await prisma.$disconnect();
console.log(`\n${checked} parity comparisons executed.`);
if (failures) { console.error(`${failures} parity test(s) failed`); process.exit(1); }
console.log("All firewall parity tests passed.");
