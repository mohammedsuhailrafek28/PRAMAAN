# Requester Identity Assurance Contract

This backend-only control applies to registered BUYER and BANK requesters. It does not add an ADMIN role or a public operator API.

## Stored states

| State | Meaning |
| --- | --- |
| `UNVERIFIED` | Self-registered requester with no independent organizational review. |
| `ORG_REVIEWED` | Organization identity reviewed; requester authority is not established. |
| `AUTHORIZED` | Organization and requester authority reviewed against independent references, with scope and expiry. |
| `SUSPENDED` | Requester privileges disabled. |

An expired `AUTHORIZED` record is evaluated as `ORG_REVIEWED` for access policy. The stored record remains available for history and re-authorization.

## Safe response shape

Consent payloads include `requesterIdentity`; registered Trust View responses include the same shape. Linked guest responses include it under `grant.requesterIdentity`.

```json
{
  "status": "UNVERIFIED | ORG_REVIEWED | AUTHORIZED | SUSPENDED",
  "displayName": "Acme Retail Buyers",
  "reviewBasis": "registry-review-case-001",
  "reviewedAt": "2026-10-17T10:00:00.000Z",
  "authorizationExpiresAt": "2026-10-24T10:00:00.000Z",
  "limitations": ["Requester authority has not been independently established."]
}
```

The response never includes reviewer notes, uploaded verification records, internal document paths, credentials, authorization secrets, or the full authorization scope.

## Enforcement

- `UNVERIFIED` and `ORG_REVIEWED` may request low/medium disclosures only.
- `AUTHORIZED` may request HIGH disclosures only when the requested HIGH keys are inside its stored authorization scope and the authorization is unexpired.
- Every request still requires separate MSME consent. Authorization does not grant data access.
- `SUSPENDED` cannot create requests or access registered Trust Views.
- Authorization status and expiry are re-checked at request creation, MSME approval, Trust View access, and linked guest access.
- Existing consents are not widened. A downgrade blocks protected content even if the consent was approved earlier.
- A guest grant linked to a registered requester cannot bypass these checks. An unlinked guest grant cannot contain HIGH-sensitivity scope.

## Local operator CLI

```text
npx tsx scripts/requester-assurance.ts review --user-id ID --operator-id OP --review-basis REF
npx tsx scripts/requester-assurance.ts authorize --user-id ID --operator-id OP --authorization-basis REF --authorization-reference REF --expires-at ISO --scope-fields turnoverBand --scope-evidence-types BANK_STATEMENT
npx tsx scripts/requester-assurance.ts suspend --user-id ID --operator-id OP --suspension-reason REASON
npx tsx scripts/requester-assurance.ts re-review --user-id ID --operator-id OP --review-basis REF
npx tsx scripts/requester-assurance.ts history --user-id ID
```

Only existing BUYER/BANK accounts are valid targets. References containing self-attestation, self-uploaded letters, email-domain matching, or similar claims are rejected. Operator transitions are recorded in `RequesterAssuranceEvent` with previous/new state, operator identifier, timestamp, and non-sensitive metadata.
