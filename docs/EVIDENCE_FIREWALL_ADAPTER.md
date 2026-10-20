# Evidence Decision Firewall - trusted adapter

The production adapter is implemented in `src/modules/evidenceFirewall/firewall-adapter.ts`.
The pure `evaluateConclusion` engine remains isolated from HTTP callers. This integration does not add a database
migration or a conclusion-specific audit action.

## Routes

- `POST /api/trust-view/:consentRequestId/conclusions` requires a verified JWT. The server uses only the JWT subject
  as a principal identifier, then loads the database User, ConsentRequest, RequesterAssurance and pinned Passport.
- `POST /api/public/verify/:token/conclusions` uses the guest token as its only credential. The token is hashed for
  lookup and rate limiting; it is not logged or returned.

Both routes accept only this closed vocabulary:

```json
{ "kind": "FIELD_SUPPORTED_BY_EVIDENCE", "field": "gstin" }
{ "kind": "FIELD_NOT_CONTRADICTED", "field": "legalBusinessName" }
{ "kind": "EVIDENCE_CURRENT", "docType": "GST_CERTIFICATE" }
```

Extra properties, unknown catalogue keys, wrong item kinds and malformed requests are rejected with `400`.

## Server-owned evaluation

All authority and snapshot inputs are read inside one Prisma transaction. The adapter independently validates:

- database role (`BUYER` or `BANK`) rather than trusting a JWT role claim;
- consent/grant status, expiry, revocation and Passport ownership;
- canonical approved/requested scope, duplicate keys and approved-subset-of-requested;
- requester assurance and high-sensitivity scope;
- schema-2 Passport integrity through the pure Firewall snapshot reader.

Callers cannot provide a snapshot, Passport ID, assurance object, approved scope or evaluation timestamp. Existing
Trust View and guest redemption responses are unchanged. The adapter does not read live Business or Document rows.

## Response contract

```json
{
  "conclusion": {
    "result": "CONFIRMED | NOT_CONFIRMED | NOT_DISCLOSABLE",
    "basis": "INTERNAL_DETERMINISTIC_CHECKS | AUTHORIZATION",
    "passportVersion": 1,
    "scopeLimited": true,
    "limitations": ["No external source was consulted; this is a deterministic internal assessment."]
  }
}
```

The response contains no claim values, raw documents, evidence IDs, document types beyond the requested question,
contradiction details, internal reason codes or full snapshots. `NOT_DISCLOSABLE` is uniform for valid requests that
cannot be authorized. Infrastructure failures use `503 FIREWALL_UNAVAILABLE`; malformed request bodies use `400`.

The adapter intentionally coarsens every pure-engine result other than `SUPPORTED`: hidden contradictions, malformed
snapshot records and insufficient evidence all become `NOT_CONFIRMED`. This removes a distinct hidden-corruption
reason, but it cannot guarantee perfect noninterference: repeated queries can still observe a verdict changing when a
new pinned version, expiry boundary or revocation changes the server-owned state.

## Throttling and audit

The existing API limiter remains active. The two conclusion routes also use narrow in-memory `express-rate-limit`
limiters keyed by the database user ID for registered calls and by `sha256(token):ip` for guest calls. Client body
values are never used as identities. No database-backed limiter is required for the Horizon demo.

Conclusion evaluations write `CONCLUSION_EVALUATED` through the existing audit service in the same transaction as the
server-owned load and evaluation. Metadata contains only the channel, closed query kind and evaluation timestamp,
plus the existing consent/grant relation and bounded actor. It never contains verdicts, values, evidence IDs, tokens or
contradiction details. If the audit write fails, the transaction fails and the route returns `503 FIREWALL_UNAVAILABLE`;
the response is not treated as successful. This is an additive migration after the existing eleven migrations.

Guest conclusion calls also use an independent in-memory IP limiter in addition to the per-token limiter. The app
explicitly does not trust forwarded headers, so spoofed `X-Forwarded-For` values do not rotate the limiter key.
