// Requester identity assurance: parsing, expiry, wording, restrictions and the approval gate.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  approvalGate, describeAssurance, effectiveAssurance, identityFromPayload, identityNote, isRestrictedFor,
  organizationNames, parseRequesterIdentity, restrictedItems, restrictionMessage, type RequesterIdentity,
} from "../src/lib/requesterIdentity.ts";
import { disclosureItem } from "../src/lib/disclosure.ts";
import { renderAuditEvent } from "../src/lib/auditEvents.ts";
import type { AuditLogEntry } from "../src/types/index.ts";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const FUTURE = "2026-12-31T00:00:00Z";
const PAST = "2026-10-01T00:00:00Z";

const identity = (over: Record<string, unknown>) => parseRequesterIdentity({ assurance: "UNVERIFIED", ...over }, "Typed Name Ltd");

describe("parsing", () => {
  for (const level of ["UNVERIFIED", "ORG_REVIEWED", "AUTHORIZED", "SUSPENDED"] as const) {
    test(`${level} is understood`, () => {
      const parsed = identity({ assurance: level, reviewedAt: PAST, expiresAt: FUTURE });
      assert.equal(parsed.level, level);
      assert.equal(parsed.malformed, false);
    });
  }

  test("missing identity metadata is UNVERIFIED, not an error", () => {
    for (const raw of [undefined, null]) {
      const parsed = parseRequesterIdentity(raw, "Typed Name Ltd");
      assert.equal(parsed.level, "UNVERIFIED");
      assert.equal(parsed.malformed, false);
      assert.equal(parsed.claimedOrganization, "Typed Name Ltd");
    }
  });

  test("malformed identity metadata fails conservatively to UNVERIFIED", () => {
    const cases: unknown[] = ["AUTHORIZED", 42, true, [], ["AUTHORIZED"], {}, { assurance: 3 }, { assurance: "TRUSTED" }, { assurance: "VERIFIED" }, { assurance: "" }];
    for (const raw of cases) {
      const parsed = parseRequesterIdentity(raw, "X");
      assert.equal(parsed.level, "UNVERIFIED", JSON.stringify(raw));
      assert.equal(parsed.malformed, true, JSON.stringify(raw));
    }
  });

  test("a review with unreadable dates is not trusted", () => {
    assert.equal(identity({ assurance: "AUTHORIZED", expiresAt: "next tuesday" }).level, "UNVERIFIED");
    assert.equal(identity({ assurance: "ORG_REVIEWED", reviewedAt: 12345 }).level, "UNVERIFIED");
  });

  test("oversized and non-string text is bounded or dropped", () => {
    const parsed = identity({ assurance: "ORG_REVIEWED", reviewedOrganizationName: "A".repeat(5000), basis: { evil: true } });
    assert.equal(parsed.reviewedOrganization?.length, 240);
    assert.equal(parsed.basis, undefined);
  });

  test("the identity is found on the payload or nested under requester", () => {
    assert.equal(identityFromPayload({ requesterIdentity: { assurance: "SUSPENDED" } }).level, "SUSPENDED");
    assert.equal(identityFromPayload({ requester: { requesterIdentity: { assurance: "ORG_REVIEWED" } } }).level, "ORG_REVIEWED");
    assert.equal(identityFromPayload({ requester: {} }).level, "UNVERIFIED");
  });

  test("maps the backend requesterIdentity contract without inventing reviewed data", () => {
    const parsed = identityFromPayload({
      requesterIdentity: {
        status: "AUTHORIZED",
        displayName: "Claimed Bank Name",
        reviewBasis: "independent-authority-review-001",
        reviewedAt: "2026-10-12T00:00:00Z",
        authorizationExpiresAt: FUTURE,
        limitations: [],
      },
    });
    assert.equal(parsed.level, "AUTHORIZED");
    assert.equal(parsed.claimedOrganization, "Claimed Bank Name");
    assert.equal(parsed.reviewedOrganization, undefined);
    assert.equal(parsed.basis, "independent-authority-review-001");
    assert.equal(parsed.expiresAt, new Date(FUTURE).toISOString());
    assert.equal(parsed.malformed, false);
  });
});

describe("expiry and suspension never look active", () => {
  test("an unexpired AUTHORIZED review is in force", () => {
    assert.deepEqual(effectiveAssurance(identity({ assurance: "AUTHORIZED", expiresAt: FUTURE }), NOW), { level: "AUTHORIZED", lapsed: false });
  });

  test("an expired AUTHORIZED review counts as UNVERIFIED and is marked lapsed", () => {
    assert.deepEqual(effectiveAssurance(identity({ assurance: "AUTHORIZED", expiresAt: PAST }), NOW), { level: "UNVERIFIED", lapsed: true });
  });

  test("expiring exactly now is already expired", () => {
    assert.equal(effectiveAssurance(identity({ assurance: "ORG_REVIEWED", expiresAt: new Date(NOW).toISOString() }), NOW).lapsed, true);
  });

  test("a lapsed review is described as expired, with a warning tone and no positive wording", () => {
    const d = describeAssurance(identity({ assurance: "AUTHORIZED", reviewedAt: "2026-01-01T00:00:00Z", expiresAt: PAST }), NOW);
    assert.match(d.label, /^Review expired/);
    assert.equal(d.tone, "warning");
    assert.doesNotMatch(d.label + d.summary, /authorization reviewed/i);
  });

  test("a suspended requester is never active, even with a future expiry", () => {
    const suspended = identity({ assurance: "SUSPENDED", expiresAt: FUTURE });
    assert.equal(effectiveAssurance(suspended, NOW).level, "SUSPENDED");
    const d = describeAssurance(suspended, NOW);
    assert.equal(d.label, "Requester suspended");
    assert.equal(d.tone, "negative");
  });

  test("an expiry without a review still cannot make UNVERIFIED active", () => {
    assert.equal(effectiveAssurance(identity({ assurance: "UNVERIFIED", expiresAt: FUTURE }), NOW).level, "UNVERIFIED");
  });
});

describe("wording", () => {
  test("labels match the agreed text", () => {
    assert.equal(describeAssurance(identity({}), NOW).label, "Self-registered · Not independently checked");
    assert.equal(describeAssurance(identity({ assurance: "ORG_REVIEWED" }), NOW).label, "Organization reviewed · Authority not established");
    assert.match(describeAssurance(identity({ assurance: "AUTHORIZED", expiresAt: FUTURE }), NOW).label, /^Requester authorization reviewed · Expires \d{2} \w{3} 2026$/);
  });

  test("no badge uses vague or overreaching language", () => {
    const states = [identity({}), identity({ assurance: "ORG_REVIEWED" }), identity({ assurance: "AUTHORIZED", expiresAt: FUTURE }), identity({ assurance: "SUSPENDED" }), identity({ assurance: "AUTHORIZED", expiresAt: PAST })];
    for (const state of states) {
      assert.doesNotMatch(describeAssurance(state, NOW).label, /trusted|RBI|government|certified|approved|verified/i);
    }
  });

  test("organization review alone is never presented as proof of authority", () => {
    const d = describeAssurance(identity({ assurance: "ORG_REVIEWED" }), NOW);
    assert.equal(d.tone, "info"); // not the positive tone reserved for AUTHORIZED
    assert.match(d.label, /Authority not established/);
    assert.match(d.doesNotProve.join(" "), /authori[sz]ed to represent/i);
    assert.doesNotMatch(d.proves.join(" "), /authori[sz]ed|authority/i);
  });

  test("every state says what it shows and what it does not", () => {
    for (const state of [identity({}), identity({ assurance: "ORG_REVIEWED" }), identity({ assurance: "AUTHORIZED", expiresAt: FUTURE }), identity({ assurance: "SUSPENDED" })]) {
      const d = describeAssurance(state, NOW);
      assert.ok(d.proves.length > 0 && d.doesNotProve.length > 0 && d.summary.length > 0);
    }
  });

  test("only AUTHORIZED in force gets the positive tone", () => {
    const tones = [identity({}), identity({ assurance: "ORG_REVIEWED" }), identity({ assurance: "SUSPENDED" }), identity({ assurance: "AUTHORIZED", expiresAt: PAST })].map((s) => describeAssurance(s, NOW).tone);
    assert.ok(!tones.includes("positive"));
    assert.equal(describeAssurance(identity({ assurance: "AUTHORIZED", expiresAt: FUTURE }), NOW).tone, "positive");
  });
});

describe("claimed versus reviewed organization", () => {
  test("a reviewed name in force is primary and a differing claim is shown separately", () => {
    const names = organizationNames(identity({ assurance: "ORG_REVIEWED", reviewedOrganizationName: "Kisan Finance Limited" }), "x", NOW);
    assert.equal(names.primary, "Kisan Finance Limited");
    assert.equal(names.primaryIsReviewed, true);
    assert.equal(names.claimed, "Typed Name Ltd");
    assert.equal(names.claimedDiffersFromReviewed, true);
  });

  test("a claim that matches the reviewed name (ignoring case and punctuation) is not repeated", () => {
    const names = organizationNames(identity({ assurance: "AUTHORIZED", expiresAt: FUTURE, reviewedOrganizationName: "TYPED NAME LTD." }), "x", NOW);
    assert.equal(names.claimed, undefined);
    assert.equal(names.claimedDiffersFromReviewed, false);
  });

  test("unverified requesters show only the typed name, flagged as unchecked", () => {
    const names = organizationNames(identity({ reviewedOrganizationName: "Sneaky Real Bank" }), "x", NOW);
    assert.equal(names.primary, "Typed Name Ltd");
    assert.equal(names.primaryIsReviewed, false);
  });

  test("a lapsed or suspended review never shows the reviewed name as current", () => {
    for (const state of [identity({ assurance: "AUTHORIZED", expiresAt: PAST, reviewedOrganizationName: "Real Bank" }), identity({ assurance: "SUSPENDED", reviewedOrganizationName: "Real Bank" })]) {
      const names = organizationNames(state, "x", NOW);
      assert.equal(names.primary, "Typed Name Ltd");
      assert.equal(names.primaryIsReviewed, false);
    }
    assert.equal(organizationNames(identity({ assurance: "AUTHORIZED", expiresAt: PAST, reviewedOrganizationName: "Real Bank" }), "x", NOW).previouslyReviewed, "Real Bank");
  });

  test("with no name anywhere the requester is still labelled", () => {
    assert.equal(organizationNames(parseRequesterIdentity(undefined), "", NOW).primary, "Unnamed requester");
  });
});

describe("restricted disclosure messaging", () => {
  const unverified = identity({});
  const orgOnly = identity({ assurance: "ORG_REVIEWED" });
  const authorized = identity({ assurance: "AUTHORIZED", expiresAt: FUTURE });
  const scope = { fields: ["legalBusinessName", "gstin", "turnoverBand"] as never[], evidence: ["BANK_STATEMENT", "GST_CERTIFICATE"] as never[] };

  test("the catalogue marks turnover band and bank statement as HIGH", () => {
    assert.equal(disclosureItem("turnoverBand")?.sensitivity, "HIGH");
    assert.equal(disclosureItem("BANK_STATEMENT")?.sensitivity, "HIGH");
    assert.equal(disclosureItem("legalBusinessName")?.sensitivity, "LOW");
  });

  test("an unverified requester is told HIGH-sensitivity items may be refused", () => {
    const items = restrictedItems(scope, unverified, NOW);
    assert.deepEqual(items.map((item) => item.key).sort(), ["BANK_STATEMENT", "turnoverBand"]);
    const message = restrictionMessage(unverified, items, NOW);
    assert.match(message ?? "", /self-registered/);
    assert.match(message ?? "", /Turnover band/);
    assert.match(message ?? "", /Bank statement evidence/);
    assert.match(message ?? "", /may refuse/i); // explanatory, not a claim of enforcement
  });

  test("organization review alone does not lift the restriction", () => {
    assert.equal(restrictedItems(scope, orgOnly, NOW).length, 2);
    assert.match(restrictionMessage(orgOnly, restrictedItems(scope, orgOnly, NOW), NOW) ?? "", /authority to act for it has not/);
  });

  test("an authorization in force has no restrictions; an expired one does", () => {
    assert.equal(restrictedItems(scope, authorized, NOW).length, 0);
    assert.equal(restrictionMessage(authorized, [], NOW), undefined);
    const expired = identity({ assurance: "AUTHORIZED", expiresAt: PAST });
    assert.equal(restrictedItems(scope, expired, NOW).length, 2);
    assert.match(restrictionMessage(expired, restrictedItems(scope, expired, NOW), NOW) ?? "", /expired/);
  });

  test("a suspended requester is restricted from everything", () => {
    const suspended = identity({ assurance: "SUSPENDED" });
    assert.equal(restrictedItems(scope, suspended, NOW).length, 5);
    assert.equal(isRestrictedFor(disclosureItem("legalBusinessName"), suspended, NOW), true);
    assert.match(restrictionMessage(suspended, restrictedItems(scope, suspended, NOW), NOW) ?? "", /suspended/);
  });

  test("low-sensitivity requests are not flagged for an unverified requester", () => {
    assert.equal(restrictedItems({ fields: ["legalBusinessName", "gstin"] as never[], evidence: [] }, unverified, NOW).length, 0);
  });
});

describe("approval disclosure gate", () => {
  const base = { selectedCount: 3, acknowledged: false, submitting: false, now: NOW };

  test("an unverified requester needs an explicit acknowledgement", () => {
    const blocked = approvalGate({ ...base, identity: identity({}) });
    assert.equal(blocked.canApprove, false);
    assert.match(blocked.reason ?? "", /not been independently checked/);
    assert.equal(approvalGate({ ...base, identity: identity({}), acknowledged: true }).canApprove, true);
  });

  test("a lapsed review is treated like an unverified one", () => {
    assert.equal(approvalGate({ ...base, identity: identity({ assurance: "AUTHORIZED", expiresAt: PAST }) }).canApprove, false);
  });

  test("reviewed requesters need no acknowledgement", () => {
    assert.equal(approvalGate({ ...base, identity: identity({ assurance: "ORG_REVIEWED" }) }).canApprove, true);
    assert.equal(approvalGate({ ...base, identity: identity({ assurance: "AUTHORIZED", expiresAt: FUTURE }) }).canApprove, true);
  });

  test("a suspended requester cannot be approved even if acknowledged", () => {
    const gate = approvalGate({ ...base, identity: identity({ assurance: "SUSPENDED" }), acknowledged: true });
    assert.equal(gate.canApprove, false);
    assert.match(gate.reason ?? "", /suspended/);
  });

  test("nothing selected, or a submission in flight, blocks approval", () => {
    assert.equal(approvalGate({ ...base, identity: identity({ assurance: "ORG_REVIEWED" }), selectedCount: 0 }).canApprove, false);
    assert.equal(approvalGate({ ...base, identity: identity({ assurance: "ORG_REVIEWED" }), submitting: true }).canApprove, false);
  });
});

describe("activity and notification wording", () => {
  const entry = (over: Partial<AuditLogEntry>): AuditLogEntry => ({ id: "1", action: "CONSENT_REQUESTED", timestamp: "2026-10-20T10:00:00Z", ...over });
  const unverifiedActor = { organization: "Fake State Bank", identity: parseRequesterIdentity({ assurance: "UNVERIFIED" }) };

  test("an unchecked requester is named with a qualifier in the activity sentence", () => {
    assert.match(renderAuditEvent(entry({ actor: unverifiedActor })).sentence, /Fake State Bank \(self-registered, not checked\) requested/);
  });

  test("a reviewed requester carries no qualifier", () => {
    const actor = { organization: "Kisan NBFC", identity: parseRequesterIdentity({ assurance: "ORG_REVIEWED", reviewedAt: PAST }) };
    assert.doesNotMatch(renderAuditEvent(entry({ actor })).sentence, /self-registered|suspended|expired/);
  });

  test("the status recorded at the time wins over today's status", () => {
    const actor = { organization: "Kisan NBFC", identity: parseRequesterIdentity({ assurance: "AUTHORIZED", expiresAt: FUTURE }) };
    const sentence = renderAuditEvent(entry({ actor, metadata: { requesterIdentity: { assurance: "UNVERIFIED" } } })).sentence;
    assert.match(sentence, /self-registered, not checked/);
  });

  test("suspended and lapsed requesters are flagged", () => {
    assert.equal(identityNote(identity({ assurance: "SUSPENDED" }), NOW), "suspended");
    assert.equal(identityNote(identity({ assurance: "AUTHORIZED", expiresAt: PAST }), NOW), "review expired");
    assert.equal(identityNote(identity({ assurance: "AUTHORIZED", expiresAt: FUTURE }), NOW), "");
  });

  test("older events without identity data render unchanged", () => {
    assert.doesNotMatch(renderAuditEvent(entry({ actor: { organization: "Old Org" } })).sentence, /\(/);
  });
});

export type { RequesterIdentity };
