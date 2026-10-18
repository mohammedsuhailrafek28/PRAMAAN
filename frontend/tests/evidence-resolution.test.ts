// Evidence resolution is decided by the snapshot's schema marker, never by whether evidence[] is empty.
import assert from "node:assert/strict";
import { test } from "node:test";

import { legacyProfile, rawSnapshot, schema2Profile } from "./support/trustFixtures.ts";
import { on, resetServer } from "./support/mockServer.ts";

const { explainClaim } = await import("../src/lib/claimExplanation.ts");
const api = await import("../src/services/api.ts");

const explain = (profile: ReturnType<typeof schema2Profile>, name: string) => explainClaim(profile, profile.fields.find((item) => item.field === name)!);
const passport = (snapshot: unknown) => ({ data: { passport: { id: "passport-7", version: 7, snapshotJson: snapshot } } });
const mapped = async (snapshot: unknown) => { resetServer(); on("GET /passport/me", passport(snapshot)); return (await api.getTrustProfile())!; };

test("schema 2: an id present in evidence[] resolves from the embedded record", () => {
  const [line] = explain(schema2Profile(), "gstin").evidence;
  assert.equal(line.basis, "SNAPSHOT");
  assert.equal(line.found, true);
  assert.equal(line.revision, 2);
});

test("schema 2: an id missing from evidence[] but present in documents[] is NOT_IN_SNAPSHOT", () => {
  const profile = schema2Profile();
  profile.evidence = profile.evidence.filter((record) => record.documentId !== "doc-gst-r2");
  assert.ok(profile.documents.some((item) => item.documentId === "doc-gst-r2"), "documents[] still lists it");
  const [line] = explain(profile, "gstin").evidence;
  assert.equal(line.basis, "NOT_IN_SNAPSHOT");
  assert.equal(line.found, false);
  assert.equal(line.status, null);
  assert.equal(line.docType, null);
  assert.deepEqual(line.checks, []);
});

test("schema 2: an empty evidence[] gives no legacy fallback", () => {
  const profile = schema2Profile({ evidence: [] });
  for (const name of ["gstin", "udyamNumber"]) {
    const lines = explain(profile, name).evidence;
    assert.ok(lines.length > 0);
    assert.ok(lines.every((line) => line.basis === "NOT_IN_SNAPSHOT" && !line.found), name);
  }
});

test("schema 2: a missing or malformed evidence[] fails conservatively through the mapper", async () => {
  for (const evidence of [undefined, null, "oops", 7, {}, [null, "x", { docType: "GST_CERTIFICATE" }]]) {
    const raw: any = rawSnapshot();
    if (evidence === undefined) delete raw.evidence; else raw.evidence = evidence;
    const profile = await mapped(raw);
    assert.equal(profile.snapshotSchema, 2);
    assert.equal(profile.evidenceBasis, "SNAPSHOT", "a schema-2 snapshot is never relabelled legacy");
    const lines = explain(profile, "gstin").evidence;
    assert.ok(lines.every((line) => line.basis === "NOT_IN_SNAPSHOT" && !line.found), JSON.stringify(evidence));
  }
});

test("genuine legacy snapshot: the conservative documents[] fallback still works", async () => {
  const profile = await mapped(rawSnapshot(legacyProfile()));
  assert.equal(profile.snapshotSchema, undefined);
  const [line] = explain(profile, "gstin").evidence;
  assert.equal(line.basis, "LEGACY_SNAPSHOT");
  assert.equal(line.found, true);
  assert.equal(line.revision, null);
  assert.deepEqual(line.expiresAt, { kind: "UNAVAILABLE" });
  assert.deepEqual(line.source, { kind: "UNAVAILABLE" });
  assert.equal(explain(profile, "gstin").evidence.length, 1);
});

test("unknown schema versions are not treated as legacy and resolve nothing", async () => {
  for (const marker of [1, 3, 99, 0, "2", "v2", true]) {
    const raw: any = rawSnapshot();
    raw.snapshotSchema = marker;
    const profile = await mapped(raw);
    assert.notEqual(profile.snapshotSchema, undefined, String(marker));
    if (marker !== 2) assert.equal(profile.evidence.length, 0, "evidence[] is only trusted for schema 2");
    const lines = explain(profile, "gstin").evidence;
    assert.ok(lines.every((line) => line.basis === "NOT_IN_SNAPSHOT" && !line.found), String(marker));
    assert.ok(profile.evidenceBasis !== "LEGACY_SNAPSHOT", String(marker));
  }
  const unknown = schema2Profile({ snapshotSchema: 3 });
  assert.ok(explain(unknown, "gstin").evidence.every((line) => line.basis === "NOT_IN_SNAPSHOT"));
});

test("mutating documents[] cannot change a schema-2 explanation", () => {
  const profile = schema2Profile();
  const before = JSON.stringify(profile.fields.map((claim) => explainClaim(profile, claim)));
  profile.documents = [
    { documentId: "doc-gst-r2", documentType: "OTHER", status: "VERIFIED", confidence: 99, reason: "tampered", checks: [] },
    { documentId: "doc-extra", documentType: "BANK_STATEMENT", status: "VERIFIED", confidence: 99, reason: "tampered", checks: [] },
  ];
  assert.equal(JSON.stringify(profile.fields.map((claim) => explainClaim(profile, claim))), before);
});

test("multiple references: valid evidence resolves and missing evidence stays missing", () => {
  const profile = schema2Profile();
  profile.fields = profile.fields.map((claim) => (claim.field === "gstin" ? { ...claim, evidenceIds: ["doc-gst-r2", "doc-ghost", "doc-udyam-r1", "doc-gst-r2"] } : claim));
  profile.documents = [...profile.documents, { documentId: "doc-ghost", documentType: "GST_CERTIFICATE", status: "VERIFIED", confidence: 99, reason: "x", checks: [] }];
  const lines = explain(profile, "gstin").evidence;
  assert.deepEqual(lines.map((line) => [line.documentId, line.basis]), [["doc-gst-r2", "SNAPSHOT"], ["doc-ghost", "NOT_IN_SNAPSHOT"], ["doc-udyam-r1", "SNAPSHOT"]]);
});

test("nothing is invented for evidence that is not in the snapshot", () => {
  const profile = schema2Profile({ evidence: [] });
  for (const claim of profile.fields) {
    for (const line of explainClaim(profile, claim).evidence) {
      assert.equal(line.status, null);
      assert.equal(line.docType, null);
      assert.equal(line.revision, null);
      for (const value of [line.source, line.issuedAt, line.expiresAt, line.uploadedAt, line.checkedAt]) assert.deepEqual(value, { kind: "UNAVAILABLE" });
      assert.equal(line.expiredWhenAssessed, false);
    }
  }
});

test("an explicit null, undefined or malformed snapshotSchema is never legacy and exposes no document statuses or checks", async () => {
  for (const marker of [null, undefined, "", "2", {}, [], [2], NaN, false]) {
    const raw: any = rawSnapshot();
    raw.snapshotSchema = marker; // the property is present
    assert.ok(Object.prototype.hasOwnProperty.call(raw, "snapshotSchema"));
    const profile = await mapped(raw);
    const label = String(marker);
    assert.notEqual(profile.snapshotSchema, undefined, label);
    assert.notEqual(profile.snapshotSchema, 2, label);
    assert.equal(profile.evidenceBasis, "SNAPSHOT", label);
    assert.notEqual(profile.evidenceBasis, "LEGACY_SNAPSHOT", label);
    assert.equal(profile.evidence.length, 0, label);
    for (const claim of profile.fields) {
      for (const line of explainClaim(profile, claim).evidence) {
        assert.equal(line.basis, "NOT_IN_SNAPSHOT", `${claim.field} ${label}`);
        assert.equal(line.status, null);
        assert.deepEqual(line.checks, []);
      }
    }
  }
});

test("only a genuinely absent snapshotSchema property is legacy; a missing or non-object snapshot is not", async () => {
  const raw: any = rawSnapshot(legacyProfile());
  assert.ok(!Object.prototype.hasOwnProperty.call(raw, "snapshotSchema") || raw.snapshotSchema === undefined);
  delete raw.snapshotSchema;
  const legacy = await mapped(raw);
  assert.equal(legacy.snapshotSchema, undefined);
  assert.equal(legacy.evidenceBasis, "LEGACY_SNAPSHOT");
  assert.equal(explain(legacy, "gstin").evidence[0].basis, "LEGACY_SNAPSHOT");
  for (const bad of [null, "text", 5]) {
    const profile = await mapped(bad);
    assert.equal(profile.evidenceBasis, "SNAPSHOT", String(bad));
    assert.notEqual(profile.snapshotSchema, undefined, String(bad));
  }
});
