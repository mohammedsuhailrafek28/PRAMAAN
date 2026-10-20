// Evidence Decision Firewall: unit and adversarial tests. No database and no network.
// Snapshots are produced by the REAL trust engine (runInternalCrossCheck) and the REAL snapshot composer/validator,
// so the firewall's policy tables are pinned to the engine's actual output.
import { readFileSync } from "node:fs";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "evidence-firewall-test-secret-0123456789";
process.env.DATABASE_URL = "file:./unused-firewall-tests.db";

const { runInternalCrossCheck } = await import("../src/modules/trustEngine/cross-check-engine.js");
const { composeGeneratedTrustProfile } = await import("../src/modules/trustEngine/trust-profile-composer.js");
const { buildEvidenceRecords, validateSnapshot, SNAPSHOT_SCHEMA_VERSION } = await import("../src/modules/passport/passport-snapshot.js");
const { DISCLOSURE_CATALOGUE } = await import("../src/utils/disclosureCatalogue.js");
const { evaluateConclusion } = await import("../src/modules/evidenceFirewall/evidence-firewall.js");
const { DEFAULT_FIREWALL_POLICY } = await import("../src/modules/evidenceFirewall/firewall-policy.js");
type FirewallInput = import("../src/modules/evidenceFirewall/firewall.types.js").FirewallInput;
type AuthorizationContext = import("../src/modules/evidenceFirewall/firewall.types.js").AuthorizationContext;
type ConclusionRequest = import("../src/modules/evidenceFirewall/firewall.types.js").ConclusionRequest;
type FirewallPolicy = import("../src/modules/evidenceFirewall/firewall.types.js").FirewallPolicy;

let failures = 0;
function test(name: string, run: () => void) {
  try { run(); console.log(`PASS ${name}`); } catch (error) { failures += 1; console.error(`FAIL ${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); }
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const same = (a: unknown, b: unknown, message: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${message}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const NOW = "2026-10-18T12:00:00.000Z";
const day = (offset: number, from = NOW) => new Date(Date.parse(from) + offset * 86400000).toISOString();
const PASSPORT = "passport-1";

type Doc = { id: string; docType: string; expiresInDays: number | null; revision?: number };
type World = { gstin?: string | null; pan?: string | null; orgName?: string; legalName?: string | null; udyam?: string | null; address?: string | null; turnoverBand?: string | null; docs?: Doc[] };

/** A real, validated schema-2 snapshot built by the production engine and composer. */
function buildSnapshot(world: World = {}, version = 3): any {
  const docs: Doc[] = world.docs ?? [{ id: "doc-gst", docType: "GST_CERTIFICATE", expiresInDays: 400 }, { id: "doc-udyam", docType: "UDYAM_CERTIFICATE", expiresInDays: 500 }];
  const now = new Date(NOW);
  const business: any = {
    id: "business-1", userId: "user-1", legalName: world.legalName === undefined ? "Sharma Textiles" : world.legalName,
    gstin: world.gstin === undefined ? "33ABCDE1234F1Z5" : world.gstin, udyamNumber: world.udyam === undefined ? "UDYAM-TN-33-1000001" : world.udyam,
    pan: world.pan === undefined ? "ABCDE1234F" : world.pan, address: world.address === undefined ? "12 Mill Road" : world.address,
    turnoverBand: world.turnoverBand === undefined ? "1-5Cr" : world.turnoverBand,
    user: { id: "user-1", name: "Asha Sharma", organizationName: world.orgName ?? "Sharma Textiles" },
    documents: docs.map((doc) => ({
      id: doc.id, businessId: "business-1", docType: doc.docType, filePath: `uploads/${doc.id}.pdf`, originalName: `${doc.id}.pdf`, mimeType: "application/pdf",
      evidenceStatus: "DOCUMENT_SUBMITTED", confidence: 0, source: "MSME_SUBMITTED", issuedAt: new Date(day(-100)),
      expiresAt: doc.expiresInDays === null ? null : new Date(day(doc.expiresInDays)), revision: doc.revision ?? 1, isCurrent: true, uploadedAt: new Date(day(-90))
    }))
  };
  const profile = runInternalCrossCheck(business, now);
  const snapshot = composeGeneratedTrustProfile({ profileId: PASSPORT, generatedAt: now, version, profile, evidence: buildEvidenceRecords(business.documents, profile), snapshotSchema: SNAPSHOT_SCHEMA_VERSION });
  validateSnapshot(snapshot, { profileId: PASSPORT, businessId: "business-1", version });
  return JSON.parse(JSON.stringify(snapshot));
}

const LOW_FIELDS = ["legalBusinessName", "ownerName", "gstin", "udyamNumber", "address"];
function grant(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    channel: "CONSENT", status: "APPROVED", expiresAt: day(7), revokedAt: null, pinnedPassportId: PASSPORT,
    approvedFields: LOW_FIELDS, approvedEvidenceTypes: ["GST_CERTIFICATE", "UDYAM_CERTIFICATE"],
    requester: { assuranceStatus: "ORG_REVIEWED", authorizationExpiresAt: null, authorizationScope: null }, ...overrides
  };
}
const supported = (field: string): ConclusionRequest => ({ kind: "FIELD_SUPPORTED_BY_EVIDENCE", field });
const noConflict = (field: string): ConclusionRequest => ({ kind: "FIELD_NOT_CONTRADICTED", field });
const current = (docType: string): ConclusionRequest => ({ kind: "EVIDENCE_CURRENT", docType });
function run(request: ConclusionRequest, options: { snapshot?: unknown; authorization?: AuthorizationContext; now?: string; policy?: FirewallPolicy; id?: string } = {}) {
  const input: FirewallInput = { snapshot: "snapshot" in options ? options.snapshot : buildSnapshot(), snapshotPassportId: options.id ?? PASSPORT, authorization: "authorization" in options ? options.authorization as AuthorizationContext : grant(), request, now: "now" in options ? options.now as string : NOW };
  return options.policy ? evaluateConclusion(input, options.policy) : evaluateConclusion(input);
}
const expect = (decision: ReturnType<typeof run>, verdict: string, reasonCode: string, label: string) => assert(decision.verdict === verdict && decision.reasonCode === reasonCode, `${label}: got ${decision.verdict}/${decision.reasonCode}, wanted ${verdict}/${reasonCode}`);
const UNAVAILABLE = ["INSUFFICIENT_EVIDENCE", "CONFIRMATION_UNAVAILABLE"] as const;
const DENIED = ["NOT_DISCLOSABLE", "NOT_DISCLOSABLE"] as const;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------- pinned to the real engine
test("policy: the fixture really is a validated schema-2 snapshot from the production engine", () => {
  const snapshot = buildSnapshot();
  assert(snapshot.snapshotSchema === 2 && Array.isArray(snapshot.evidence) && snapshot.evidence.length === 2, "schema 2 with embedded evidence");
  assert(snapshot.sourceVerificationPerformed === false, "no source verification");
});

test("policy: every disclosable field the engine backs with a document is in fieldEvidence, with the right type", () => {
  const snapshot = buildSnapshot();
  const documentTypeOf = new Map<string, string>(snapshot.evidence.map((record: any) => [record.documentId, record.docType]));
  for (const entry of snapshot.fieldConfidence) {
    const hasDocumentCheck = entry.checks.some((check: any) => check.type === "SUPPORTING_DOCUMENT");
    const disclosable = DISCLOSURE_CATALOGUE.some((item) => item.kind === "FIELD" && item.key === entry.field);
    if (disclosable) assert(hasDocumentCheck === Object.prototype.hasOwnProperty.call(DEFAULT_FIREWALL_POLICY.fieldEvidence, entry.field), `${entry.field}: document-backed iff in policy`);
    if (hasDocumentCheck && disclosable) {
      for (const id of entry.evidenceIds) assert((DEFAULT_FIREWALL_POLICY.fieldEvidence[entry.field] as readonly string[]).includes(documentTypeOf.get(id) as string), `${entry.field} cites an unexpected type`);
    }
  }
});

test("policy: every contradiction the engine can record is classified by the policy table", () => {
  const both = buildSnapshot({ pan: "ZZZZZ9999Z", orgName: "Different Org Ltd" });
  const fields = both.contradictions.map((item: any) => item.field).sort();
  assert(fields.join() === "businessName,pan", `engine emitted ${fields.join()}`);
  for (const field of fields) assert(Object.prototype.hasOwnProperty.call(DEFAULT_FIREWALL_POLICY.contradictionInvolves, field), `${field} is unclassified`);
});

// ---------------------------------------------------------------- verdict behaviour
test("healthy claim: SUPPORTED internally, for claim, no-conflict and evidence conclusions", () => {
  expect(run(supported("gstin")), "SUPPORTED", "SUPPORTED_INTERNALLY", "gstin");
  expect(run(supported("udyamNumber")), "SUPPORTED", "SUPPORTED_INTERNALLY", "udyam");
  expect(run(noConflict("legalBusinessName")), "SUPPORTED", "NO_RECORDED_CONFLICT", "name");
  expect(run(current("GST_CERTIFICATE")), "SUPPORTED", "EVIDENCE_UNEXPIRED", "GST current");
  const decision = run(supported("gstin"));
  assert(decision.snapshotVersion === 3 && decision.basis === "SNAPSHOT_SCHEMA_2" && decision.scopeLimited === true, "decision metadata");
  assert(/No external source was consulted/.test(decision.limitations.join(" ")), "limitation always stated");
});

test("a claim with no document mapping can never be SUPPORTED_BY_EVIDENCE", () => {
  expect(run(supported("address")), "INSUFFICIENT_EVIDENCE", "NO_EVIDENCE_MAPPING", "address");
  expect(run(supported("ownerName")), "INSUFFICIENT_EVIDENCE", "NO_EVIDENCE_MAPPING", "owner");
  expect(run(noConflict("address")), "SUPPORTED", "NO_RECORDED_CONFLICT", "address has no conflict");
});

test("claim not provided", () => {
  expect(run(supported("udyamNumber"), { snapshot: buildSnapshot({ udyam: null }) }), "INSUFFICIENT_EVIDENCE", "CLAIM_NOT_PROVIDED", "udyam");
  expect(run(noConflict("address"), { snapshot: buildSnapshot({ address: "  " }) }), "INSUFFICIENT_EVIDENCE", "CLAIM_NOT_PROVIDED", "blank address");
});

test("evidence expired at assessment, expired since assessment, and missing", () => {
  const expired = buildSnapshot({ docs: [{ id: "doc-gst", docType: "GST_CERTIFICATE", expiresInDays: -5 }, { id: "doc-udyam", docType: "UDYAM_CERTIFICATE", expiresInDays: 500 }] });
  expect(run(supported("gstin"), { snapshot: expired }), "INSUFFICIENT_EVIDENCE", "EVIDENCE_EXPIRED", "expired at assessment");
  expect(run(current("GST_CERTIFICATE"), { snapshot: expired }), "INSUFFICIENT_EVIDENCE", "EVIDENCE_EXPIRED", "evidence conclusion");
  const soon = buildSnapshot({ docs: [{ id: "doc-gst", docType: "GST_CERTIFICATE", expiresInDays: 10 }, { id: "doc-udyam", docType: "UDYAM_CERTIFICATE", expiresInDays: 500 }] });
  const longGrant = grant({ expiresAt: day(90) });
  expect(run(supported("gstin"), { snapshot: soon, now: day(5), authorization: longGrant }), "SUPPORTED", "SUPPORTED_INTERNALLY", "still current");
  expect(run(supported("gstin"), { snapshot: soon, now: day(30), authorization: longGrant }), "INSUFFICIENT_EVIDENCE", "EVIDENCE_EXPIRED", "expired since assessment");
  expect(run(supported("gstin"), { snapshot: soon, now: day(10), authorization: longGrant }), "INSUFFICIENT_EVIDENCE", "EVIDENCE_EXPIRED", "expiry instant counts as expired");
  const none = buildSnapshot({ docs: [{ id: "doc-udyam", docType: "UDYAM_CERTIFICATE", expiresInDays: 500 }] });
  expect(run(supported("gstin"), { snapshot: none }), "INSUFFICIENT_EVIDENCE", "EVIDENCE_MISSING", "no GST document");
  expect(run(current("GST_CERTIFICATE"), { snapshot: none }), "INSUFFICIENT_EVIDENCE", "EVIDENCE_MISSING", "no GST document, evidence conclusion");
});

test("a current revision supports the claim even if an older revision of the same type expired", () => {
  const snapshot = buildSnapshot({ docs: [{ id: "doc-gst-old", docType: "GST_CERTIFICATE", expiresInDays: -30, revision: 1 }, { id: "doc-gst", docType: "GST_CERTIFICATE", expiresInDays: 300, revision: 2 }] });
  expect(run(supported("gstin"), { snapshot }), "SUPPORTED", "SUPPORTED_INTERNALLY", "mirrors the engine's 'some current document' rule");
});

test("D1: a hidden contradiction withholds a positive conclusion, with no detail", () => {
  const pan = buildSnapshot({ pan: "ZZZZZ9999Z" });
  for (const request of [supported("gstin"), noConflict("gstin")]) expect(run(request, { snapshot: pan }), ...UNAVAILABLE, `gstin ${request.kind}`);
  expect(run(supported("udyamNumber"), { snapshot: pan }), "SUPPORTED", "SUPPORTED_INTERNALLY", "unrelated claim is unaffected");
  const org = buildSnapshot({ orgName: "Different Org Ltd" });
  expect(run(noConflict("legalBusinessName"), { snapshot: org }), ...UNAVAILABLE, "name conflict withheld");
  expect(run(supported("gstin"), { snapshot: org }), "SUPPORTED", "SUPPORTED_INTERNALLY", "gstin is not involved in the name conflict");
  const text = JSON.stringify(run(supported("gstin"), { snapshot: pan }));
  assert(!/ZZZZZ|ABCDE|pan|conflict|Different Org/i.test(text), `no conflict detail in ${text}`);
});

test("a visible contradiction (every involved item authorised) is CONTRADICTED and beats other findings", () => {
  const policy: FirewallPolicy = { ...DEFAULT_FIREWALL_POLICY, contradictionInvolves: { ...DEFAULT_FIREWALL_POLICY.contradictionInvolves, pan: [{ kind: "FIELD", key: "gstin" }, { kind: "FIELD", key: "udyamNumber" }] } };
  const snapshot = buildSnapshot({ pan: "ZZZZZ9999Z" });
  expect(run(supported("gstin"), { snapshot, policy }), "CONTRADICTED", "RECORDED_CONFLICT", "visible");
  expect(run(noConflict("udyamNumber"), { snapshot, policy }), "CONTRADICTED", "RECORDED_CONFLICT", "this policy also involves udyamNumber");
  expect(run(noConflict("address"), { snapshot, policy }), "SUPPORTED", "NO_RECORDED_CONFLICT", "an uninvolved claim is unaffected");
  const narrowed = grant({ approvedFields: ["gstin"] });
  expect(run(supported("gstin"), { snapshot, policy, authorization: narrowed }), ...UNAVAILABLE, "a partner field outside scope makes it hidden, not visible");
  const expiredToo = buildSnapshot({ pan: "ZZZZZ9999Z", docs: [{ id: "doc-gst", docType: "GST_CERTIFICATE", expiresInDays: -5 }] });
  expect(run(supported("gstin"), { snapshot: expiredToo, policy }), "CONTRADICTED", "RECORDED_CONFLICT", "a visible conflict outranks expiry");
});

test("a visible, truthful insufficiency is reported before a hidden conflict is withheld", () => {
  const snapshot = buildSnapshot({ pan: "ZZZZZ9999Z", docs: [{ id: "doc-gst", docType: "GST_CERTIFICATE", expiresInDays: -5 }] });
  expect(run(supported("gstin"), { snapshot }), "INSUFFICIENT_EVIDENCE", "EVIDENCE_EXPIRED", "expired evidence is the stated cause");
});

test("the withheld-conflict code is shared with unrelated inconclusive causes (it is not unique to hidden conflicts)", () => {
  const hidden = run(supported("gstin"), { snapshot: buildSnapshot({ pan: "ZZZZZ9999Z" }) });
  const anomaly = buildSnapshot();
  anomaly.fieldConfidence.find((entry: any) => entry.field === "gstin").checks.push({ type: "SOME_FUTURE_CHECK", result: "MAYBE", reason: "x" });
  const inconclusive = run(supported("gstin"), { snapshot: anomaly });
  same(hidden, inconclusive, "indistinguishable decisions");
  const unsuitable = run(supported("gstin"), { snapshot: { snapshotSchema: 2 } });
  same({ ...hidden, snapshotVersion: null }, unsuitable, "also indistinguishable from an unsuitable snapshot");
});

test("an unclassifiable contradiction fails closed for every positive conclusion", () => {
  const snapshot = buildSnapshot();
  snapshot.contradictions.push({ field: "futureConflict", severity: "LOW", reason: "x", claimedValue: null, evidenceValues: [] });
  for (const request of [supported("gstin"), noConflict("address"), current("GST_CERTIFICATE")]) expect(run(request, { snapshot }), ...UNAVAILABLE, request.kind);
  const expired = buildSnapshot({ docs: [{ id: "doc-gst", docType: "GST_CERTIFICATE", expiresInDays: -5 }] });
  expired.contradictions.push({ field: "futureConflict", severity: "LOW", reason: "x", claimedValue: null, evidenceValues: [] });
  expect(run(supported("gstin"), { snapshot: expired }), "INSUFFICIENT_EVIDENCE", "EVIDENCE_EXPIRED", "visible cause still wins");
});

test("a field's own recorded consistency failure is a hidden conflict", () => {
  const snapshot = buildSnapshot();
  const entry = snapshot.fieldConfidence.find((item: any) => item.field === "address");
  entry.checks.push({ type: "INTERNAL_CONSISTENCY", result: "FAILED", reason: "x" });
  expect(run(noConflict("address"), { snapshot }), ...UNAVAILABLE, "withheld");
});

test("decisions carry only the closed output shape and never echo values, ids or counts", () => {
  const decision = run(supported("gstin"));
  assert(Object.keys(decision).sort().join() === "basis,limitations,reasonCode,scopeLimited,snapshotVersion,verdict", `keys: ${Object.keys(decision)}`);
  const text = JSON.stringify([decision, run(supported("udyamNumber")), run(current("GST_CERTIFICATE")), run(noConflict("legalBusinessName"))]);
  assert(!/33ABCDE|UDYAM-TN|Sharma|doc-gst|doc-udyam|business-1|user-1|MSME_SUBMITTED|\b45\b/.test(text), `leaked: ${text}`);
});

// ---------------------------------------------------------------- authorization
test("authorization: only a live, unexpired, unrevoked, correctly pinned grant discloses anything", () => {
  for (const status of ["PENDING", "REJECTED", "REVOKED", "EXPIRED", "approved", "", "ACTIVE"]) expect(run(supported("gstin"), { authorization: grant({ status }) }), ...DENIED, `consent ${status}`);
  expect(run(supported("gstin"), { authorization: grant({ expiresAt: NOW }) }), ...DENIED, "expires exactly now");
  expect(run(supported("gstin"), { authorization: grant({ expiresAt: day(-1) }) }), ...DENIED, "expired");
  expect(run(supported("gstin"), { authorization: grant({ expiresAt: new Date(Date.parse(NOW) + 1).toISOString() }) }), "SUPPORTED", "SUPPORTED_INTERNALLY", "one millisecond left");
  expect(run(supported("gstin"), { authorization: grant({ expiresAt: "not a date" }) }), ...DENIED, "unparsable expiry");
  expect(run(supported("gstin"), { authorization: grant({ expiresAt: null }) }), "SUPPORTED", "SUPPORTED_INTERNALLY", "consent without expiry does not expire (canonical)");
  expect(run(supported("gstin"), { authorization: grant({ revokedAt: day(-1) }) }), ...DENIED, "revoked");
  expect(run(supported("gstin"), { authorization: grant({ pinnedPassportId: null }) }), ...DENIED, "no pin");
  expect(run(supported("gstin"), { authorization: grant({ pinnedPassportId: "passport-0" }) }), ...DENIED, "old consent replayed against a newer snapshot");
  expect(run(supported("gstin"), { id: "passport-2" }), ...DENIED, "snapshot is not the pinned one");
});

test("authorization: guest links", () => {
  const guest = grant({ channel: "GUEST_LINK", status: "ACTIVE", requester: null });
  expect(run(supported("gstin"), { authorization: guest }), "SUPPORTED", "SUPPORTED_INTERNALLY", "active guest link, LOW scope");
  expect(run(supported("gstin"), { authorization: { ...guest, status: "APPROVED" } }), ...DENIED, "consent status on a guest link");
  expect(run(supported("gstin"), { authorization: { ...guest, status: "REVOKED" } }), ...DENIED, "revoked");
  expect(run(supported("gstin"), { authorization: { ...guest, expiresAt: null } }), ...DENIED, "a guest link must have an expiry");
  expect(run(supported("gstin"), { authorization: { ...guest, approvedFields: [...LOW_FIELDS, "turnoverBand"] } }), ...DENIED, "HIGH scope needs a registered requester");
  expect(run(supported("gstin"), { authorization: grant({ requester: null }) }), ...DENIED, "a consent with no requester");
});

test("D2: a field conclusion needs the field AND every supporting evidence type; evidence conclusions need the type", () => {
  expect(run(supported("gstin"), { authorization: grant({ approvedEvidenceTypes: ["UDYAM_CERTIFICATE"] }) }), ...DENIED, "field without its evidence type");
  expect(run(supported("gstin"), { authorization: grant({ approvedFields: ["address"] }) }), ...DENIED, "evidence type without the field");
  expect(run(noConflict("gstin"), { authorization: grant({ approvedEvidenceTypes: [] }) }), "SUPPORTED", "NO_RECORDED_CONFLICT", "a no-conflict claim depends on no evidence type");
  expect(run(current("GST_CERTIFICATE"), { authorization: grant({ approvedEvidenceTypes: ["UDYAM_CERTIFICATE"] }) }), ...DENIED, "evidence type missing");
  expect(run(current("GST_CERTIFICATE"), { authorization: grant({ approvedFields: [] }) }), "SUPPORTED", "EVIDENCE_UNEXPIRED", "evidence conclusion needs no field");
  expect(run(supported("address"), { authorization: grant({ approvedEvidenceTypes: [] }) }), "INSUFFICIENT_EVIDENCE", "NO_EVIDENCE_MAPPING", "no mapping, so no evidence type is required");
});

test("authorization: unknown, malformed or out-of-catalogue requests are not disclosable", () => {
  const requests: unknown[] = [
    { kind: "FIELD_SUPPORTED_BY_EVIDENCE", field: "pan" }, { kind: "FIELD_SUPPORTED_BY_EVIDENCE", field: "bankAccount" }, { kind: "FIELD_SUPPORTED_BY_EVIDENCE", field: "__proto__" },
    { kind: "FIELD_SUPPORTED_BY_EVIDENCE", field: "constructor" }, { kind: "FIELD_SUPPORTED_BY_EVIDENCE", field: "GST_CERTIFICATE" }, { kind: "EVIDENCE_CURRENT", docType: "gstin" },
    { kind: "EVIDENCE_CURRENT", docType: "PAN_CARD" }, { kind: "EVIDENCE_CURRENT" }, { kind: "ANYTHING" }, { kind: "FIELD_NOT_CONTRADICTED", field: 7 }, {}, null, undefined, "gstin", 5
  ];
  for (const request of requests) expect(run(request as ConclusionRequest, { authorization: grant({ approvedFields: [...LOW_FIELDS, "pan", "bankAccount", "__proto__", "constructor", "GST_CERTIFICATE"], approvedEvidenceTypes: ["GST_CERTIFICATE", "UDYAM_CERTIFICATE", "gstin", "PAN_CARD"] }) }), ...DENIED, JSON.stringify(request));
});

test("authorization parity rules: suspension, HIGH items over the FULL scope, expiry and scope coverage", () => {
  const high = [...LOW_FIELDS, "turnoverBand"];
  const authorised = (extra: object = {}) => ({ assuranceStatus: "AUTHORIZED", authorizationExpiresAt: day(30), authorizationScope: { fields: ["turnoverBand"], evidenceTypes: [] }, ...extra });
  expect(run(supported("gstin"), { authorization: grant({ requester: { assuranceStatus: "SUSPENDED", authorizationExpiresAt: null, authorizationScope: null } }) }), ...DENIED, "suspended, LOW scope");
  expect(run(supported("gstin"), { authorization: grant({ approvedFields: high }) }), ...DENIED, "a HIGH item elsewhere in the grant denies the whole grant (canonical full-scope enforcement)");
  expect(run(supported("gstin"), { authorization: grant({ approvedFields: high, requester: authorised() }) }), "SUPPORTED", "SUPPORTED_INTERNALLY", "AUTHORIZED with matching scope");
  expect(run(supported("gstin"), { authorization: grant({ approvedFields: high, requester: authorised({ authorizationExpiresAt: day(-1) }) }) }), ...DENIED, "authorization expired");
  expect(run(supported("gstin"), { authorization: grant({ approvedFields: high, requester: authorised({ authorizationExpiresAt: NOW }) }) }), ...DENIED, "authorization expires exactly now");
  expect(run(supported("gstin"), { authorization: grant({ approvedFields: high, requester: authorised({ authorizationScope: { fields: ["address"], evidenceTypes: [] } }) }) }), ...DENIED, "scope does not cover the HIGH item");
  for (const scope of [null, [], "turnoverBand", 5, { fields: "turnoverBand" }, { fields: [7] }]) expect(run(supported("gstin"), { authorization: grant({ approvedFields: high, requester: authorised({ authorizationScope: scope }) }) }), ...DENIED, `malformed scope ${JSON.stringify(scope)}`);
  expect(run(supported("gstin"), { authorization: grant({ approvedFields: high, requester: authorised({ authorizationExpiresAt: "garbage" }) }) }), ...DENIED, "unparsable authorization expiry fails closed");
  expect(run(supported("gstin"), { authorization: grant({ approvedEvidenceTypes: ["GST_CERTIFICATE", "BANK_STATEMENT"] }) }), ...DENIED, "a HIGH evidence type elsewhere in the grant");
  expect(run(supported("gstin"), { authorization: grant({ requester: { assuranceStatus: "WHATEVER", authorizationExpiresAt: null, authorizationScope: null } }) }), "SUPPORTED", "SUPPORTED_INTERNALLY", "an unknown status behaves as UNVERIFIED: LOW items are allowed");
  expect(run(supported("gstin"), { authorization: grant({ approvedFields: high, requester: { assuranceStatus: "WHATEVER", authorizationExpiresAt: null, authorizationScope: null } }) }), ...DENIED, "an unknown status cannot open HIGH items");
});

test("authorization never depends on the snapshot: denial is identical for healthy and garbage snapshots", () => {
  const denied = grant({ status: "REVOKED" });
  const garbage: unknown[] = [buildSnapshot(), null, "x", { snapshotSchema: 2 }, buildSnapshot({ pan: "ZZZZZ9999Z" })];
  const results = garbage.map((snapshot) => JSON.stringify(run(supported("gstin"), { snapshot, authorization: denied })));
  assert(new Set(results).size === 1, "denial depends on the snapshot");
});

// ---------------------------------------------------------------- snapshot suitability
test("snapshot suitability: only a present schema marker equal to 2 is accepted; documents[] is never a fallback", () => {
  const base = buildSnapshot();
  for (const marker of [null, undefined, "2", 1, 3, 99, 0, true, [2], {}, NaN]) {
    const snapshot = clone(base);
    snapshot.snapshotSchema = marker;
    expect(run(supported("gstin"), { snapshot }), ...UNAVAILABLE, `marker ${String(marker)}`);
  }
  const legacy = clone(base);
  delete legacy.snapshotSchema;
  expect(run(supported("gstin"), { snapshot: legacy }), ...UNAVAILABLE, "genuine legacy snapshot is never trusted for a positive conclusion");
  expect(run(current("GST_CERTIFICATE"), { snapshot: legacy }), ...UNAVAILABLE, "legacy, evidence conclusion");
  const noEvidence = clone(base);
  delete noEvidence.evidence;
  expect(run(supported("gstin"), { snapshot: noEvidence }), ...UNAVAILABLE, "schema 2 without evidence[] does not fall back to documents[]");
  const emptyEvidence = clone(base);
  emptyEvidence.evidence = [];
  expect(run(supported("gstin"), { snapshot: emptyEvidence }), ...UNAVAILABLE, "schema 2 with empty evidence[]: dangling reference");
});

test("snapshot suitability: malformed shapes fail closed", () => {
  const mutations: Array<[string, (snapshot: any) => void]> = [
    ["wrong profileId", (s) => { s.profileId = "passport-9"; }], ["no version", (s) => { delete s.version; }], ["fractional version", (s) => { s.version = 1.5; }],
    ["bad lastCalculatedAt", (s) => { s.lastCalculatedAt = "yesterday"; }], ["sourceVerificationPerformed true", (s) => { s.sourceVerificationPerformed = true; }],
    ["fieldConfidence not an array", (s) => { s.fieldConfidence = {}; }], ["contradictions missing", (s) => { delete s.contradictions; }],
    ["evidence record not an object", (s) => { s.evidence.push("x"); }], ["evidence bad checkedAt", (s) => { s.evidence[0].checkedAt = "x"; }],
    ["evidence bad expiresAt", (s) => { s.evidence[0].expiresAt = "x"; }], ["evidence expiresAt undefined", (s) => { s.evidence[0].expiresAt = undefined; }],
    ["evidence unknown status", (s) => { s.evidence[0].evidenceStatus = "VERIFIED_BY_BANK"; }], ["duplicate evidence id", (s) => { s.evidence.push(clone(s.evidence[0])); }],
    ["evidence checks malformed", (s) => { s.evidence[0].checks = [null]; }], ["field entry malformed", (s) => { s.fieldConfidence.push(7); }],
    ["duplicate field entry", (s) => { s.fieldConfidence.push(clone(s.fieldConfidence[0])); }], ["field unknown status", (s) => { s.fieldConfidence[0].status = "GOLD"; }],
    ["evidenceIds not strings", (s) => { s.fieldConfidence[2].evidenceIds = [7]; }], ["contradiction without field", (s) => { s.contradictions.push({ severity: "LOW" }); }]
  ];
  for (const [name, mutate] of mutations) {
    const snapshot = buildSnapshot();
    mutate(snapshot);
    for (const request of [supported("gstin"), noConflict("legalBusinessName"), current("GST_CERTIFICATE")]) expect(run(request, { snapshot }), ...UNAVAILABLE, `${name} / ${request.kind}`);
  }
  for (const garbage of [null, undefined, 0, "", "x", [], [1], true, () => 1]) expect(run(supported("gstin"), { snapshot: garbage }), ...UNAVAILABLE, `snapshot ${typeof garbage}`);
});

test("unknown or inconsistent evidence fails closed", () => {
  const dangling = buildSnapshot();
  dangling.fieldConfidence.find((e: any) => e.field === "gstin").evidenceIds.push("doc-ghost");
  expect(run(supported("gstin"), { snapshot: dangling }), ...UNAVAILABLE, "dangling evidence id");
  const wrongType = buildSnapshot();
  wrongType.fieldConfidence.find((e: any) => e.field === "gstin").evidenceIds = ["doc-udyam"];
  expect(run(supported("gstin"), { snapshot: wrongType }), ...UNAVAILABLE, "gstin citing the Udyam record");
  const unknownOutcome = buildSnapshot();
  unknownOutcome.fieldConfidence.find((e: any) => e.field === "gstin").checks.push({ type: "SOURCE_VERIFICATION", result: "PASSED", reason: "forged" });
  expect(run(supported("gstin"), { snapshot: unknownOutcome }), ...UNAVAILABLE, "a PASSED SOURCE_VERIFICATION check is impossible provenance and makes the snapshot unsuitable");
  const sourceVerified = buildSnapshot();
  sourceVerified.fieldConfidence.find((e: any) => e.field === "gstin").status = "SOURCE_VERIFIED";
  expect(run(supported("gstin"), { snapshot: sourceVerified }), ...UNAVAILABLE, "the engine never produces SOURCE_VERIFIED; a forged one is not affirmed");
  const failedCheck = buildSnapshot();
  failedCheck.fieldConfidence.find((e: any) => e.field === "gstin").checks.push({ type: "SOMETHING_NEW", result: "FAILED", reason: "x" });
  expect(run(supported("gstin"), { snapshot: failedCheck }), ...UNAVAILABLE, "unclassified failure");
  const badFormat = run(supported("gstin"), { snapshot: buildSnapshot({ gstin: "NOT-A-GSTIN" }) });
  assert(badFormat.verdict !== "SUPPORTED", "an invalid GSTIN is never supported");
  const rejectedEvidence = buildSnapshot();
  rejectedEvidence.evidence.find((r: any) => r.documentId === "doc-gst").evidenceStatus = "REJECTED";
  expect(run(supported("gstin"), { snapshot: rejectedEvidence }), "INSUFFICIENT_EVIDENCE", "EVIDENCE_MISSING", "rejected evidence supports nothing");
});

test("documents[] cannot influence a schema-2 decision", () => {
  const base = buildSnapshot();
  const tampered = clone(base);
  tampered.documentConfidence = [{ documentId: "doc-gst", documentType: "GST_CERTIFICATE", status: "SOURCE_VERIFIED", confidence: 100, reason: "forged", checks: [] }, { documentId: "doc-ghost", documentType: "GST_CERTIFICATE", status: "CROSS_CHECKED", confidence: 99, reason: "x", checks: [] }];
  for (const request of [supported("gstin"), supported("udyamNumber"), current("GST_CERTIFICATE"), noConflict("address")]) same(run(request, { snapshot: tampered }), run(request, { snapshot: base }), request.kind);
  const missing = buildSnapshot({ docs: [{ id: "doc-udyam", docType: "UDYAM_CERTIFICATE", expiresInDays: 500 }] });
  missing.documentConfidence.push({ documentId: "doc-x", documentType: "GST_CERTIFICATE", status: "CROSS_CHECKED", confidence: 45, reason: "x", checks: [] });
  expect(run(current("GST_CERTIFICATE"), { snapshot: missing }), "INSUFFICIENT_EVIDENCE", "EVIDENCE_MISSING", "a document assessment is not an embedded evidence record");
});

// ---------------------------------------------------------------- remediation 1: strict authorization shape
const AUTH_KEYS = ["channel", "status", "expiresAt", "revokedAt", "pinnedPassportId", "approvedFields", "approvedEvidenceTypes", "requester"] as const;
const guestGrant = (overrides: Partial<AuthorizationContext> = {}): AuthorizationContext => grant({ channel: "GUEST_LINK", status: "ACTIVE", requester: null, ...overrides });
const without = (value: object, key: string) => { const copy: any = { ...value }; delete copy[key]; return copy as AuthorizationContext; };

test("REPRO: a consent whose revokedAt or expiresAt property is missing used to be treated as live and unexpired", () => {
  // Before the fix these were SUPPORTED: a missing property was read as null ("not revoked", "never expires").
  expect(run(supported("gstin"), { authorization: without(grant(), "revokedAt") }), ...DENIED, "revokedAt property missing");
  expect(run(supported("gstin"), { authorization: without(grant(), "expiresAt") }), ...DENIED, "expiresAt property missing");
  expect(run(supported("gstin"), { authorization: { ...grant(), revokedAt: undefined } as never }), ...DENIED, "revokedAt: undefined");
  expect(run(supported("gstin"), { authorization: { ...grant(), expiresAt: undefined } as never }), ...DENIED, "expiresAt: undefined");
  expect(run(supported("gstin"), { authorization: without(guestGrant(), "requester") }), ...DENIED, "guest link with the requester property missing");
  expect(run(supported("gstin"), { authorization: { ...guestGrant(), requester: undefined } as never }), ...DENIED, "guest link with requester: undefined");
});

test("every authorisation property must be an explicit own property", () => {
  for (const channelGrant of [grant, guestGrant]) for (const key of AUTH_KEYS) {
    expect(run(supported("gstin"), { authorization: without(channelGrant(), key) }), ...DENIED, `${channelGrant === grant ? "consent" : "guest"} missing ${key}`);
    expect(run(supported("gstin"), { authorization: { ...channelGrant(), [key]: undefined } as never }), ...DENIED, `undefined ${key}`);
  }
  const inherited = Object.create(grant()) as AuthorizationContext;
  expect(run(supported("gstin"), { authorization: inherited }), ...DENIED, "inherited properties are not explicit");
  for (const bad of [null, undefined, [], "x", 1, () => 1]) expect(run(supported("gstin"), { authorization: bad as never }), ...DENIED, `authorization ${typeof bad}`);
});

test("expiresAt and revokedAt accept only null or a full ISO instant, with channel-specific meaning", () => {
  const malformed: unknown[] = ["", " ", "2026", "2026-10-20", "2026-10-20T12:00:00", "20 Oct 2026", "10/20/2026", "tomorrow", "not a date", "2027-13-45T00:00:00Z", 0, 1, 1792000000000, -1, true, false, {}, [], ["2027-01-01T00:00:00Z"], NaN, Infinity, new Date(day(5))];
  for (const bad of malformed) {
    expect(run(supported("gstin"), { authorization: { ...grant(), expiresAt: bad } as never }), ...DENIED, `consent expiresAt ${String(bad)}`);
    expect(run(supported("gstin"), { authorization: { ...guestGrant(), expiresAt: bad } as never }), ...DENIED, `guest expiresAt ${String(bad)}`);
    expect(run(supported("gstin"), { authorization: { ...grant(), revokedAt: bad } as never }), ...DENIED, `consent revokedAt ${String(bad)}`);
    expect(run(supported("gstin"), { authorization: { ...guestGrant(), revokedAt: bad } as never }), ...DENIED, `guest revokedAt ${String(bad)}`);
  }
  for (const valid of ["2027-01-01T00:00:00Z", "2027-01-01T00:00:00.123Z", "2027-01-01T05:30:00+05:30", day(3)]) {
    expect(run(supported("gstin"), { authorization: grant({ expiresAt: valid }) }), "SUPPORTED", "SUPPORTED_INTERNALLY", `consent expiresAt ${valid}`);
    expect(run(supported("gstin"), { authorization: guestGrant({ expiresAt: valid }) }), "SUPPORTED", "SUPPORTED_INTERNALLY", `guest expiresAt ${valid}`);
  }
  expect(run(supported("gstin"), { authorization: grant({ expiresAt: null }) }), "SUPPORTED", "SUPPORTED_INTERNALLY", "a consent may legitimately never expire (explicit null)");
  expect(run(supported("gstin"), { authorization: guestGrant({ expiresAt: null }) }), ...DENIED, "a guest link always expires");
  for (const revoked of [day(-1), "2027-01-01T00:00:00Z", NOW]) {
    expect(run(supported("gstin"), { authorization: grant({ revokedAt: revoked }) }), ...DENIED, "consent revokedAt must be null");
    expect(run(supported("gstin"), { authorization: guestGrant({ revokedAt: revoked }) }), ...DENIED, "guest revokedAt must be null");
  }
});

test("the evaluation instant is a strict ISO instant too", () => {
  for (const bad of ["2026-10-20", "yesterday", "", undefined, null, 5, NaN]) expect(run(supported("gstin"), { now: bad as never }), ...DENIED, `now ${String(bad)}`);
});

test("the requester assurance record must be explicit as well: a missing authorizationExpiresAt is not 'no expiry'", () => {
  const high = [...LOW_FIELDS, "turnoverBand"];
  const record = { assuranceStatus: "AUTHORIZED", authorizationExpiresAt: day(30), authorizationScope: { fields: ["turnoverBand"], evidenceTypes: [] } };
  expect(run(supported("gstin"), { authorization: grant({ approvedFields: high, requester: record }) }), "SUPPORTED", "SUPPORTED_INTERNALLY", "complete record");
  for (const key of ["assuranceStatus", "authorizationExpiresAt", "authorizationScope"]) {
    expect(run(supported("gstin"), { authorization: grant({ approvedFields: high, requester: without(record, key) as never }) }), ...DENIED, `HIGH scope, missing ${key}`);
    expect(run(supported("gstin"), { authorization: grant({ requester: without({ assuranceStatus: "ORG_REVIEWED", authorizationExpiresAt: null, authorizationScope: null }, key) as never }) }), ...DENIED, `LOW scope, missing ${key}`);
  }
  expect(run(supported("gstin"), { authorization: grant({ requester: [] as never }) }), ...DENIED, "requester is an array");
  expect(run(supported("gstin"), { authorization: grant({ requester: "x" as never }) }), ...DENIED, "requester is a string");
  expect(run(supported("gstin"), { authorization: grant({ requester: { assuranceStatus: "ORG_REVIEWED", authorizationExpiresAt: "garbage", authorizationScope: null } }) }), ...DENIED, "malformed assurance expiry");
});

// ---------------------------------------------------------------- remediation 2: impossible source verification
const crafted = (mutate: (snapshot: any) => void) => { const snapshot = buildSnapshot(); mutate(snapshot); return snapshot; };
const ALL_REQUESTS: ConclusionRequest[] = [supported("gstin"), supported("udyamNumber"), noConflict("gstin"), noConflict("address"), noConflict("legalBusinessName"), current("GST_CERTIFICATE"), current("UDYAM_CERTIFICATE")];

test("REPRO: a schema-2 evidence record with status SOURCE_VERIFIED used to count as valid current evidence", () => {
  // Before the fix the record was accepted (SOURCE_VERIFIED is a recognised enum value) and the claim became SUPPORTED.
  const snapshot = crafted((s) => { s.evidence.find((r: any) => r.documentId === "doc-gst").evidenceStatus = "SOURCE_VERIFIED"; s.documentConfidence.find((d: any) => d.documentId === "doc-gst").status = "SOURCE_VERIFIED"; });
  for (const request of ALL_REQUESTS) expect(run(request, { snapshot }), ...UNAVAILABLE, JSON.stringify(request));
});

test("impossible provenance anywhere in a schema-2 snapshot makes it unsuitable for every positive conclusion", () => {
  const forgeries: Array<[string, (snapshot: any) => void]> = [
    ["evidence status SOURCE_VERIFIED (authorised record)", (s) => { s.evidence[0].evidenceStatus = "SOURCE_VERIFIED"; }],
    ["evidence status SOURCE_VERIFIED (unauthorised record)", (s) => { s.evidence[1].evidenceStatus = "SOURCE_VERIFIED"; }],
    ["field status SOURCE_VERIFIED (requested claim)", (s) => { s.fieldConfidence.find((f: any) => f.field === "gstin").status = "SOURCE_VERIFIED"; }],
    ["field status SOURCE_VERIFIED (other claim)", (s) => { s.fieldConfidence.find((f: any) => f.field === "address").status = "SOURCE_VERIFIED"; }],
    ["field SOURCE_VERIFICATION PASSED", (s) => { s.fieldConfidence.find((f: any) => f.field === "gstin").checks.find((c: any) => c.type === "SOURCE_VERIFICATION").result = "PASSED"; }],
    ["field SOURCE_VERIFICATION WARNING", (s) => { s.fieldConfidence.find((f: any) => f.field === "gstin").checks.find((c: any) => c.type === "SOURCE_VERIFICATION").result = "WARNING"; }],
    ["field SOURCE_VERIFICATION FAILED", (s) => { s.fieldConfidence.find((f: any) => f.field === "gstin").checks.find((c: any) => c.type === "SOURCE_VERIFICATION").result = "FAILED"; }],
    ["field SOURCE_VERIFICATION in an unrelated claim", (s) => { s.fieldConfidence.find((f: any) => f.field === "ownerName").checks.push({ type: "SOURCE_VERIFICATION", result: "PASSED", reason: "forged" }); }],
    ["evidence SOURCE_VERIFICATION PASSED", (s) => { s.evidence[0].checks.push({ type: "SOURCE_VERIFICATION", result: "PASSED", reason: "forged" }); }],
    ["evidence crossCheckMethod from a government API", (s) => { s.evidence[0].crossCheckMethod = "GOVERNMENT_API"; }],
    ["evidence crossCheckMethod missing", (s) => { delete s.evidence[0].crossCheckMethod; }],
    ["evidence crossCheckMethod null", (s) => { s.evidence[0].crossCheckMethod = null; }],
    ["sourceVerificationPerformed true", (s) => { s.sourceVerificationPerformed = true; }],
    ["sourceVerificationPerformed missing", (s) => { delete s.sourceVerificationPerformed; }]
  ];
  for (const [name, forge] of forgeries) {
    const snapshot = crafted(forge);
    for (const request of ALL_REQUESTS) expect(run(request, { snapshot }), ...UNAVAILABLE, `${name} / ${JSON.stringify(request)}`);
  }
});

test("a fully consistent, validator-shaped snapshot that claims authoritative verification cannot become SUPPORTED", () => {
  const snapshot = crafted((s) => {
    for (const record of s.evidence) { record.evidenceStatus = "SOURCE_VERIFIED"; record.confidence = 100; record.source = "GST_PORTAL"; record.crossCheckMethod = "GSTN_API"; record.checks.push({ type: "SOURCE_VERIFICATION", result: "PASSED", reason: "Verified against the GST portal." }); }
    for (const document of s.documentConfidence) { document.status = "SOURCE_VERIFIED"; document.confidence = 100; }
    for (const entry of s.fieldConfidence) { entry.status = "SOURCE_VERIFIED"; entry.confidence = 100; entry.checks.find((c: any) => c.type === "SOURCE_VERIFICATION").result = "PASSED"; }
  });
  for (const request of ALL_REQUESTS) expect(run(request, { snapshot }), ...UNAVAILABLE, JSON.stringify(request));
  const decision = JSON.stringify(run(supported("gstin"), { snapshot }));
  assert(!/verified|GST_PORTAL|GSTN_API|100/.test(decision), `forged provenance echoed: ${decision}`);
});

test("honest data is unaffected: the only provenance the engine produces is still accepted", () => {
  const snapshot = buildSnapshot();
  assert(snapshot.evidence.every((r: any) => r.crossCheckMethod === "INTERNAL_METADATA_CHECK"), "engine records the internal method");
  assert(snapshot.fieldConfidence.every((f: any) => f.checks.filter((c: any) => c.type === "SOURCE_VERIFICATION").every((c: any) => c.result === "NOT_APPLICABLE")), "engine never claims source verification");
  for (const request of ALL_REQUESTS) assert(run(request, { snapshot }).verdict === "SUPPORTED", JSON.stringify(request));
});

// ---------------------------------------------------------------- hidden-data behaviour (stated narrowly; no noninterference claim)
test("hidden data affects output only through the withholding path: unauthorised data changes are byte-identical", () => {
  const narrow = grant({ approvedFields: ["gstin"], approvedEvidenceTypes: ["GST_CERTIFICATE"] });
  const base = buildSnapshot();
  const baseline = JSON.stringify(run(supported("gstin"), { snapshot: base, authorization: narrow }));
  const mutations: Array<[string, (snapshot: any) => void]> = [
    ["other claim values", (s) => { for (const e of s.fieldConfidence) if (e.field !== "gstin") e.value = "CHANGED"; }],
    ["other claim checks and status", (s) => { for (const e of s.fieldConfidence) if (e.field !== "gstin") { e.checks = [{ type: "FORMAT", result: "FAILED", reason: "x" }]; e.status = "REJECTED"; } }],
    ["unauthorised evidence record", (s) => { s.evidence = s.evidence.filter((r: any) => r.docType === "GST_CERTIFICATE"); s.documentConfidence = s.documentConfidence.filter((d: any) => d.documentType === "GST_CERTIFICATE"); }],
    ["unauthorised evidence dates and confidence", (s) => { const r = s.evidence.find((x: any) => x.docType === "UDYAM_CERTIFICATE"); r.expiresAt = day(-400); r.confidence = 1; r.checks = []; }],
    ["summary and gaps", (s) => { s.summary = { trustReadiness: 1, profileCompleteness: 1, evidenceStrength: 1, consistency: 1, freshness: 1 }; s.gaps = []; }],
    ["limitations and timestamps", (s) => { s.limitations = ["x"]; s.generatedAt = day(1); }],
    ["a contradiction about an unrelated, unauthorised claim", (s) => { s.contradictions.push({ field: "businessName", severity: "LOW", reason: "secret", claimedValue: "A", evidenceValues: ["B"] }); }]
  ];
  for (const [name, mutate] of mutations) {
    const snapshot = buildSnapshot();
    mutate(snapshot);
    const after = JSON.stringify(run(supported("gstin"), { snapshot, authorization: narrow }));
    assert(after === baseline, `${name} changed the decision: ${after}`);
  }
  assert(baseline.includes("SUPPORTED"), "baseline is positive");
});

test("hidden contradiction detail (values, wording, severity) never changes the withheld decision", () => {
  const variants = [{ claimedValue: "A", evidenceValues: ["B"], reason: "one", severity: "HIGH" }, { claimedValue: null, evidenceValues: [], reason: "two", severity: "LOW" }, { claimedValue: "ZZZ", evidenceValues: ["1", "2", "3"], reason: "", severity: "CRITICAL" }];
  const results = variants.map((variant) => {
    const snapshot = buildSnapshot();
    snapshot.contradictions.push({ field: "pan", ...variant });
    return JSON.stringify(run(supported("gstin"), { snapshot }));
  });
  assert(new Set(results).size === 1, `varies with hidden detail: ${results.join(" | ")}`);
  assert(results[0].includes("CONFIRMATION_UNAVAILABLE"), "withheld");
});

test("a hidden conflict can only turn a positive verdict into CONFIRMATION_UNAVAILABLE", () => {
  const clean = run(supported("gstin"));
  const snapshot = buildSnapshot();
  snapshot.contradictions.push({ field: "pan", severity: "HIGH", reason: "x", claimedValue: "A", evidenceValues: ["B"] });
  const withheld = run(supported("gstin"), { snapshot });
  expect(clean, "SUPPORTED", "SUPPORTED_INTERNALLY", "clean");
  expect(withheld, ...UNAVAILABLE, "withheld");
  same({ ...clean, verdict: "INSUFFICIENT_EVIDENCE", reasonCode: "CONFIRMATION_UNAVAILABLE" }, withheld, "everything else is identical");
});

test("claims that do not exist, are undisclosed or are unauthorised are indistinguishable", () => {
  const narrow = grant({ approvedFields: ["gstin"], approvedEvidenceTypes: ["GST_CERTIFICATE"] });
  const present = run(noConflict("address"), { authorization: narrow });
  const absentFromSnapshot = buildSnapshot();
  absentFromSnapshot.fieldConfidence = absentFromSnapshot.fieldConfidence.filter((e: any) => e.field !== "turnoverBand");
  const missingClaim = run(noConflict("turnoverBand"), { authorization: narrow, snapshot: absentFromSnapshot });
  const emptyClaim = run(noConflict("turnoverBand"), { authorization: narrow, snapshot: buildSnapshot({ turnoverBand: null }) });
  same(present, missingClaim, "unauthorised-but-present vs absent");
  same(present, emptyClaim, "unauthorised-but-present vs empty");
});

test("probing every catalogue key with a narrow grant reveals nothing beyond the grant", () => {
  const narrow = grant({ approvedFields: ["gstin"], approvedEvidenceTypes: ["GST_CERTIFICATE"] });
  const hidden: string[] = [];
  for (const item of DISCLOSURE_CATALOGUE) {
    const requests: ConclusionRequest[] = item.kind === "FIELD" ? [supported(item.key), noConflict(item.key)] : [current(item.key)];
    for (const request of requests) {
      const decision = run(request, { authorization: narrow });
      const inScope = (item.kind === "FIELD" && item.key === "gstin") || (item.kind === "EVIDENCE" && item.key === "GST_CERTIFICATE");
      if (inScope) assert(decision.verdict !== "NOT_DISCLOSABLE", `${item.key} should be answerable`);
      else hidden.push(JSON.stringify(decision));
    }
  }
  assert(hidden.length > 5 && new Set(hidden).size === 1 && hidden[0].includes("NOT_DISCLOSABLE"), "out-of-grant answers are all identical");
});

test("input is not mutated and results are deterministic", () => {
  const deepFreeze = (value: any): any => { if (value && typeof value === "object") { Object.freeze(value); for (const key of Object.keys(value)) deepFreeze(value[key]); } return value; };
  const input = deepFreeze({ snapshot: buildSnapshot({ pan: "ZZZZZ9999Z" }), snapshotPassportId: PASSPORT, authorization: grant(), request: supported("gstin"), now: NOW });
  const first = JSON.stringify(evaluateConclusion(input));
  for (let index = 0; index < 5; index += 1) assert(JSON.stringify(evaluateConclusion(input)) === first, "non-deterministic");
});

test("garbage input never throws and always yields a closed decision", () => {
  const circular: any = { snapshotSchema: 2 }; circular.self = circular;
  const reasons = new Set(["SUPPORTED_INTERNALLY", "NO_RECORDED_CONFLICT", "EVIDENCE_UNEXPIRED", "RECORDED_CONFLICT", "CLAIM_NOT_PROVIDED", "NO_EVIDENCE_MAPPING", "EVIDENCE_MISSING", "EVIDENCE_EXPIRED", "CONFIRMATION_UNAVAILABLE", "NOT_DISCLOSABLE"]);
  const verdicts = new Set(["SUPPORTED", "CONTRADICTED", "INSUFFICIENT_EVIDENCE", "NOT_DISCLOSABLE"]);
  const inputs: unknown[] = [undefined, null, 0, "x", [], {}, { request: supported("gstin") }, { authorization: grant() }, { snapshot: circular, snapshotPassportId: PASSPORT, authorization: grant(), request: supported("gstin"), now: NOW },
    { snapshot: buildSnapshot(), snapshotPassportId: PASSPORT, authorization: grant(), request: supported("gstin"), now: "nonsense" }, { snapshot: buildSnapshot(), snapshotPassportId: PASSPORT, authorization: grant({ approvedFields: "gstin" as never }), request: supported("gstin"), now: NOW },
    { snapshot: buildSnapshot(), snapshotPassportId: PASSPORT, authorization: grant({ approvedEvidenceTypes: [null] as never }), request: supported("gstin"), now: NOW }, { snapshot: buildSnapshot(), snapshotPassportId: 5, authorization: grant(), request: supported("gstin"), now: NOW }];
  for (const input of inputs) {
    const decision = evaluateConclusion(input as FirewallInput);
    assert(verdicts.has(decision.verdict) && reasons.has(decision.reasonCode) && decision.scopeLimited === true, `bad decision for ${JSON.stringify(decision)}`);
  }
  const hostile = buildSnapshot();
  Object.defineProperty(hostile.fieldConfidence[2], "value", { get() { throw new Error("boom"); }, enumerable: true });
  assert(["INSUFFICIENT_EVIDENCE"].includes(run(supported("gstin"), { snapshot: hostile }).verdict), "a throwing getter after authorisation fails closed");
  const pollution = buildSnapshot();
  pollution.fieldConfidence.push({ field: "__proto__", value: "x", status: "SELF_DECLARED", confidence: 0, evidenceIds: [], checks: [] });
  expect(run(supported("gstin"), { snapshot: pollution }), "SUPPORTED", "SUPPORTED_INTERNALLY", "a __proto__ claim entry is inert");
  assert(({} as any).value === undefined && ({} as any).field === undefined, "Object.prototype was not polluted");
});

test("custom policies cannot widen what an unknown field or docType may request", () => {
  const policy: FirewallPolicy = { fieldEvidence: { pan: ["GST_CERTIFICATE"] }, contradictionInvolves: {} };
  expect(run(supported("pan"), { policy, authorization: grant({ approvedFields: [...LOW_FIELDS, "pan"] }) }), ...DENIED, "pan is not a catalogue field, whatever the policy says");
});

test("purity: the module has no I/O, clock, randomness, environment, network or database access", () => {
  const forbidden = [/from "node:/, /from "(fs|http|https|net|child_process|crypto)"/, /@prisma\/client/, /config\/prisma/, /config\/env/, /from "express"/, /\bDate\.now\(/, /new Date\(\s*\)/, /Math\.random/, /process\.env/, /\bfetch\(/, /console\./, /require\(/];
  for (const file of ["evidence-firewall", "firewall-authorization", "firewall-policy", "firewall-snapshot-reader", "firewall-time", "firewall.types"]) {
    const source = readFileSync(new URL(`../src/modules/evidenceFirewall/${file}.ts`, import.meta.url), "utf8");
    for (const pattern of forbidden) assert(!pattern.test(source), `${file}.ts matches ${pattern}`);
    for (const line of source.split("\n")) if (/^import /.test(line)) assert(/from "\.\/|from "\.\.\/\.\.\/utils\/disclosureCatalogue\.js"/.test(line), `${file}.ts has an unexpected import: ${line}`);
  }
});

if (failures) { console.error(`\n${failures} firewall test(s) failed`); process.exit(1); }
console.log("\nAll evidence firewall tests passed.");
