import assert from "node:assert/strict";
import { test } from "node:test";

import { gstinSchema, normalizeIdentifier, panSchema, udyamSchema } from "../src/lib/identifiers.ts";

test("lowercase and padded GSTIN is normalised to the canonical form", () => {
  assert.equal(gstinSchema.parse("  33abcde1234f1z5 "), "33ABCDE1234F1Z5");
});

test("lowercase PAN and Udyam numbers are accepted and upper-cased", () => {
  assert.equal(panSchema.parse("abcde1234f"), "ABCDE1234F");
  assert.equal(udyamSchema.parse("udyam-tn-33-0001234"), "UDYAM-TN-33-0001234");
});

test("genuinely invalid identifiers are still rejected", () => {
  assert.equal(gstinSchema.safeParse("33ABCDE1234F1Z").success, false);
  assert.equal(panSchema.safeParse("ABCDE12345").success, false);
  assert.equal(udyamSchema.safeParse("UDYAM-TN-33-123").success, false);
});

test("normalizeIdentifier trims and upper-cases", () => {
  assert.equal(normalizeIdentifier(" ab12 "), "AB12");
});
