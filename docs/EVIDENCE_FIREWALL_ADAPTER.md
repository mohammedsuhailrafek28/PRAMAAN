# Evidence Decision Firewall — trusted adapter design (FOR APPROVAL, not implemented)

Status: design only. Nothing here is wired into any route, and no production enforcement exists yet.
Companion documents: `EVIDENCE_DECISION_FIREWALL.md` (engine), `EVIDENCE_FIREWALL_PRIVACY.md` (privacy controls).

## 1. Why an adapter

`evaluateConclusion` is pure: it trusts whatever `AuthorizationContext` and snapshot it is handed. Any caller that can
build those objects can authorise itself. The adapter is the **only** code allowed to turn server-owned records into a
`FirewallInput`. Callers supply an authenticated principal and a closed-vocabulary question; they never supply
authorisation, a snapshot, a passport id, or a clock.

## 2. Public API (the only exported surface)

```ts
// src/modules/evidenceFirewall/firewall-adapter.ts  (future)
export type ConclusionSubject =
  | { channel: "CONSENT"; consentRequestId: string; actor: Express.User }  // actor = requireAuth result (JWT sub)
  | { channel: "GUEST_LINK"; token: string };                              // bearer secret from the link

export async function evaluateTrustConclusion(
  subject: ConclusionSubject,
  request: ConclusionRequest,          // closed vocabulary; zod-validated at the route
  context: { requestId: string }       // for logging/audit correlation only
): Promise<RequesterConclusion>;       // coarsened FirewallDecision (see privacy doc §3)
```

Not exported: the context builder, the record loaders, `FirewallInput`/`AuthorizationContext` construction. A static
test fails if any file outside `firewall-adapter.ts` imports `evaluateConclusion` or constructs `AuthorizationContext`
(routes and controllers may import only `evaluateTrustConclusion`).

## 3. Derivation of every input from server-owned records

All reads happen in **one read-only `prisma.$transaction`** so the decision is made on a consistent view.

| `FirewallInput` field | CONSENT channel | GUEST_LINK channel |
|---|---|---|
| principal check | `consent.requesterId === actor.id`, and the **User row** (not the JWT role) has role `BUYER`/`BANK` | possession of a token matching `^[A-Za-z0-9_-]{40,}$` whose sha256 digest finds an `AccessGrant` |
| `authorization.channel` | `"CONSENT"` | `"GUEST_LINK"` |
| `authorization.status` | `ConsentRequest.status` verbatim | `"REVOKED"` if `revokedAt` set or `status = REVOKED`, else `"ACTIVE"` (an `EXPIRED` row is mapped to `"EXPIRED"`) |
| `authorization.expiresAt` | `ConsentRequest.expiresAt` → ISO or `null` | `AccessGrant.expiresAt` → ISO |
| `authorization.revokedAt` | `ConsentRequest.revokedAt` → ISO or `null` | `AccessGrant.revokedAt` → ISO or `null` |
| `authorization.pinnedPassportId` | `ConsentRequest.approvedPassportId` | `AccessGrant.passportId` |
| `approvedFields` / `approvedEvidenceTypes` | `ConsentRequest.approvedFields` / `.approvedEvidenceTypes` (Json, validated as string arrays) | `AccessGrant.scopeJson.fields` / `.evidenceTypes` (validated) |
| `authorization.requester` | `RequesterAssurance` row for `consent.requesterId` (read-only `findUnique`); absent row → explicit `{ assuranceStatus: "UNVERIFIED", authorizationExpiresAt: null, authorizationScope: null }`, mirroring `ensureForUser` without its upsert write | the linked requester's row when `grant.requesterId` resolves to a `BUYER`/`BANK` user (canonical `resolveGuest` rule), otherwise explicit `null` |
| `snapshot` / `snapshotPassportId` | `Passport` loaded **by id** = `approvedPassportId`, required to satisfy `passport.businessId === consent.businessId`; `snapshotJson` read once | the same, by `AccessGrant.passportId` and `grant.businessId` |
| `now` | `new Date().toISOString()` captured once per call — the adapter's clock is the only clock | same |

Every timestamp is emitted with `toISOString()`, and every property is set explicitly (`null` where null is meant), so
the engine's strict own-property rules are satisfied by construction.

## 4. Security contract

1. **No caller-supplied authority.** Request bodies/queries are zod `.strict()`; extra properties are rejected. Headers
   and query strings never influence authorisation. The only identity inputs are the verified JWT subject and the guest
   token.
2. **Pinned only.** The snapshot is the one the grant is pinned to. "Latest passport", `Document` rows and live business
   data are never read.
3. **Uniform denial, no existence oracle.** Unknown id, someone else's consent, malformed token, unknown token, missing
   or mismatched passport, malformed stored scope, non-requester role: all produce the same `NOT_DISCLOSABLE` result with
   the same HTTP status and shape. (This deliberately differs from `getTrustView`'s 403/404/410 distinctions.) Work done
   on the denial path is made structurally similar; no constant-time claim is made.
4. **No writes except audit.** No `expireIfNeeded`, no `ensureForUser` upsert, no status materialisation. Past-expiry is
   enforced by the engine itself; canonical materialisation stays with the existing read paths.
5. **No decision data in logs.** Logs carry requestId, channel, verdict and reasonCode only; never claim values, ids of
   evidence, tokens or snapshot content. Guest tokens never appear in logs or audit rows (the existing path sanitiser
   already redacts `/verify/:token`).
6. **Fail closed, not open.** An internal exception yields HTTP 503 `FIREWALL_UNAVAILABLE` with no verdict. A request is
   never answered "supported" because a dependency failed.
7. **No caching of private results.** `Cache-Control: no-store`; no shared cache; any per-grant memo is process-local
   and keyed by the grant id (privacy doc §C1).
8. **Output minimality.** Only the coarsened decision is returned. The snapshot, evidence ids, contradiction details,
   confidence numbers and document types not in the question never leave the adapter.
9. **Throttle before evaluate.** Counters are checked and incremented before the engine runs, so a 429 reveals nothing
   about the verdict.
10. **Role enforcement lives server-side** on the User row. A JWT whose `role` claim disagrees with the database does not
    gain access.

## 5. Integration points (no wiring until approved)

| Item | Detail |
|---|---|
| Routes | `POST /api/trust-view/:consentRequestId/conclusions` (`requireAuth`, validated body) and `POST /api/verify/:token/conclusions` (no auth; token is the credential). Added to `src/modules/trustView/trustView.routes.ts` and `accessGrant.routes.ts` guestRouter. |
| Body | `{ kind, field? , docType? }` zod `.strict()`, enums taken from the disclosure catalogue (`DISCLOSURE_FIELD_KEYS`, `DISCLOSURE_EVIDENCE_KEYS`). |
| Response | `{ conclusion: { result, … } }` coarsened per privacy doc; `Cache-Control: no-store`. |
| Throttle | `express-rate-limit` instances with a custom `keyGenerator` (principal+grant); the existing global `apiRateLimit` stays. |
| Audit | `writeAuditLog` with the new action (§6). |
| OpenAPI | New paths in `src/docs/openapi.ts`. |
| Frontend | None in this phase. |

## 6. Audit

Every evaluation by an identifiable grant writes an owner-visible audit row: requester id, consent/grant id, request key
(`kind` + catalogue key), verdict, reason code, snapshot version. Never values. Lookups that cannot be tied to a business
(unknown id/token) go to the structured log only.

**Decision D3 (needs approval):** the `AuditAction` enum has no suitable value (`TRUST_VIEW_OPENED` means a view).
Options: (A) add `CONCLUSION_EVALUATED` — a schema/migration change that overlaps Codex's in-flight edits to
`schema.prisma` and `audit.service.ts`, so it should be sequenced after those land; (B) reuse `TRUST_VIEW_OPENED` with
`metadata.kind = "CONCLUSION"` — no migration, weaker semantics and the existing 5-minute dedupe would have to be
bypassed. **Recommendation: A, sequenced after Codex's migration.**

## 7. Tests required before any wiring

1. **Authority tests**: another requester's consent id, a wrong/forged/truncated token, a JWT with a forged role, extra
   body properties, spoofed headers — none changes the outcome; all denials are byte-identical.
2. **Parity**: the existing 945-case matrix re-run *through the adapter* against real rows, equal to `getTrustView` and
   `resolveGuest`.
3. **Pin tests**: a newer passport, an edited business, a replaced document, a regenerated profile — the decision is
   unchanged for an existing consent.
4. **No-write test**: row counts and `updatedAt` of Consent/AccessGrant/RequesterAssurance/Document unchanged; only audit
   grows.
5. **Uniformity**: denial responses compared byte-for-byte across every denial cause.
6. **Static guards**: the engine is imported only by the adapter; the context builder is not exported.
7. **Throttle tests**: limits applied before evaluation; 429 independent of verdict.
8. **Failure injection**: a thrown error mid-read yields 503, never a verdict.

## 8. Decisions requested

- **D3** audit action approach (§6).
- **D4** uniform HTTP 200/`NOT_DISCLOSABLE` for every denial (recommended) versus the canonical 403/404/410 codes.
- **D5** coarsened requester response as the default (recommended; see privacy doc).
- **D6** throttle numbers and in-memory counters (single SQLite instance; resets on restart) versus database counters.
