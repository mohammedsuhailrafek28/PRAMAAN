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
npm run db:init
npm run db:seed
npm run prisma:generate
npm run dev
```

The API runs at `http://localhost:4000`.

`npm run db:init` prepares the SQLite file, reconciles any known legacy local schema, and then applies checked-in Prisma migrations. It no longer creates application tables through a separate shadow migration path.

Prisma migration tracking is authoritative going forward. Fresh databases and reconciled legacy databases should report cleanly with:

```bash
npm run db:status
```

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

## Report Composer

Trust OS answers: "What do we know?"

Readiness Engine answers: "Ready for what?"

Report Composer answers: "How do we present and preserve the result?"

The Report Composer creates private, JSON-first, immutable report snapshots. It does not render HTML or PDF yet. Generated reports preserve their `reportVersion`, Trust Profile provenance, readiness evaluation provenance, limitations, timeline, gaps, contradictions, blockers, and action plan at the moment of generation.

Report types:

| Report type | Purpose |
|---|---|
| `BUSINESS_TRUST_PROFILE` | Evidence-backed Business Trust Profile report |
| `VENDOR_ONBOARDING_READINESS` | Vendor onboarding preparation report |
| `LOAN_APPLICATION_PREPARATION` | Loan application document-preparation report |
| `GOVERNMENT_PROCUREMENT_READINESS` | Generic government procurement preparation report |
| `GOVERNMENT_SCHEME_APPLICATION_READINESS` | Generic scheme application preparation report |

Reports are private by default. MSMEs can list, retrieve, and revoke only their own reports. Buyers and banks cannot access report APIs, and report data is not exposed through Trust View. Revocation is non-destructive: `revokedAt` is set, the snapshot is retained for owner audit history, and `REPORT_REVOKED` is recorded.

Reports are not government certificates, bank-approved documents, eligibility decisions, credit assessments, or external verification.

Example API calls:

```bash
curl http://localhost:4000/api/report-types \
  -H "Authorization: Bearer <msme-token>"

curl -X POST http://localhost:4000/api/reports/generate \
  -H "Authorization: Bearer <msme-token>" \
  -H "Content-Type: application/json" \
  -d "{\"reportType\":\"VENDOR_ONBOARDING_READINESS\"}"

curl http://localhost:4000/api/reports \
  -H "Authorization: Bearer <msme-token>"

curl http://localhost:4000/api/reports/<report-id> \
  -H "Authorization: Bearer <msme-token>"

curl -X POST http://localhost:4000/api/reports/<report-id>/revoke \
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
| `npm run db:migrate` | Prepare the SQLite file and run `prisma migrate deploy` |
| `npm run db:reconcile` | Reconcile known legacy SQLite databases with Prisma migration tracking |
| `npm run db:init` | Safe local initializer: reconcile/preflight, then apply migrations |
| `npm run db:status` | Show Prisma migration status |
| `npm run db:seed` | Seed demo users, business, and sample document rows |
| `npm run prisma:migrate` | Backward-compatible alias for deploy-style migrations |
| `npm run prisma:seed` | Backward-compatible seed alias |

## Database Lifecycle

Earlier local versions used `prisma/init-sqlite.ts` to create and alter SQLite tables directly. That produced a correct application schema, but Prisma did not record the checked-in migrations in `_prisma_migrations`, so `npx prisma migrate status` could report migrations as unapplied.

The current lifecycle separates compatibility from schema authority:

Fresh local development:

```bash
npm install
copy .env.example .env
npm run db:init
npm run db:seed
npm run prisma:generate
npm run dev
```

Existing legacy SQLite database:

```bash
npm run db:reconcile
npm run db:migrate
npm run db:status
```

Production or deployment:

```bash
npm run db:migrate
npm run prisma:generate
npm run build
npm start
```

`npm run db:reconcile` is SQLite-only. It inspects tables, columns, indexes, and Prisma migration records before doing anything. If a known legacy database already matches a migration, it uses Prisma-supported migration resolution. If a known old local schema needs compatibility columns or tables, it creates a timestamped `.db.backup-*` file before mutation, upgrades only the known safe schema pieces, and then reconciles migration tracking. It stops on incompatible or contradictory states.

The reconciliation path does not promote historical uploads or old `verifiedFlag` values to `SOURCE_VERIFIED`; legacy uploaded documents remain `DOCUMENT_SUBMITTED` unless a real future source adapter explicitly changes them.

For production, use `npm run db:migrate` or `npx prisma migrate deploy`. Do not use `prisma db push`, `prisma migrate dev`, or direct schema mutation helpers in deployment.

## Smoke Test

Run the full backend Trust OS sequence:

```bash
npm install
npm run prisma:generate
npm run db:init
npm run db:seed
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
12. Report types are listed.
13. Business Trust Profile and Vendor Readiness reports are generated.
14. Report listing returns metadata only.
15. Report retrieval returns the stored immutable snapshot.
16. Business data changes and old reports remain unchanged.
17. Buyer registers and cannot access report APIs.
18. MSME revokes a report non-destructively.
19. Buyer requests selected fields by GSTIN.
20. MSME sees incoming request and approves fewer fields than requested.
21. Buyer opens Dynamic Trust View and receives only approved profile fields.
22. Buyer does not receive unapproved report data.
23. Unauthorized users are blocked from the Trust View and owner profile.
24. MSME revokes consent.
25. Buyer receives `CONSENT_REVOKED`.
26. Audit logs and notifications contain the lifecycle.

## Running With Docker

```bash
docker compose up --build
```

Docker Compose starts the backend on `http://localhost:4000` and persists SQLite data plus uploaded files in named Docker volumes:

- `pramaan-sqlite`
- `pramaan-uploads`

The container uses SQLite-first local persistence and does not require Postgres.

The Docker command uses the safe local initializer before starting the server. For multi-replica or production-style deployments, run migrations once as a dedicated step with `npm run db:migrate` before starting application processes.

To seed demo data inside the running container:

```bash
docker compose exec backend npm run db:seed
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
| `GET` | `/api/report-types` | Authenticated |
| `POST` | `/api/reports/generate` | MSME |
| `GET` | `/api/reports` | MSME |
| `GET` | `/api/reports/:reportId` | MSME owner |
| `POST` | `/api/reports/:reportId/revoke` | MSME owner |
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
