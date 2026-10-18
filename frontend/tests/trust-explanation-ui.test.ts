import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server.mjs";

import { legacyProfile, schema2Profile } from "./support/trustFixtures.ts";

// Short failure messages: the rendered markup is large and should never be dumped into test output.
const match = (text: string, pattern: RegExp, label = "") => assert.ok(pattern.test(text), `expected markup to match ${pattern} ${label}`.trim());
const noMatch = (text: string, pattern: RegExp, label = "") => assert.ok(!pattern.test(text), `expected markup not to match ${pattern} ${label}`.trim());

const { explainClaim } = await import("../src/lib/claimExplanation.ts");
const { TrustExplanationContent } = await import("../src/components/shared/TrustExplanationPanel.tsx");
const { TrustProfilePage } = await import("../src/pages/msme/TrustProfilePage.tsx");
const { useAppStore } = await import("../src/store/appStore.ts");

const markupFor = (profile: ReturnType<typeof schema2Profile>, name: string) => {
  const claim = profile.fields.find((item) => item.field === name)!;
  return renderToStaticMarkup(createElement(TrustExplanationContent, { explanation: explainClaim(profile, claim) }));
};

test("the explanation shows the five required sections", () => {
  const html = markupFor(schema2Profile(), "pan");
  for (const heading of ["Claim assessment", "How Pramaan assessed it", "Supporting evidence", "Conflicts and gaps", "What this does not mean"]) match(html, new RegExp(heading), heading);
  match(html, /Trust Profile version 7/);
});

test("status is communicated in text, not colour alone", () => {
  match(markupFor(schema2Profile(), "pan"), /Conflict found/);
  match(markupFor(schema2Profile(), "udyamNumber"), /Evidence expired/);
  match(markupFor(schema2Profile(), "gstin"), /Supported by internal checks/);
  match(markupFor(schema2Profile(), "address"), /Not assessed against evidence/);
  match(markupFor(schema2Profile(), "bankAccount"), /Not provided/);
  match(markupFor(schema2Profile(), "gstin"), /Passed/);
  match(markupFor(schema2Profile(), "udyamNumber"), /Did not pass/);
});

test("recorded check reasons and conflict values are shown verbatim, to the owner, with their audience stated", () => {
  const html = markupFor(schema2Profile(), "pan");
  match(html, /The claim conflicts with another submitted identifier\./);
  match(html, /ABCDE1234F/);
  match(html, /ZZZZZ9999Z/);
  match(html, /Shown only to you/);
  match(markupFor(schema2Profile(), "bankAccount"), /Evidence needed: Bank statement/);
});

test("the limitation is always stated and nothing claims external verification", () => {
  for (const claim of schema2Profile().fields) {
    const html = markupFor(schema2Profile(), claim.field);
    match(html, /No external source was consulted for this claim\./);
    match(html, /does not query GST, Udyam, bank, or other government systems/);
    noMatch(html, /government[- ]verified|bank[- ]verified|source[- ]confirmed|verified by|authenticity (is )?confirmed/i);
  }
});

test("schema-2 evidence shows recorded revision and dates; an absent expiry is stated as not recorded", () => {
  const gst = markupFor(schema2Profile(), "gstin");
  match(gst, /GST certificate/);
  match(gst, /Revision/);
  match(gst, /10 Jan 2027/);
  noMatch(gst, /Not captured in this historical version/);
  const profile = schema2Profile();
  profile.evidence = profile.evidence.map((record) => (record.documentId === "doc-gst-r2" ? { ...record, expiresAt: null } : record));
  match(markupFor(profile, "gstin"), /No expiry date recorded/);
});

test("legacy snapshots say the metadata is unavailable and never 'no expiry'", () => {
  const html = markupFor(legacyProfile(), "gstin");
  match(html, /Not captured in this historical version/);
  noMatch(html, /No expiry date recorded|No expiry recorded/);
  match(html, /historical version recorded before evidence details were captured/);
});

test("long values wrap instead of overflowing", () => {
  const profile = schema2Profile();
  const long = "A".repeat(300);
  profile.fields = profile.fields.map((claim) => (claim.field === "address" ? { ...claim, value: long, reason: long } : claim));
  const html = markupFor(profile, "address");
  match(html, /overflow-wrap:anywhere/);
  match(html, new RegExp(long));
  match(markupFor(profile, "pan"), /break-all/);
});

function renderPage(profile: ReturnType<typeof schema2Profile>) {
  useAppStore.setState({
    business: { id: "b-1", ownerId: "u", legalName: "Synthetic Textiles", gstin: "33TESTX0001A1Z5", udyamNumber: "", pan: "", address: "", turnoverBand: "", trustStatus: "CROSS_CHECKED", sourceVerificationPerformed: false, documents: [], lastCrossCheckedAt: "2026-10-01T10:00:00.000Z" },
    trustProfile: profile, loading: false, error: null,
  } as never);
  // zustand renders its *initial* state on the server; copy the prepared state into that object so the page renders it.
  Object.assign(useAppStore.getInitialState(), useAppStore.getState());
  return renderToStaticMarkup(createElement(StaticRouter, { location: "/msme/trust-profile" }, createElement(TrustProfilePage)));
}

test("the existing desktop claims table is preserved and gains an explanation action per claim", () => {
  const html = renderPage(schema2Profile());
  match(html, /<caption class="sr-only">Claims and their check status in this Trust Profile version<\/caption>/);
  for (const header of ["Claim", "Value", "Status", "Freshness", "How Pramaan knows", "Explanation"]) match(html, new RegExp(`<th scope="col"[^>]*>${header}</th>`), header);
  match(html, /hidden overflow-x-auto md:block/, "table is the desktop layout");
  const label = "Why\\? Explanation for Legal business name";
  assert.equal((html.match(new RegExp(`aria-label="${label}"`, "g")) ?? []).length, 2, "one trigger in the table and one on the mobile card");
  assert.equal((html.match(/aria-label="Why\? Explanation for /g) ?? []).length, 16, "eight claims x two layouts");
});

test("mobile layout uses claim cards with a 44px action and no wide table", () => {
  const html = renderPage(schema2Profile());
  match(html, /<ul class="[^"]*md:hidden"[^>]*aria-label="Claims and their check status"/);
  match(html, /min-h-\[44px\] w-full/);
  const cards = html.slice(html.indexOf('aria-label="Claims and their check status"'), html.indexOf("hidden overflow-x-auto md:block"));
  match(cards, /Conflict found/);
  match(cards, /break-all font-mono/);
  noMatch(cards, /min-w-\[640px\]/);
});

test("the page opens no explanation until asked, and still shows the pre-existing sections", () => {
  const html = renderPage(schema2Profile());
  noMatch(html, /role="dialog"/);
  for (const text of ["Evidence behind this version", "Conflicts and gaps", "What Pramaan does not verify"]) match(html, new RegExp(text), text);
});

test("requester, guest and consent surfaces do not use owner explanations", () => {
  for (const file of ["pages/shared/DynamicTrustViewPage.tsx", "pages/shared/ExternalVerificationPage.tsx", "components/shared/SharedFieldRow.tsx", "lib/sharedFields.ts", "components/consent/ApproveDialog.tsx", "components/consent/ScopeColumns.tsx", "pages/msme/ConsentCenterPage.tsx"]) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    noMatch(source, /claimExplanation|TrustExplanation|evidenceIds|claimedValue/, file);
  }
});
