// Exercises the real Zustand stores, API client and interceptors against a
// scripted server. Each test starts an operation as user A, ends A's session
// (logout or switching to B) while the request is still in flight, then lets the
// response arrive late and checks that nothing from A reaches B.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { businessReply, deferred, on, loginReply, requests, resetServer, sent, type MockReply } from "./support/mockServer.ts";

const { useAppStore } = await import("../src/store/appStore.ts");
const { useAuthStore } = await import("../src/store/authStore.ts");
const { StaleSessionError } = await import("../src/services/sessionEpoch.ts");

const app = () => useAppStore.getState();
const auth = () => useAuthStore.getState();
const SCOPE = { fields: ["gstin"], evidence: [] };
const PROFILE = { legalName: "A Corp", gstin: "", udyamNumber: "", pan: "", address: "", turnoverBand: "" };

async function signIn(id: string, role: "MSME" | "BUYER" | "BANK" = "MSME") {
  on("POST /auth/login", loginReply(id, role, `token-${id}`));
  return auth().loginAs(`${id}@x.test`, "password123");
}
/** Everything the client sent after `mark`. */
const since = (mark: number) => requests.slice(mark);
const httpError = (status: number): MockReply => ({ status, data: { error: { code: "INTERNAL_SERVER_ERROR", message: "boom" } } });
const tick = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  resetServer();
  localStorage.clear();
  auth().logout();
});

describe("mutations that finish after the session ended", () => {
  test("saveBusinessProfile: result is discarded and rejects as stale", async () => {
    await signIn("userA");
    const reply = deferred<MockReply>();
    on("POST /business", () => reply.promise);
    const pending = app().saveBusinessProfile(PROFILE);

    auth().logout();
    await signIn("userB");
    reply.resolve(businessReply("A Corp"));

    await assert.rejects(pending, StaleSessionError);
    assert.equal(app().business, null);
    assert.equal(app().error, null);
  });

  test("a late error from the old session is not shown to the new user", async () => {
    await signIn("userA");
    const reply = deferred<MockReply>();
    on("POST /business", () => reply.promise);
    const pending = app().saveBusinessProfile(PROFILE);

    auth().logout();
    await signIn("userB");
    reply.resolve(httpError(500));

    await assert.rejects(pending, StaleSessionError);
    assert.equal(app().error, null);
  });

  test("uploadBusinessDocument: late failure does not set the new user's error", async () => {
    await signIn("userA");
    const reply = deferred<MockReply>();
    on("POST /business/documents", () => reply.promise);
    const pending = app().uploadBusinessDocument("gst_certificate", new File(["x"], "a.pdf", { type: "application/pdf" }));

    auth().logout();
    await signIn("userB");
    reply.resolve(httpError(400));

    await assert.rejects(pending, StaleSessionError);
    assert.equal(app().error, null);
  });

  test("crossCheckBusiness: no state write, no loading flag, no follow-up requests", async () => {
    await signIn("userA");
    const reply = deferred<MockReply>();
    on("POST /business/cross-check", () => reply.promise);
    on("GET /business/me", businessReply("B Corp"));
    const pending = app().crossCheckBusiness();

    auth().logout();
    await signIn("userB");
    const mark = requests.length;
    reply.resolve({ data: { trustStatus: "CROSS_CHECKED", profile: { summary: { trustReadiness: 99 } } } });

    await assert.rejects(pending, StaleSessionError);
    assert.equal(app().crossCheckResult, null);
    assert.equal(app().business, null);
    assert.equal(app().loading, false);
    assert.deepEqual(since(mark), [], "a stale cross-check must not send follow-up requests under the new token");
  });

  test("generateTrustProfile: no state write and no follow-up requests", async () => {
    await signIn("userA");
    const reply = deferred<MockReply>();
    on("POST /passport/generate", () => reply.promise);
    const pending = app().generateTrustProfile();

    auth().logout();
    await signIn("userB");
    const mark = requests.length;
    reply.resolve({ data: { snapshot: { version: 7, summary: {} }, passportId: "p1" } });

    await assert.rejects(pending, StaleSessionError);
    assert.equal(app().trustProfile, null);
    assert.deepEqual(since(mark), []);
  });

  for (const action of ["approve", "reject", "revoke"] as const) {
    test(`${action}ConsentRequest: no reloads for the new user`, async () => {
      await signIn("userA");
      const reply = deferred<MockReply>();
      on(`PATCH /consent-requests/c1/${action}`, () => reply.promise);
      on("GET /consent-requests", { data: { requests: [] } });
      on("GET /audit-logs", { data: { logs: [] } });
      const pending = action === "approve" ? app().approveConsentRequest("c1", SCOPE, 24)
        : action === "reject" ? app().rejectConsentRequest("c1") : app().revokeConsentRequest("c1");

      auth().logout();
      await signIn("userB");
      const mark = requests.length;
      reply.resolve({ data: { consent: { id: "c1", status: "APPROVED" } } });

      await assert.rejects(pending, StaleSessionError);
      assert.deepEqual(since(mark), []);
      assert.deepEqual(app().consentRequests, []);
    });
  }

  test("approve: session ending between the mutation and the reload stops the audit reload", async () => {
    await signIn("userA");
    const listReply = deferred<MockReply>();
    on("PATCH /consent-requests/c1/approve", { data: { consent: { id: "c1", status: "APPROVED" } } });
    on("GET /consent-requests", () => listReply.promise);
    on("GET /audit-logs", { data: { logs: [] } });
    const pending = app().approveConsentRequest("c1", SCOPE, 24);
    await tick(); // mutation done, list reload in flight

    auth().logout();
    await signIn("userB");
    const mark = requests.length;
    listReply.resolve({ data: { requests: [{ id: "c1", status: "PENDING", requester: { organizationName: "Secret Bank" }, createdAt: new Date().toISOString() }] } });

    await assert.rejects(pending, StaleSessionError);
    assert.deepEqual(app().consentRequests, [], "A's request list must not appear for B");
    assert.equal(sent("GET /audit-logs"), 0);
    assert.deepEqual(since(mark), []);
  });

  test("markNotificationRead: does not mark the new user's notification as read", async () => {
    await signIn("userA");
    const notes = { data: { notifications: [{ id: "n1", userId: "u", message: "hello", readFlag: false, createdAt: new Date().toISOString() }] } };
    on("GET /notifications", notes);
    await app().loadNotifications();
    const reply = deferred<MockReply>();
    on("PATCH /notifications/n1/read", () => reply.promise);
    const pending = app().markNotificationRead("n1");

    auth().logout();
    await signIn("userB");
    await app().loadNotifications(); // B has its own, unread "n1"
    reply.resolve({ data: {} });

    await pending; // fire-and-forget action: an obsolete session resolves quietly
    assert.equal(app().notifications[0].read, false);
  });
});

describe("loaders", () => {
  test("loadBusiness result for a signed-out user never renders", async () => {
    await signIn("userA");
    const reply = deferred<MockReply>();
    on("GET /business/me", () => reply.promise);
    on("GET /passport/me", { status: 404, data: { error: { code: "NOT_FOUND" } } });
    const pending = app().loadBusiness();

    auth().logout();
    reply.resolve(businessReply("Sharma Textiles"));
    await pending;

    assert.equal(app().business, null);
    assert.equal(app().loading, false);
  });

  test("control: within one session the same mutation still updates state", async () => {
    await signIn("userA");
    on("PATCH /consent-requests/c1/reject", { data: { consent: { id: "c1", status: "REJECTED" } } });
    on("GET /consent-requests", { data: { requests: [{ id: "c1", status: "REJECTED", createdAt: new Date().toISOString() }] } });
    on("GET /audit-logs", { data: { logs: [] } });
    await app().rejectConsentRequest("c1");
    assert.equal(app().consentRequests.length, 1);
    assert.equal(sent("GET /audit-logs"), 1);
  });
});

describe("auth store", () => {
  test("logout while a login is in flight discards the session and the stored token", async () => {
    const reply = deferred<MockReply>();
    on("POST /auth/login", () => reply.promise);
    const pending = auth().loginAs("a@x.test", "password123");

    auth().logout();
    reply.resolve(loginReply("userA", "MSME", "late-token"));

    await assert.rejects(pending, StaleSessionError);
    assert.equal(auth().currentUser, null);
    assert.equal(localStorage.getItem("pramaan_access_token"), null);
    assert.equal(auth().loading, false);
  });

  test("a second sign-in while one is pending is refused", async () => {
    const reply = deferred<MockReply>();
    on("POST /auth/login", () => reply.promise);
    const first = auth().loginAs("a@x.test", "password123");
    await assert.rejects(auth().loginAs("b@x.test", "password123"), /already in progress/);
    reply.resolve(loginReply("userA", "MSME", "token-A"));
    await first;
    assert.equal(auth().currentUser?.id, "userA");
  });

  test("login returns the account's real role", async () => {
    const user = await signIn("userA", "BANK");
    assert.equal(user.role, "bank");
  });

  test("a 401 on an authenticated request ends the session and clears app state", async () => {
    await signIn("userA");
    on("GET /business/me", businessReply("A Corp"));
    on("GET /passport/me", { status: 404, data: {} });
    await app().loadBusiness();
    assert.equal(app().business?.legalName, "A Corp");

    on("GET /audit-logs", { status: 401, data: { error: { code: "UNAUTHORIZED", message: "expired" } } });
    await app().loadAuditLogs();

    assert.equal(auth().currentUser, null);
    assert.equal(auth().sessionExpired, true);
    assert.equal(app().business, null);
    assert.equal(localStorage.getItem("pramaan_access_token"), null);
  });

  test("a 401 from a wrong password is not a session expiry", async () => {
    on("POST /auth/login", { status: 401, data: { error: { code: "UNAUTHORIZED", message: "Invalid email or password." } } });
    await assert.rejects(auth().loginAs("a@x.test", "wrong"));
    assert.equal(auth().sessionExpired, false);
    assert.equal(auth().loading, false);
  });

  test("restoreSession finishing after a logout does not resurrect the user", async () => {
    localStorage.setItem("pramaan_access_token", "old-token");
    const reply = deferred<MockReply>();
    on("GET /auth/me", () => reply.promise);
    const pending = auth().restoreSession();

    auth().logout();
    reply.resolve({ data: { user: { id: "userA", role: "MSME", email: "a@x.test", name: "A", organizationName: "A Org" } } });
    await pending;

    assert.equal(auth().currentUser, null);
    assert.equal(auth().hydrating, false);
  });
});
