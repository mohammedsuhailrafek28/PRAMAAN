import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { field, fail, legacyProfile, na, pass, schema2Profile, warn } from "./support/trustFixtures.ts";

const { explainClaim, CATEGORY_PRECEDENCE, CATEGORY_PRESENTATION } = await import("../src/lib/claimExplanation.ts");

const explain = (profile: ReturnType<typeof schema2Profile>, name: string) => {
  const claim = profile.fields.find((item) => item.field === name);
  assert.ok(claim, `fixture claim ${name} missing`);
  return explainClaim(profile, claim);
};

test("all six presentation states are produced from recorded checks", () => {
  const profile = schema2Profile();
  assert.equal(explain(profile, "bankAccount").category, "NOT_PROVIDED");
  assert.equal(explain(profile, "turnoverBand").category, "NOT_PROVIDED");
  assert.equal(explain(profile, "pan").category, "CONTRADICTED");
  assert.equal(explain(profile, "udyamNumber").category, "EXPIRED");
  assert.equal(explain(profile, "gstin").category, "SUPPORTED_INTERNALLY");
  assert.equal(explain(profile, "address").category, "NOT_ASSESSED");

  // MISSING_EVIDENCE: a claim IS provided, a supporting document is expected, none exists.
  const missing = field({ field: "gstin", value: "33TESTX0001A1Z5", status: "SELF_DECLARED", checks: [pass("CLAIM_PRESENT"), fail("SUPPORTING_DOCUMENT", "No current relevant submitted document exists for this claim.")], evidenceIds: [] });
  const result = explainClaim(profile, missing);
  assert.equal(result.category, "MISSING_EVIDENCE");
  assert.deepEqual(new Set(CATEGORY_PRECEDENCE), new Set(Object.keys(CATEGORY_PRESENTATION)));
});

test("a missing claim is distinguished from missing supporting evidence", () => {
  const profile = schema2Profile();
  const notProvided = explain(profile, "bankAccount");
  // bankAccount ALSO lacks a supporting document, which must remain visible rather than being absorbed.
  assert.equal(notProvided.category, "NOT_PROVIDED");
  assert.deepEqual(notProvided.secondary, ["MISSING_EVIDENCE"], "missing evidence stays visible beside the missing claim");
  assert.ok(notProvided.notes.some((note) => /No supporting document has been submitted/.test(note)));
  assert.ok(notProvided.checks.some((check) => check.type === "SUPPORTING_DOCUMENT" && check.outcome === "FAILED"), "failed supporting-document check is still listed");
  assert.equal(notProvided.gaps.length, 1);
  assert.deepEqual(notProvided.gaps[0].requiredEvidenceLabels, ["Bank statement"]);
});

test("expired evidence is not reported as missing evidence", () => {
  const profile = schema2Profile();
  const udyam = explain(profile, "udyamNumber");
  assert.equal(udyam.category, "EXPIRED");
  assert.ok(!udyam.secondary.includes("MISSING_EVIDENCE"));
  assert.equal(udyam.evidence.length, 1);
  assert.equal(udyam.evidence[0].expiredWhenAssessed, true);
  assert.equal(udyam.evidence[0].expiresAt.kind, "RECORDED");
});

test("conflicts keep their recorded reason and both values; legal-name alias is matched", () => {
  const profile = schema2Profile();
  const pan = explain(profile, "pan");
  assert.equal(pan.contradictions.length, 1);
  assert.equal(pan.contradictions[0].claimedValue, "ABCDE1234F");
  assert.deepEqual(pan.contradictions[0].evidenceValues, ["ZZZZZ9999Z"]);
  assert.match(pan.contradictions[0].reason, /does not match the PAN segment/);

  // The backend reports this conflict under `businessName`; the claim is `legalBusinessName`.
  const name = explain(profile, "legalBusinessName");
  assert.equal(name.category, "CONTRADICTED");
  assert.equal(name.contradictions.length, 1);
  assert.equal(name.contradictions[0].evidenceValues[0], "Other Organization");
});

test("precedence picks a headline without hiding other conditions", () => {
  const profile = schema2Profile();
  const both = field({ field: "gstin", value: "33TESTX0001A1Z5", status: "REJECTED",
    checks: [pass("CLAIM_PRESENT"), fail("SUPPORTING_DOCUMENT"), warn("EXPIRED_EVIDENCE", "Expired."), fail("INTERNAL_CONSISTENCY", "Conflicts.")], evidenceIds: ["doc-udyam-r1"] });
  const result = explainClaim(profile, both);
  assert.equal(result.category, "CONTRADICTED", "a contradiction outranks expiry");
  assert.deepEqual(result.secondary, ["EXPIRED"]);
  assert.ok(result.notes.some((note) => /expiry/i.test(note)), "the expiry problem is still stated");
  assert.equal(result.checks.length, 4, "every recorded check is still listed");
});

test("multiple supporting evidence references resolve in order, once each", () => {
  const profile = schema2Profile();
  const claim = field({ field: "gstin", value: "33TESTX0001A1Z5", checks: [pass("CLAIM_PRESENT"), pass("SUPPORTING_DOCUMENT")], evidenceIds: ["doc-udyam-r1", "doc-gst-r2", "doc-gst-r2"] });
  const result = explainClaim(profile, claim);
  assert.deepEqual(result.evidence.map((line) => line.documentId), ["doc-udyam-r1", "doc-gst-r2"]);
  assert.equal(result.evidence[1].revision, 2);
  assert.equal(result.evidence[1].docTypeLabel, "GST certificate");
});

test("a reference missing from the snapshot is reported, not invented", () => {
  const profile = schema2Profile();
  const claim = field({ field: "gstin", value: "x", checks: [pass("CLAIM_PRESENT"), pass("SUPPORTING_DOCUMENT")], evidenceIds: ["doc-not-in-this-version"] });
  const result = explainClaim(profile, claim);
  assert.equal(result.evidence[0].found, false);
  assert.equal(result.evidence[0].basis, "NOT_IN_SNAPSHOT");
  assert.equal(result.evidence[0].docType, null);
  assert.equal(result.evidence[0].expiresAt.kind, "UNAVAILABLE");
  assert.ok(result.notes.some((note) => /not present in this version/.test(note)));
});

test("unknown check types and outcomes degrade safely and are not treated as failures", () => {
  const profile = schema2Profile();
  const claim = field({ field: "gstin", value: "33TESTX0001A1Z5", checks: [pass("CLAIM_PRESENT"), pass("SUPPORTING_DOCUMENT"), { type: "FUTURE_CHECK", result: "SOMETHING_NEW", reason: "Added by a later engine." }], evidenceIds: ["doc-gst-r2"] });
  const result = explainClaim(profile, claim);
  assert.equal(result.category, "SUPPORTED_INTERNALLY");
  const unknown = result.checks.find((check) => check.type === "FUTURE_CHECK");
  assert.equal(unknown?.label, "Future check");
  assert.equal(unknown?.outcomeLabel, "Something new");
  assert.equal(unknown?.tone, "neutral");
  assert.equal(unknown?.reason, "Added by a later engine.");
});

test("an unclassified failed check prevents a 'supported' headline and is surfaced", () => {
  const profile = schema2Profile();
  const claim = field({ field: "gstin", value: "bad", checks: [pass("CLAIM_PRESENT"), fail("FORMAT", "Does not match the internal format rule."), pass("SUPPORTING_DOCUMENT")], evidenceIds: ["doc-gst-r2"] });
  const result = explainClaim(profile, claim);
  assert.notEqual(result.category, "SUPPORTED_INTERNALLY");
  assert.equal(result.category, "NOT_ASSESSED");
  assert.ok(result.notes.some((note) => /Format check/.test(note)));
});

test("a failed supporting-document check with linked evidence but no expiry is not relabelled as missing", () => {
  const profile = schema2Profile();
  const claim = field({ field: "gstin", value: "x", checks: [pass("CLAIM_PRESENT"), fail("SUPPORTING_DOCUMENT", "Odd reason.")], evidenceIds: ["doc-gst-r2"] });
  const result = explainClaim(profile, claim);
  assert.notEqual(result.category, "MISSING_EVIDENCE");
  assert.equal(result.category, "NOT_ASSESSED");
});

test("truthfulness: nothing claims external verification unless the snapshot records it", () => {
  const profile = schema2Profile();
  for (const claim of profile.fields) {
    const result = explainClaim(profile, claim);
    assert.equal(result.sourceVerificationRecorded, false, claim.field);
    assert.match(result.sourceVerificationText, /No external source was consulted/);
    assert.match(result.limitation, /does not query GST, Udyam, bank, or other government systems/);
    const text = JSON.stringify([result.summary, result.notes, result.sourceVerificationText]);
    assert.doesNotMatch(text, /government[- ]verified|bank[- ]verified|authoritative|source[- ]confirmed|confirmed by|verified by|officially/i, claim.field);
  }
  const verified = explainClaim(profile, field({ field: "gstin", value: "x", status: "SOURCE_VERIFIED", checks: [pass("CLAIM_PRESENT"), pass("SOURCE_VERIFICATION", "Confirmed with the issuing source.")] }));
  assert.equal(verified.sourceVerificationRecorded, true, "recorded only when the snapshot says so");
  const notVerified = explainClaim(profile, field({ field: "gstin", value: "x", checks: [pass("CLAIM_PRESENT"), na("SOURCE_VERIFICATION")] }));
  assert.equal(notVerified.sourceVerificationRecorded, false);
});

test("no invented evidence details: dates and provenance appear only when recorded", () => {
  const profile = schema2Profile();
  const gst = explain(profile, "gstin").evidence[0];
  assert.deepEqual(gst.expiresAt, { kind: "RECORDED", iso: "2027-01-10T00:00:00.000Z" });
  assert.deepEqual(gst.source, { kind: "RECORDED", text: "Submitted by the business" });
  assert.equal(gst.revision, 2);
  const udyam = explain(profile, "udyamNumber").evidence[0];
  assert.deepEqual(udyam.source, { kind: "NONE_RECORDED" }, "an empty recorded source is not turned into 'submitted by the business'");
  assert.deepEqual(udyam.issuedAt, { kind: "NONE_RECORDED" });
});

test("legacy snapshots show unavailable metadata, never 'no expiry'", () => {
  const profile = legacyProfile();
  const gst = explain(profile, "gstin").evidence[0];
  assert.equal(gst.basis, "LEGACY_SNAPSHOT");
  assert.equal(gst.revision, null);
  for (const key of ["issuedAt", "expiresAt", "uploadedAt", "checkedAt"] as const) assert.deepEqual(gst[key], { kind: "UNAVAILABLE" }, key);
  assert.deepEqual(gst.source, { kind: "UNAVAILABLE" });
  assert.ok(gst.checks.length > 0, "recorded checks are still shown");
  assert.ok(explain(profile, "gstin").notes.some((note) => /historical version/.test(note)));
  // Expiry recorded in a legacy check is still honoured.
  assert.equal(explain(profile, "udyamNumber").category, "EXPIRED");
  assert.equal(explain(profile, "udyamNumber").evidence[0].expiredWhenAssessed, true);
});

test("claim, evidence and findings all come from the same pinned version", () => {
  const profile = schema2Profile();
  const result = explain(profile, "gstin");
  assert.equal(result.version, 7);
  assert.equal(result.assessedAt, "2026-10-01T10:00:00.000Z");
  assert.equal(result.evidenceBasis, "SNAPSHOT");
  assert.equal(result.evidence[0].checkedAt.kind === "RECORDED" && result.evidence[0].checkedAt.iso, "2026-10-01T10:00:00.000Z");
});

test("explanations are deterministic and independent of any live state", () => {
  const profile = schema2Profile();
  const first = JSON.stringify(profile.fields.map((claim) => explainClaim(profile, claim)));
  // Nothing outside the profile can be passed in; mutating unrelated objects cannot change the output.
  const live = { documents: [{ id: "doc-gst-r2", originalName: "REPLACED.pdf", revision: 9, expiresAt: "2020-01-01", isCurrent: false }] };
  live.documents[0].revision = 10;
  const second = JSON.stringify(profile.fields.map((claim) => explainClaim(profile, claim)));
  assert.equal(first, second);

  const source = readFileSync(new URL("../src/lib/claimExplanation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Date\.now|new Date\(|useAppStore|business\.documents|localStorage|sessionStorage|axios|from "@\/services/, "pure helper reads no clock, store, network or storage");
  assert.doesNotMatch(source, /^(let|var) /m, "no module-level mutable state");
});
