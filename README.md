# Pramaan Backend

Pramaan is an MVP backend for consent-based business trust sharing for Indian MSMEs. It lets an MSME mock-verify business details once, generate a reusable Trust Passport, and share only approved fields with a buyer or bank through time-bound consent.

## Stack

- Node.js + Express + TypeScript
- Prisma ORM schema with SQLite for local demo
- JWT auth
- bcrypt password hashing
- multer local uploads
- Zod request validation

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
| `npm run prisma:generate` | Generate Prisma Client |
| `npm run prisma:migrate` | Run Prisma migrations where supported |
| `npm run db:init` | Initialize local SQLite demo DB without Prisma schema engine |
| `npm run prisma:seed` | Seed demo users, business, and sample document rows |

## Core Flow

1. Login as MSME.
2. `POST /api/business/verify` runs mock verification.
3. `POST /api/passport/generate` creates a versioned Trust Passport.
4. Login as Buyer or Bank.
5. `POST /api/consent-requests` requests fields by GSTIN.
6. MSME lists incoming requests and approves a subset for a duration.
7. Stakeholder calls `GET /api/trust-view/:consentRequestId`.
8. MSME revokes consent.
9. Stakeholder trust view is immediately blocked.
10. MSME audit log shows requested, approved, viewed, revoked.

## Important Scope Notes

- Verification is explicitly mock/rule-based. It validates GSTIN, Udyam, PAN formats and document presence.
- No live GST, Udyam, Account Aggregator, lending, marketplace, blockchain, or AI scoring integrations are included.
- Buyer and Bank users never receive raw uploaded documents and cannot fetch passports directly.

## API Summary

All protected endpoints require `Authorization: Bearer <token>`.

| Method | Path | Role |
|---|---|---|
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
