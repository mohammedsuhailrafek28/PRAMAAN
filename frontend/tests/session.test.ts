import assert from "node:assert/strict";
import { test } from "node:test";

import { isSessionExpiry, notifyUnauthorized, onUnauthorized } from "../src/services/session.ts";

test("a 401 on an authenticated request ends the session", () => {
  assert.equal(isSessionExpiry(401, true), true);
});

test("a 401 without a token (wrong password at login) is not a session expiry", () => {
  assert.equal(isSessionExpiry(401, false), false);
});

test("other statuses never end the session", () => {
  for (const status of [undefined, 200, 400, 403, 404, 429, 500]) assert.equal(isSessionExpiry(status, true), false);
});

test("the registered listener is notified, and can be removed", () => {
  let calls = 0;
  onUnauthorized(() => { calls += 1; });
  notifyUnauthorized();
  assert.equal(calls, 1);
  onUnauthorized(null);
  notifyUnauthorized();
  assert.equal(calls, 1);
});
