# Evidence Decision Firewall — specification (isolated module, revision 3)

Revision 3 (security remediation): strict authorisation shape (§2.1), impossible-provenance rejection (§3.1), a
documented snapshot-wide unsuitability channel (L7). Trusted adapter design: `EVIDENCE_FIREWALL_ADAPTER.md`.
Repeated-query analysis and controls: `EVIDENCE_FIREWALL_PRIVACY.md`.

Status: isolated pure module. No route, no scoring, no Passport, no schema change.
Code: `src/modules/evidenceFirewall/`. Tests: `scripts/evidence-firewall-tests.ts`, `scripts/evidence-firewall-parity-tests.ts`.

The firewall answers one question: *is this requested trust conclusion sufficiently supported by evidence that
this requester is authorised to see, in the exact Passport snapshot the access is pinned to?*
It is a pure function of `(snapshot, authorization, request, now)`.

## 1. What a conclusion means

| Kind | Positive verdict means |
|---|---|
| `FIELD_SUPPORTED_BY_EVIDENCE(field)` | The claim is present, and at least one embedded evidence record of an accepted type that was unexpired at assessment and is unexpired at `now` is referenced by it, and none of its checks failed. It means *internally cross-checked, document-submitted* — never source-verified. |
| `FIELD_NOT_CONTRADICTED(field)` | The claim is present and no recorded conflict affects it that this requester may be told about, and none is withheld. |
| `EVIDENCE_CURRENT(docType)` | An embedded evidence record of that type was unexpired at assessment and is unexpired at `now`. |

`SOURCE_VERIFICATION` is always `NOT_APPLICABLE` in this system. No code path may reach a positive verdict
because of it, and every decision carries the limitation "No external source was consulted."

## 2. Authorisation (evaluated first, in this order; any failure → `NOT_DISCLOSABLE`)

Let the *required items* of a request be: the field (field kinds); plus, for `FIELD_SUPPORTED_BY_EVIDENCE`, every
evidence type in `fieldEvidence[field]` (D2); or the evidence type (`EVIDENCE_CURRENT`).
Let the *full scope* be the channel's complete approved fields + evidence types.

1. **A0 well-formed**: request kind known; field is a catalogue `FIELD`; docType is a catalogue `EVIDENCE` key.
2. **A1 live**: status `APPROVED` (consent) or `ACTIVE` (guest link); `revokedAt` null.
3. **A2 not expired** at `now`. Consent without `expiresAt` does not expire (canonical `expireIfNeeded`);
   a guest link without a valid `expiresAt` fails closed; an unparsable date fails closed.
4. **A3 pinned**: `pinnedPassportId` is present and equals `snapshotPassportId`. "Latest" is never substituted.
5. **A4 scope**: every required item is in the approved lists (exact match; lists must be arrays of strings).
6. **A5 requester assurance** — canonical parity with `enforceDisclosureAccess`, evaluated over the **full scope**,
   exactly as `trustView.getTrustView` and guest redemption do:
   * requester `SUSPENDED` (effective) → deny, for any items;
   * the full scope contains a `HIGH` item → requester must be effectively `AUTHORIZED` (an `AUTHORIZED` record whose
     `authorizationExpiresAt <= now` is `ORG_REVIEWED`) and its `authorizationScope` must list every `HIGH` item;
   * no requester: a guest link is allowed only if the full scope has no `HIGH` item; a consent with no requester
     is denied.
   Because canonical access is denied for the whole grant when assurance lapses, the firewall denies too, even
   for LOW items.

### 2.1 Explicit shape (revision 3)

The authorisation object must carry **every** property as an explicit own property: `channel, status, expiresAt,
revokedAt, pinnedPassportId, approvedFields, approvedEvidenceTypes, requester`. `null` is a meaningful value ("does not
expire", "not revoked", "no linked requester"); a missing or `undefined` property is not, and inherited properties do not
count. `expiresAt` and `revokedAt` accept only `null` or a full ISO-8601 instant with an explicit zone (so `"2026"`,
`"20 Oct 2026"`, date-only strings, numbers and Dates are rejected), and `now` is held to the same rule.
Channel semantics:

| | `expiresAt` | `revokedAt` |
|---|---|---|
| CONSENT | `null` (never expires, canonical) or a future instant | must be `null` |
| GUEST_LINK | a future instant (a link always expires) | must be `null` |

A non-null `revokedAt` on a live-status record is contradictory and denied. A requester assurance record must likewise
carry `assuranceStatus`, `authorizationExpiresAt` (null or ISO) and `authorizationScope` explicitly; a missing
`authorizationExpiresAt` is not "no expiry".

Authorisation never reads the snapshot's contents. Nothing about contradictions, evidence or claims can influence
whether a request is authorised.

## 3. Snapshot suitability (after authorisation)

Fail closed → `INSUFFICIENT_EVIDENCE` / `CONFIRMATION_UNAVAILABLE` unless **all** hold: object; `snapshotSchema`
property present and `=== 2` (absent, null, non-number, other versions are never legacy and never trusted);
`profileId === snapshotPassportId`; `evidence[]` array of well-formed records (documentId, docType, evidenceStatus
in the enum, valid ISO `checkedAt`/`uploadedAt`, `issuedAt`/`expiresAt` null or valid ISO, `checks` array);
unique documentIds; `fieldConfidence[]` well-formed with known check outcomes; `contradictions[]` array of
well-formed entries; `lastCalculatedAt` valid. Every `evidenceId` a claim cites must resolve in embedded
`evidence[]` (a dangling id = tampering = unsuitable). `documents[]` is never consulted.

### 3.1 Impossible provenance (revision 3)

Pramaan has no authoritative-source integration, so provenance that implies one is rejected, not interpreted. The
snapshot is unsuitable if **any** field or evidence record has status `SOURCE_VERIFIED`, **any** check of type
`SOURCE_VERIFICATION` has a result other than `NOT_APPLICABLE`, or any evidence record's `crossCheckMethod` is not
`INTERNAL_METADATA_CHECK`. This is deliberately snapshot-wide (it cannot be confined to the requested claim without
trusting a forged record) and fails closed to `CONFIRMATION_UNAVAILABLE`. When a real source integration exists, this
rule must be revisited together with the engine, not relaxed silently.

## 4. Contradiction policy (D1 — conservative withholding)

Policy table `contradictionInvolves` maps a recorded contradiction `field` to the items it involves:

| contradiction field | involves |
|---|---|
| `pan` | FIELD `gstin`, UNDISCLOSABLE `pan` |
| `businessName` | FIELD `legalBusinessName`, UNDISCLOSABLE `accountOrganizationName` |

* **Relevant** to a field request iff it involves that field. A contradiction whose `field` is not in the table, or a
  malformed entry, cannot be classified → treated as relevant to **every** positive conclusion (fail closed).
* **Visible** iff every involved item is a disclosable item inside the authorised scope (none is `UNDISCLOSABLE`).
  Visible and relevant → `CONTRADICTED` / `RECORDED_CONFLICT`. No values are returned.
* **Hidden** (some involved item is undisclosable or outside scope) and relevant → the conflict is **withheld**:
  a would-be positive verdict becomes `INSUFFICIENT_EVIDENCE` / `CONFIRMATION_UNAVAILABLE`. No detail is revealed.
* The field's own recorded `INTERNAL_CONSISTENCY` failure is a conflict with an unidentified counterparty → hidden.
* Contradictions are only considered after authorisation passes.

**Decision precedence** (first match wins):
`NOT_DISCLOSABLE` → snapshot unsuitable → `CONTRADICTED` (visible) → visible insufficiency
(`CLAIM_NOT_PROVIDED`, `NO_EVIDENCE_MAPPING`, `EVIDENCE_MISSING`, `EVIDENCE_EXPIRED`, inconclusive checks) →
withheld hidden conflict → `SUPPORTED`.
Visible insufficiency comes before withholding on purpose: a truthful, visible cause never exposes the hidden one,
and a conflict is never converted into `SUPPORTED`.

`CONFIRMATION_UNAVAILABLE` is one shared code for: unsuitable snapshot, inconclusive/unknown checks, unclassifiable
contradictions, and withheld hidden conflicts. It is deliberately not unique to hidden conflicts.

## 5. Privacy limitations (stated, not hidden)

This module does **not** provide noninterference. Known, accepted inferences:

* **L1** `CONFIRMATION_UNAVAILABLE` on a claim that otherwise looks healthy tells the requester that *something
  unconfirmable exists* (a hidden conflict, a field-level consistency failure, or a snapshot/check anomaly). It cannot
  tell which. This is the D1 leak.
* **L2** `NOT_DISCLOSABLE` merges scope, expiry, revocation, pin and assurance denials. A requester knows its own
  scope and lifecycle; the single code avoids adding any information beyond that, and does not distinguish "no such
  claim" from "not allowed".
* **L3** A positive evidence-backed verdict reveals that matching evidence of the authorised type exists and is
  unexpired. That is inside the authorised scope by D2.
* **L4** Timing and error-path cost are not constant-time; no timing-channel guarantee is claimed.
* **L5** Repeated queries across snapshot versions or over time reveal changes in verdicts.
* **L6** The visible contradiction table is policy: adding an entry whose involved items are all disclosable makes
  that conflict visible by design.

* **L7** Snapshot-wide integrity failures (malformed or forged records anywhere in the snapshot, including data the
  requester may not see) make every positive conclusion `CONFIRMATION_UNAVAILABLE`. This is a second channel through which
  hidden data influences output, beyond hidden-conflict withholding.

What *is* tested: hidden data (unauthorised fields, unauthorised evidence, contradiction values, conflict detail,
other claims) changes the output **only** through the withholding path in §4 — mutating well-formed hidden data otherwise leaves the
serialised decision byte-identical (integrity failures, L7, are the exception); mutating a hidden conflict can only turn a positive verdict into
`CONFIRMATION_UNAVAILABLE`.

## 6. Output

`{ verdict, reasonCode, basis: "SNAPSHOT_SCHEMA_2", snapshotVersion, scopeLimited: true, limitations }`.
No values, ids, counts, confidence numbers, contradiction details or unrequested document types. Reason codes are a
closed set: `SUPPORTED_INTERNALLY`, `NO_RECORDED_CONFLICT`, `EVIDENCE_UNEXPIRED`, `RECORDED_CONFLICT`, `CLAIM_NOT_PROVIDED`,
`NO_EVIDENCE_MAPPING`, `EVIDENCE_MISSING`, `EVIDENCE_EXPIRED`, `CONFIRMATION_UNAVAILABLE`, `NOT_DISCLOSABLE`.
`snapshotVersion` is `null` for `NOT_DISCLOSABLE`.

## 7. Out of scope

Route/API integration, audit writes, owner-side variant, scoring, snapshots, schema, onboarding packs.
