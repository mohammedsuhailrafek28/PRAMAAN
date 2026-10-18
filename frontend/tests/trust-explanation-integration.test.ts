// Mapper, store and session behaviour for owner-side explanations, using the real api.ts and stores.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { loginReply, on, resetServer, businessReply } from "./support/mockServer.ts";
import { legacyProfile, rawSnapshot } from "./support/trustFixtures.ts";

const { useAppStore } = await import("../src/store/appStore.ts");
const { useAuthStore } = await import("../src/store/authStore.ts");
const api = await import("../src/services/api.ts");
const { explainClaim } = await import("../src/lib/claimExplanation.ts");

const app = () => useAppStore.getState();
const auth = () => useAuthStore.getState();
async function signIn(id: string) {
  on("POST /auth/login", loginReply(id, "MSME", `token-${id}`));
  return auth().loginAs(`${id}@x.test`, "password123");
}
const passportReply = (snapshot: unknown) => ({ data: { passport: { id: "passport-7", version: 7, snapshotJson: snapshot } } });

beforeEach(() => {
  resetServer();
  localStorage.clear();
  auth().logout();
});

describe("frontend mapping keeps the backend's explanation data", () => {
  test("evidenceIds, contradiction values, gap evidence types and schema-2 evidence survive", async () => {
    on("GET /passport/me", passportReply(rawSnapshot()));
    const profile = await api.getTrustProfile();
    assert.ok(profile);
    assert.deepEqual(profile.fields.find((item) => item.field === "gstin")?.evidenceIds, ["doc-gst-r2"]);
    assert.deepEqual(profile.fields.find((item) => item.field === "address")?.evidenceIds, []);
    const pan = profile.contradictions.find((item) => item.field === "pan");
    assert.equal(pan?.claimedValue, "ABCDE1234F");
    assert.deepEqual(pan?.evidenceValues, ["ZZZZZ9999Z"]);
    assert.deepEqual(profile.gaps[0].requiredEvidenceTypes, ["BANK_STATEMENT"]);
    assert.equal(profile.evidenceBasis, "SNAPSHOT");
    assert.equal(profile.snapshotSchema, 2);
    const record = profile.evidence.find((item) => item.documentId === "doc-gst-r2");
    assert.equal(record?.revision, 2);
    assert.equal(record?.expiresAt, "2027-01-10T00:00:00.000Z");
    assert.equal(record?.source, "MSME_SUBMITTED");
    assert.equal(profile.fields.find((item) => item.field === "gstin")?.checks.length, 5, "per-field checks are retained");
    assert.equal(profile.documents[1].checks.find((check) => check.type === "EXPIRY")?.result, "FAILED", "per-document checks are retained");
  });

  test("a legacy snapshot is marked legacy and carries no invented evidence records", async () => {
    const raw = rawSnapshot(legacyProfile());
    on("GET /passport/me", passportReply(raw));
    const profile = await api.getTrustProfile();
    assert.ok(profile);
    assert.equal(profile.evidenceBasis, "LEGACY_SNAPSHOT");
    assert.deepEqual(profile.evidence, []);
    assert.equal(profile.snapshotSchema, undefined);
    assert.deepEqual(profile.fields.find((item) => item.field === "gstin")?.evidenceIds, ["doc-gst-r2"]);
  });

  test("evidence records are ignored unless the snapshot declares schema 2, and malformed records are dropped", async () => {
    const raw: any = rawSnapshot();
    raw.snapshotSchema = undefined;
    on("GET /passport/me", passportReply(raw));
    assert.equal((await api.getTrustProfile())?.evidence.length, 0);

    const messy: any = rawSnapshot();
    messy.evidence = [null, "x", { docType: "GST_CERTIFICATE" }, ...messy.evidence];
    on("GET /passport/me", passportReply(messy));
    assert.equal((await api.getTrustProfile())?.evidence.length, 2);
  });

  test("a freshly generated version maps identically to the stored one", async () => {
    on("POST /passport/generate", { status: 201, data: { passportId: "passport-7", version: 7, snapshot: rawSnapshot() } });
    on("GET /passport/me", passportReply(rawSnapshot()));
    assert.deepEqual(await api.generateTrustProfile(), await api.getTrustProfile());
  });
});

describe("explanations follow the displayed snapshot, not live documents", () => {
  test("changing live document rows leaves every explanation byte-identical", async () => {
    await signIn("owner");
    const business = (documents: unknown[]) => ({ data: { business: { ...(businessReply("Synthetic Textiles").data as any).business, documents } } });
    const liveDoc = (overrides: object) => ({ id: "doc-gst-r2", docType: "GST_CERTIFICATE", originalName: "gst.pdf", revision: 2, isCurrent: true, evidenceStatus: "DOCUMENT_SUBMITTED", expiresAt: "2027-01-10T00:00:00.000Z", source: "MSME_SUBMITTED", ...overrides });
    on("GET /passport/me", passportReply(rawSnapshot()));

    on("GET /business/me", business([liveDoc({})]));
    await app().loadBusiness();
    const render = () => JSON.stringify(app().trustProfile!.fields.map((claim) => explainClaim(app().trustProfile!, claim)));
    const before = render();

    // The owner replaces the document after the snapshot: new revision, expired, different name and source.
    on("GET /business/me", business([liveDoc({ isCurrent: false }), liveDoc({ id: "doc-gst-r3", revision: 3, originalName: "REPLACED.pdf", expiresAt: "2020-01-01T00:00:00.000Z", source: "Someone else", evidenceStatus: "EXPIRED" })]));
    await app().loadBusiness();
    assert.equal(app().business!.documents.length, 2, "live rows really changed");
    assert.equal(render(), before);
    assert.doesNotMatch(before, /REPLACED|doc-gst-r3|Someone else/);
  });

  test("logging out clears the profile, so no owner explanation data survives to the next account", async () => {
    await signIn("ownerA");
    on("GET /passport/me", passportReply(rawSnapshot()));
    on("GET /business/me", businessReply("Synthetic Textiles"));
    await app().loadBusiness();
    assert.ok(app().trustProfile);
    auth().logout();
    assert.equal(app().trustProfile, null);
    await signIn("ownerB");
    assert.equal(app().trustProfile, null);
  });
});
