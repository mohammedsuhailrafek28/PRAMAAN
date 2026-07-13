# Pramaan Backend

Pramaan is reusable KYB trust infrastructure for MSMEs. The backend helps an MSME submit business claims, attach supporting evidence, run deterministic internal cross-checks, generate a Business Trust Profile, and share only approved profile fields with a buyer or bank for a time-bound duration.

The current MVP measures evidence quality and trust readiness. It does not decide whether a business is morally trustworthy, creditworthy, eligible for a loan, or suitable for a marketplace.

## Trust OS Scope

This backend is intentionally deterministic and rule-based.

- No frontend in this repository.
- No LLM, OpenAI, Gemini, Claude, or other generative AI APIs.
- No blockchain.
- No lending decisions.
- No marketplace.
- No reputation, fraud, credit, or AI scoring.
- No OCR or document-content parsing.
- No live GST, Udyam, bank, Account Aggregator, DigiLocker, or government-registry verification.
- Buyer and bank users never receive raw uploaded documents.

Important truth rule: PRAMAAN does not mark submitted data as externally verified unless an authoritative source adapter has checked it. This MVP uses `SELF_DECLARED`, `DOCUMENT_SUBMITTED`, `CROSS_CHECKED`, `REJECTED`, and `EXPIRED`. `SOURCE_VERIFIED` is modeled for the future but is not produced by the current system.

## Stack

- Node.js + Express + TypeScript
- Prisma ORM schema with SQLite for local demo
- JWT auth
- bcrypt password hashing
- multer local uploads
- Zod request validation
- Swagger UI docs
- pino structured request logging
- helmet, CORS, and API rate limiting

## Setup

```bash
npm install
copy .env.example .env
npm run prisma:generate
npm run db:init
npm run prisma:seed
npm run dev
```

The API runs at `http://localhost:4000`.

Note: `npm run db:init` creates or updates the local SQLite demo tables, including Trust OS foundation columns. Prisma migration SQL is also documented under `prisma/migrations`.

## API Docs

Interactive Swagger docs:

```text
http://localhost:4000/api/docs
```

Health endpoint:

```text
GET http://localhost:4000/api/health
```

## Demo Accounts

All seeded users use password `password123`.

| Role | Email |
|---|---|
| MSME | `msme@pramaan.demo` |
| Buyer | `buyer@pramaan.demo` |
| Bank | `bank@pramaan.demo` |

Seeded MSME business:

- Legal name: `Sharma Textiles`
- GSTIN: `33ABCDE1234F1Z5`
- Udyam: `UDYAM-TN-01-0001234`
- PAN: `ABCDE1234F`

## Trust OS Concepts

| Concept | Meaning |
|---|---|
| Submitted claim | A value entered by the MSME, such as legal name, GSTIN, PAN, address, or turnover band |
| Submitted evidence | A supporting uploaded file, such as GST certificate, Udyam certificate, or bank statement |
| Document confidence | Deterministic assessment of upload metadata, supported MIME type, duplicates, expiry, and source-verification limitation |
| Field confidence | Deterministic assessment of claim presence, syntax, relevant submitted evidence, internal consistency, and contradictions |
| Profile completeness | Percentage of required claims and evidence currently present |
| Evidence strength | Average support level across submitted evidence and supported claims |
| Consistency | Penalty-based measure of detected contradictions |
| Freshness | Whether submitted evidence is current or expired |
| Trust readiness | Weighted summary: `0.30 completeness + 0.35 evidence strength + 0.25 consistency + 0.10 freshness` |

## Readiness Profile Engine

Trust OS answers: "What do we know about this MSME?"

The Readiness Profile Engine answers: "Ready for what?"

Readiness profiles are version-controlled TypeScript policy configurations. Each profile defines required claims, required evidence, optional evidence, minimum evidence status, confidence thresholds, blocking contradictions, metric thresholds, scoring policy, readiness thresholds, and disclaimers.

The current profiles are demo preparation profiles:

| Profile ID | Purpose |
|---|---|
| `vendor-onboarding` | Typical B2B vendor onboarding preparation |
| `loan-application-preparation` | Document preparation for approaching a lender |
| `government-procurement` | Generic government-procurement onboarding preparation |
| `government-scheme-application` | Generic MSME scheme-application preparation |

Readiness results are deterministic and explain every requirement. Blockers override the readiness label, so a high score can still return `BLOCKED` when a configured contradiction or rejected/expired mandatory evidence exists.

Readiness levels are:

- `NOT_READY`
- `EARLY_STAGE`
- `PARTIALLY_READY`
- `MOSTLY_READY`
- `READY_FOR_REVIEW`
- `BLOCKED`

The engine never claims loan approval, creditworthiness, government approval, scheme eligibility, vendor acceptance, tender qualification, or external verification. External institutions may define different requirements.

Readiness summaries are persisted for audit history and demo comparison, but they are private to the MSME. Buyers and banks do not see readiness evaluations through Trust View unless a future consent field explicitly shares a safe summary.

Example API calls:

```bash
curl http://localhost:4000/api/readiness-profiles

curl -X POST \
  http://localhost:4000/api/readiness-profiles/vendor-onboarding/evaluate \
  -H "Authorization: Bearer <msme-token>"

curl http://localhost:4000/api/readiness-profiles/vendor-onboarding/latest \
  -H "Authorization: Bearer <msme-token>"
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the API in watch mode |
| `npm run build` | Type-check and compile TypeScript |
| `npm start` | Run compiled server |
| `npm test` | Run deterministic Trust Engine tests |
| `npm run smoke` | Run the real HTTP end-to-end smoke test |
| `npm run prisma:generate` | Generate Prisma Client |
| `npm run prisma:migrate` | Run Prisma migrations where supported |
| `npm run db:init` | Initialize or update local SQLite demo DB |
| `npm run prisma:seed` | Seed demo users, business, and sample document rows |

## Smoke Test

Run the full backend Trust OS sequence:

```bash
npm install
npm run prisma:generate
npm run db:init
npm run prisma:seed
npm run build
npm test
npm run smoke
```

The smoke script starts the real backend server on port `4100`, resets the local SQLite DB, and uses real HTTP requests with JWT auth and multipart document uploads.

Smoke-tested flow:

1. MSME registers and receives a JWT.
2. Protected MSME route rejects unauthenticated access.
3. MSME creates business profile.
4. MSME uploads GST, Udyam, and bank evidence files.
5. MSME runs internal cross-checking.
6. Trust metrics, field confidence, document confidence, gaps, and limitations are returned.
7. MSME generates a Business Trust Profile.
8. Available readiness profiles are listed.
9. Vendor Onboarding Readiness and Loan Application Preparation are evaluated.
10. A missing bank-evidence requirement is identified.
11. MSME adds bank evidence and the relevant readiness result improves.
12. Buyer registers and requests selected fields by GSTIN.
13. MSME sees incoming request and approves fewer fields than requested.
14. Buyer opens Dynamic Trust View and receives only approved profile fields.
15. Buyer does not receive unapproved readiness data.
16. Unauthorized users are blocked from the Trust View and owner profile.
17. MSME revokes consent.
18. Buyer receives `CONSENT_REVOKED`.
19. Audit logs and notifications contain the lifecycle.

## Running With Docker

```bash
docker compose up --build
```

Docker Compose starts the backend on `http://localhost:4000` and persists SQLite data plus uploaded files in named Docker volumes:

- `pramaan-sqlite`
- `pramaan-uploads`

The container uses SQLite-first local persistence and does not require Postgres.

To seed demo data inside the running container:

```bash
docker compose exec backend npm run prisma:seed
```

## API Summary

All protected endpoints require `Authorization: Bearer <token>`.

| Method | Path | Role |
|---|---|---|
| `GET` | `/api/health` | Public |
| `GET` | `/api/docs` | Public |
| `POST` | `/api/auth/register` | Public |
| `POST` | `/api/auth/login` | Public |
| `POST` | `/api/auth/logout` | Any authenticated |
| `POST` | `/api/business` | MSME |
| `GET` | `/api/business/me` | MSME |
| `PATCH` | `/api/business/me` | MSME |
| `POST` | `/api/business/documents` | MSME |
| `POST` | `/api/business/cross-check` | MSME |
| `POST` | `/api/business/verify` | MSME, deprecated alias for cross-check |
| `POST` | `/api/passport/generate` | MSME |
| `GET` | `/api/passport/me` | MSME |
| `POST` | `/api/consent-requests` | Buyer, Bank |
| `GET` | `/api/consent-requests?scope=incoming` | MSME |
| `GET` | `/api/consent-requests?scope=outgoing` | Buyer, Bank |
| `PATCH` | `/api/consent-requests/:id/approve` | MSME owner |
| `PATCH` | `/api/consent-requests/:id/reject` | MSME owner |
| `PATCH` | `/api/consent-requests/:id/revoke` | MSME owner |
| `GET` | `/api/trust-view/:consentRequestId` | Original requester |
| `GET` | `/api/readiness-profiles` | Public |
| `GET` | `/api/readiness-profiles/:profileId` | Public |
| `POST` | `/api/readiness-profiles/:profileId/evaluate` | MSME |
| `GET` | `/api/readiness-profiles/:profileId/latest` | MSME |
| `GET` | `/api/readiness-profiles/evaluations` | MSME |
| `GET` | `/api/audit-logs` | MSME owner |
| `GET` | `/api/notifications` | Any authenticated |
| `PATCH` | `/api/notifications/:id/read` | Notification owner |

## Business Trust Profile Shape

`POST /api/passport/generate` stores a versioned Business Trust Profile in the existing Passport table to avoid unnecessary migration risk.

The profile contains:

- `summary.trustReadiness`
- `summary.profileCompleteness`
- `summary.evidenceStrength`
- `summary.consistency`
- `summary.freshness`
- `fieldConfidence`
- `documentConfidence`
- `gaps`
- `contradictions`
- `limitations`
- `sourceVerificationPerformed: false`

The profile does not expose proof-like fields such as `gstinVerified: true`, `udyamVerified: true`, or `bankVerified: true`.

## Error Shape

```json
{
  "error": {
    "code": "CONSENT_REVOKED",
    "message": "Access has been revoked by the business."
  }
}
```
