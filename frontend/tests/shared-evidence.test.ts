import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { SharedEvidenceRow } = await import("../src/components/shared/SharedFieldRow.tsx");

const evidence = { docType: "GST_CERTIFICATE", evidenceStatus: "CROSS_CHECKED", confidence: 80, source: null, issuedAt: null, checkedAt: null, expiresAt: null, uploadedAt: null };

test("legacy pinned evidence explains that expiry was not captured", () => {
  const markup = renderToStaticMarkup(createElement(SharedEvidenceRow, { evidence, evidenceBasis: "LEGACY_SNAPSHOT" }));
  assert.match(markup, /Not captured in historical snapshot/);
  assert.doesNotMatch(markup, /No expiry recorded/);
});

test("current snapshot evidence uses the ordinary no-expiry wording", () => {
  const markup = renderToStaticMarkup(createElement(SharedEvidenceRow, { evidence, evidenceBasis: "SNAPSHOT" }));
  assert.match(markup, /No expiry date/);
  assert.doesNotMatch(markup, /Not captured in historical snapshot/);
});
