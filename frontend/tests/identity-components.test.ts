// Renders the real identity components to static markup and checks what a reader
// (and assistive technology) would get: text, not colour alone; no stale or
// invented facts; dates and basis only when the backend supplied them.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { parseRequesterIdentity } from "../src/lib/requesterIdentity.ts";

const { RequesterIdentityBadge, RequesterIdentityDetails, RequesterOrganization } = await import("../src/components/shared/RequesterIdentityBadge.tsx");
const { DisclosureSelector } = await import("../src/components/shared/DisclosureSelector.tsx");

const FUTURE = "2099-01-01T00:00:00Z";
const PAST = "2020-01-01T00:00:00Z";
const id = (over: Record<string, unknown>) => parseRequesterIdentity({ assurance: "UNVERIFIED", ...over }, "Typed Name Ltd");
const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("RequesterIdentityBadge", () => {
  const cases: [string, ReturnType<typeof id>, RegExp][] = [
    ["UNVERIFIED", id({}), /Self-registered · Not independently checked/],
    ["ORG_REVIEWED", id({ assurance: "ORG_REVIEWED" }), /Organization reviewed · Authority not established/],
    ["AUTHORIZED", id({ assurance: "AUTHORIZED", expiresAt: FUTURE }), /Requester authorization reviewed · Expires 01 Jan 2099/],
    ["SUSPENDED", id({ assurance: "SUSPENDED" }), /Requester suspended/],
    ["expired AUTHORIZED", id({ assurance: "AUTHORIZED", expiresAt: PAST }), /Review expired · Not currently checked/],
    ["malformed", parseRequesterIdentity({ assurance: "GOLD" }, "X"), /Self-registered · Not independently checked/],
  ];
  for (const [name, identity, label] of cases) {
    test(`${name}: shows its status as text with an accessible description and a hidden icon`, () => {
      const markup = html(createElement(RequesterIdentityBadge, { identity }));
      assert.match(text(markup), label);
      assert.match(markup, /aria-label="[^"]+\. [^"]+"/); // label + explanation for assistive technology
      assert.match(markup, /<svg[^>]*aria-hidden="true"/); // icon is decorative; the words carry the meaning
    });
  }

  test("only an authorization in force is rendered with the positive style", () => {
    const positive = (identity: ReturnType<typeof id>) => html(createElement(RequesterIdentityBadge, { identity })).includes("border-positive-border");
    assert.equal(positive(id({ assurance: "AUTHORIZED", expiresAt: FUTURE })), true);
    for (const identity of [id({}), id({ assurance: "ORG_REVIEWED" }), id({ assurance: "SUSPENDED" }), id({ assurance: "AUTHORIZED", expiresAt: PAST })]) {
      assert.equal(positive(identity), false);
    }
  });
});

describe("RequesterOrganization", () => {
  test("a reviewed name is primary and the registered name is labelled as claimed", () => {
    const markup = text(html(createElement(RequesterOrganization, { identity: id({ assurance: "ORG_REVIEWED", reviewedOrganizationName: "Kisan Finance Limited" }), fallbackName: "x" })));
    assert.match(markup, /^Kisan Finance Limited Organization name as reviewed by Pramaan/);
    assert.match(markup, /registered as “Typed Name Ltd”, which differs from the reviewed name/);
  });

  test("an unverified name is labelled as typed by the requester and unchecked", () => {
    assert.match(text(html(createElement(RequesterOrganization, { identity: id({}), fallbackName: "x" }))), /Typed Name Ltd Name typed by the requester, not checked/);
  });

  test("a lapsed review does not present the reviewed name as current", () => {
    const markup = text(html(createElement(RequesterOrganization, { identity: id({ assurance: "AUTHORIZED", expiresAt: PAST, reviewedOrganizationName: "Real Bank" }), fallbackName: "x" })));
    assert.doesNotMatch(markup, /Real Bank/);
    assert.match(markup, /not checked/);
  });

  test("renders as a heading when asked, for document structure", () => {
    assert.match(html(createElement(RequesterOrganization, { identity: id({}), fallbackName: "x", heading: true })), /<h3 /);
  });
});

describe("RequesterIdentityDetails", () => {
  test("shows review date, expiry and basis only when the backend supplied them", () => {
    const full = text(html(createElement(RequesterIdentityDetails, { identity: id({ assurance: "AUTHORIZED", reviewedAt: "2026-10-12T00:00:00Z", expiresAt: FUTURE, basis: "Registry match and mandate letter" }), fallbackName: "x" })));
    assert.match(full, /Reviewed on 12 Oct 2026/);
    assert.match(full, /Expires on 01 Jan 2099/);
    assert.match(full, /Basis Registry match and mandate letter/);

    const bare = text(html(createElement(RequesterIdentityDetails, { identity: id({ assurance: "ORG_REVIEWED" }), fallbackName: "x" })));
    assert.doesNotMatch(bare, /Reviewed on|Expires on|Expired on|Basis/);
  });

  test("an expired authorization says it expired and still lists what it does not show", () => {
    const markup = text(html(createElement(RequesterIdentityDetails, { identity: id({ assurance: "AUTHORIZED", reviewedAt: "2026-01-01T00:00:00Z", expiresAt: PAST, basis: "Mandate letter" }), fallbackName: "x" })));
    assert.match(markup, /Expired on 01 Jan 2020/);
    assert.match(markup, /Review expired · Not currently checked/);
    assert.match(markup, /Treat them as not independently checked/);
    assert.match(markup, /What this does not show/);
  });

  test("organization review alone explains that authority is not established", () => {
    const markup = text(html(createElement(RequesterIdentityDetails, { identity: id({ assurance: "ORG_REVIEWED", reviewedOrganizationName: "Kisan Finance Limited" }), fallbackName: "x" })));
    assert.match(markup, /has not established that this account may act for it/);
    assert.match(markup, /does not show that the person using this account is authori[sz]ed to represent the organization/);
  });

  test("a suspended requester is announced as suspended, not as a neutral status", () => {
    const markup = html(createElement(RequesterIdentityDetails, { identity: id({ assurance: "SUSPENDED" }), fallbackName: "x" }));
    assert.match(markup, /data-assurance="SUSPENDED"/);
    assert.match(text(markup), /Do not share information with them/);
    assert.doesNotMatch(markup, /border-positive-border/);
  });

  test("is a labelled region with list and definition structure for screen readers", () => {
    const markup = html(createElement(RequesterIdentityDetails, { identity: id({}), fallbackName: "x" }));
    assert.match(markup, /<section aria-label="Requester identity"/);
    assert.match(markup, /<ul[^>]*>.*<li>/s);
    assert.match(markup, /<dl /);
  });

  test("an unverified requester's warning is in words, not only colour", () => {
    const markup = text(html(createElement(RequesterIdentityDetails, { identity: id({}), fallbackName: "x" })));
    assert.match(markup, /Anyone can register with any organization name/);
    assert.match(markup, /It does not show the organization exists/);
  });
});

describe("requester-facing restricted-disclosure note", () => {
  test("DisclosureSelector shows a note beside restricted items without disabling them", () => {
    const markup = html(createElement(DisclosureSelector, {
      idPrefix: "t", value: { fields: ["turnoverBand"], evidence: [] }, onChange: () => undefined,
      notes: { turnoverBand: "Needs a reviewed requester. May be refused for your account." },
    }));
    assert.match(text(markup), /Needs a reviewed requester\. May be refused for your account\./);
    const at = markup.indexOf('id="t-field-turnoverBand"');
    assert.ok(at > 0);
    assert.doesNotMatch(markup.slice(at, at + 300), /disabled/);
  });
});
