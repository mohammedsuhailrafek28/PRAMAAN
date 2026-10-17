// Identity data must come from the current session only. Uses the real stores and API mapping.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { deferred, loginReply, on, resetServer, type MockReply } from "./support/mockServer.ts";

const { useAppStore } = await import("../src/store/appStore.ts");
const { useAuthStore } = await import("../src/store/authStore.ts");

const app = () => useAppStore.getState();
const auth = () => useAuthStore.getState();
const NOW_ISO = new Date().toISOString();
const consent = (id: string, requesterIdentity?: unknown) => ({
  id, status: "PENDING", createdAt: NOW_ISO, requestedFields: ["gstin"], requestedEvidenceTypes: [],
  requester: { id: "r1", name: "Meera", role: "BANK", organizationName: "Fake State Bank", ...(requesterIdentity === undefined ? {} : { requesterIdentity }) },
});

beforeEach(() => { resetServer(); localStorage.clear(); auth().logout(); });

async function signIn(id: string, role: "MSME" | "BUYER" | "BANK" = "MSME", extra: Record<string, unknown> = {}) {
  const base = loginReply(id, role, `t-${id}`).data as { token: string; user: Record<string, unknown> };
  on("POST /auth/login", { data: { ...base, user: { ...base.user, ...extra } } });
  return auth().loginAs(`${id}@x.test`, "password123");
}

describe("consent requests carry the requester identity", () => {
  test("a payload with no identity fields is UNVERIFIED (current backend, older rows)", async () => {
    await signIn("msme1");
    on("GET /consent-requests", { data: { requests: [consent("c1")] } });
    await app().loadConsentRequests();
    const identity = app().consentRequests[0].requesterIdentity;
    assert.equal(identity.level, "UNVERIFIED");
    assert.equal(identity.claimedOrganization, "Fake State Bank");
  });

  test("malformed identity data is UNVERIFIED and flagged malformed", async () => {
    await signIn("msme1");
    on("GET /consent-requests", { data: { requests: [consent("c1", "AUTHORIZED"), consent("c2", { assurance: "GOLD" }), consent("c3", { assurance: "AUTHORIZED", expiresAt: "soon" })] } });
    await app().loadConsentRequests();
    assert.equal(app().consentRequests.length, 3);
    for (const request of app().consentRequests) {
      assert.equal(request.requesterIdentity.level, "UNVERIFIED", request.id);
      assert.equal(request.requesterIdentity.malformed, true, request.id);
    }
  });

  test("reviewed identity is mapped with names, dates and basis", async () => {
    await signIn("msme1");
    on("GET /consent-requests", { data: { requests: [consent("c1", { assurance: "ORG_REVIEWED", reviewedOrganizationName: "Kisan Finance Limited", reviewedAt: "2026-10-12T00:00:00Z", basis: "Registry match" })] } });
    await app().loadConsentRequests();
    const identity = app().consentRequests[0].requesterIdentity;
    assert.equal(identity.level, "ORG_REVIEWED");
    assert.equal(identity.reviewedOrganization, "Kisan Finance Limited");
    assert.equal(identity.claimedOrganization, "Fake State Bank");
    assert.equal(identity.basis, "Registry match");
  });
});

describe("no stale identity across sessions", () => {
  test("switching user clears the previous user's requester identities", async () => {
    await signIn("msme1");
    on("GET /consent-requests", { data: { requests: [consent("c1", { assurance: "AUTHORIZED", expiresAt: "2099-01-01T00:00:00Z", reviewedOrganizationName: "Real Bank" })] } });
    await app().loadConsentRequests();
    assert.equal(app().consentRequests[0].requesterIdentity.level, "AUTHORIZED");

    auth().logout();
    assert.deepEqual(app().consentRequests, []);
    await signIn("msme2");
    assert.deepEqual(app().consentRequests, []);
  });

  test("a late identity response for the previous session is dropped", async () => {
    await signIn("msme1");
    const reply = deferred<MockReply>();
    on("GET /consent-requests", () => reply.promise);
    const pending = app().loadConsentRequests();

    auth().logout();
    await signIn("msme2");
    reply.resolve({ data: { requests: [consent("c1", { assurance: "AUTHORIZED", expiresAt: "2099-01-01T00:00:00Z" })] } });
    await pending;

    assert.deepEqual(app().consentRequests, []);
  });

  test("the signed-in requester's own identity is cleared on logout and never inherited", async () => {
    const bank = await signIn("bank1", "BANK", { requesterIdentity: { assurance: "AUTHORIZED", expiresAt: "2099-01-01T00:00:00Z" } });
    assert.equal(bank.requesterIdentity?.level, "AUTHORIZED");
    auth().logout();
    assert.equal(auth().currentUser, null);

    const next = await signIn("bank2", "BANK"); // the backend sends nothing for this account
    assert.equal(next.requesterIdentity?.level, "UNVERIFIED");
  });

  test("MSME accounts have no requester identity", async () => {
    const msme = await signIn("msme1", "MSME", { requesterIdentity: { assurance: "AUTHORIZED" } });
    assert.equal(msme.requesterIdentity, undefined);
  });
});
