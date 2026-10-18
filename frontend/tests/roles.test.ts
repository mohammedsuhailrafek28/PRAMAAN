import assert from "node:assert/strict";
import { test } from "node:test";

import { homeForRole, isAppRole, parseRoleParam } from "../src/lib/roles.ts";

test("each role routes to its own workspace", () => {
  assert.equal(homeForRole("msme"), "/msme/dashboard");
  assert.equal(homeForRole("buyer"), "/buyer/dashboard");
  assert.equal(homeForRole("bank"), "/bank/dashboard");
});

test("an account's real role decides the destination, whatever tab was chosen", () => {
  const selectedTab = "buyer";
  const authenticatedRole = "msme";
  assert.notEqual(homeForRole(authenticatedRole), homeForRole(selectedTab));
  assert.equal(homeForRole(authenticatedRole), "/msme/dashboard");
});

test("?role= query values are validated with an MSME fallback", () => {
  assert.equal(parseRoleParam("bank"), "bank");
  assert.equal(parseRoleParam("admin"), "msme");
  assert.equal(parseRoleParam(null), "msme");
  assert.equal(isAppRole("Buyer"), false);
});
