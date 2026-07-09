# Pramaan Backend

Pramaan is a backend MVP for India's consent-based business trust infrastructure for MSMEs. It proves a narrow loop: an MSME verifies business information once, generates a reusable Trust Passport, and shares only explicitly approved fields with a buyer or bank for a time-bound duration.

## MVP Scope

This backend is intentionally deterministic and rule-based.

- No frontend in this repository.
- No LLM, OpenAI, Gemini, Claude, or other generative AI APIs.
- No blockchain.
- No lending decisions.
- No marketplace.
- No reputation or AI scoring.
- No live GST, Udyam, or Account Aggregator integrations.
- Buyer and bank users never receive raw uploaded documents.

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

Note: `npm run prisma:migrate -- --name init` is included, but on this Windows/Node 24 machine Prisma's schema engine failed silently even though the schema validates. `npm run db:init` creates the same local SQLite tables for the hackathon demo.

## API Docs

Interactive Swagger docs:

```text
http://localhost:4000/api/docs
```

Health endpoint:

```text
GET http://localhost:4000/api/health
```

Example health response:

```json
{
  "status": "healthy",
  "service": "Pramaan Backend",
  "version": "1.0.0",
  "environment": "development",
  "uptimeSeconds": 123,
  "database": {
    "connected": true,
    "provider": "sqlite"
  },
  "timestamp": "2026-07-09T08:00:00.000Z"
}
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

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the API in watch mode |
| `npm run build` | Type-check and compile TypeScript |
| `npm start` | Run compiled server |
| `npm run smoke` | Run the real HTTP end-to-end smoke test |
| `npm run prisma:generate` | Generate Prisma Client |
| `npm run prisma:migrate` | Run Prisma migrations where supported |
| `npm run db:init` | Initialize local SQLite demo DB |
| `npm run prisma:seed` | Seed demo users, business, and sample document rows |

## Smoke Test

Run the full backend verification sequence:

```bash
npm install
npm run prisma:generate
npm run db:init
npm run prisma:seed
npm run build
npm run smoke
```

The smoke script starts the real backend server on port `4100`, resets the local SQLite DB, and uses real HTTP requests with JWT auth and multipart document uploads.

Smoke-tested flow:

1. MSME registers and receives a JWT.
2. Protected MSME route rejects unauthenticated access.
3. MSME creates business profile.
4. MSME uploads sample GST, Udyam, and bank documents.
5. MSME runs mock rule-based verification.
6. MSME generates Trust Passport.
7. Buyer registers and requests selected fields by GSTIN.
8. MSME sees incoming request and approves fewer fields than requested.
9. Buyer opens Dynamic Trust View and receives only approved fields.
10. Unauthorized users are blocked from the Trust View and owner passport.
11. MSME revokes consent.
12. Buyer receives `CONSENT_REVOKED`.
13. Audit logs and notifications contain the lifecycle.

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
| `POST` | `/api/business/verify` | MSME |
| `POST` | `/api/passport/generate` | MSME |
| `GET` | `/api/passport/me` | MSME |
| `POST` | `/api/consent-requests` | Buyer, Bank |
| `GET` | `/api/consent-requests?scope=incoming` | MSME |
| `GET` | `/api/consent-requests?scope=outgoing` | Buyer, Bank |
| `PATCH` | `/api/consent-requests/:id/approve` | MSME owner |
| `PATCH` | `/api/consent-requests/:id/reject` | MSME owner |
| `PATCH` | `/api/consent-requests/:id/revoke` | MSME owner |
| `GET` | `/api/trust-view/:consentRequestId` | Original requester |
| `GET` | `/api/audit-logs` | MSME owner |
| `GET` | `/api/notifications` | Any authenticated |
| `PATCH` | `/api/notifications/:id/read` | Notification owner |

## Error Shape

```json
{
  "error": {
    "code": "CONSENT_REVOKED",
    "message": "Access has been revoked by the business."
  }
}
```
