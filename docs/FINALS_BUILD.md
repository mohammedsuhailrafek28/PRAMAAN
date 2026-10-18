# Pramaan — Finals Build Engineering Record

Owner of this file: shared (Claude = product/frontend sections, Codex = backend/reliability sections).
Last updated: 2026-10-01 — initial repository audit (Claude). No code changed during the audit.

---

## 0. Repository facts every agent must know

| Item | State |
|---|---|
| Backend repo | `C:\Users\HAIL\Documents\pramaan` (git, this repo) |
| Current branch | `feature/report-html-pdf-rendering`, 5 commits ahead of origin, **not merged to `main`** |
| Frontend | `C:\Users\HAIL\Downloads\pramaan-frontend` — **NOT under version control** (no `.git`) |
| Frontend backups | Manual folder copies in `C:\Users\HAIL\Documents\pramaan-checkpoints\frontend-phase*`; the latest (`frontend-phase5-final-20260901-194727`) is byte-identical to the live `src/` |
| README | Says "No frontend in this repository" and that smoke "resets the local SQLite DB". The smoke test actually uses an isolated temp DB (`prisma/.tmp-smoke/<id>`) |

**Two agents cannot safely co-edit an untracked frontend.** Bringing it under git is the first action (see §10).

---

## 1. Architecture

**Backend:** Node 24, Express 5, TypeScript (NodeNext), Prisma 6 + SQLite, JWT (7d, HS256), bcrypt, multer local uploads (5 MB, PDF/PNG/JPEG), Zod validation, pino logging, helmet, CORS, rate limiting, Swagger at `/api/docs`, Playwright Chromium for report PDFs. Dockerfile + compose (SQLite + uploads volumes).

Modules (`src/modules`): `auth`, `business` (profile, documents, cross-check, GSTIN lookup), `trustEngine` (deterministic rules: identity, document, consistency, freshness → field/document confidence, gaps, contradictions, 5 metrics), `passport` (versioned Trust Profile snapshots), `consent` (registered verifier requests), `trustView` (verifier scoped view), `accessGrant` (tokenised guest links, SHA-256 token hash), `evidence` (lifecycle: CURRENT / EXPIRING_SOON / EXPIRED / CONFLICT / NEEDS_ATTENTION), `readinessEngine` (4 purpose profiles), `reportComposer` (immutable snapshots + HTML/PDF), `audit`, `notifications`.

Evidence status vocabulary: `SELF_DECLARED`, `DOCUMENT_SUBMITTED`, `CROSS_CHECKED`, `SOURCE_VERIFIED` (modelled, never produced), `REJECTED`, `EXPIRED`.

**Frontend:** React 18, Vite 5, TS, Tailwind + shadcn/Radix, Zustand, axios, react-hook-form + zod. Single HTTP adapter `src/services/api.ts` performs backend→UI field mapping. Routes: MSME (dashboard, verification, trust-profile, consent-requests, evidence-vault, access, audit-log, settings), buyer/bank workspace, `/trust-view/:consentId`, public `/verify/:token`.

**Integrations:** none real. No GST/Udyam/bank/AA/DigiLocker calls, no OCR, no AI. All "verification" is internal metadata cross-checking. This is honest in backend copy but not consistently in UI (see §6).

---

## 2. Validation run (2026-10-01)

| Check | Result |
|---|---|
| Backend `tsc --noEmit` | PASS |
| `npm test` (trust, readiness, reports, rendering, migrations, evidence lifecycle) | PASS |
| `npm run smoke` (real HTTP, 30 scenarios A–AC, temp DB) | PASS |
| `prisma migrate status` | 6 migrations, up to date |
| Frontend `tsc -b` | PASS |
| Frontend `vite build` | PASS (691 KB JS chunk warning) |
| Frontend `npm run lint` | **FAIL** — 2 `react-refresh/only-export-components` warnings with `--max-warnings 0` |
| Frontend tests | none exist |
| Authorization regression tests for consent data leakage | none exist |

---

## 3. Golden flow status

| # | Step | Status | Notes |
|---|---|---|---|
| 1 | MSME logs in, understands state | PARTIAL | Dashboard shows cross-check state, profile version, pending count, 3 evidence slots. Missing: active grants, expiry dates, missing-action list. Seed has no passport, so first view is mostly "Not generated". |
| 2 | MSME manages evidence | PARTIAL | Upload / replace / version history with issued/expiry/source works. Vault hides `evidenceStatus`; seeded documents have no file on disk and no dates; MSME cannot open their own file. |
| 3 | Pramaan evaluates evidence | PARTIAL | Backend distinguishes statuses and lifecycle correctly. UI collapses to Current / needs-attention, and shows green checks where nothing was verified (§6). |
| 4 | Trust Card | PARTIAL | `TrustProfileCard` exists but: fake decorative QR, "Business Trust Passport" naming, no provenance / freshness / conflicts / last-checked, Bank row can never tick, mixes live business fields with snapshot data. |
| 5 | Verifier requests info | PARTIAL | Field selection + purpose (enum) work. No requested validity period, no free-text purpose. Field labels misrepresent what is disclosed (§5 S3). |
| 6 | MSME receives request | PARTIAL | Requester, fields, purpose, approve-subset + duration, reject all work. Approve dialog offers *unrequested* fields → backend 400. No "what exactly will be disclosed" preview. |
| 7 | Verifier Trust View | PARTIAL | Backend enforces approved fields. UI stringifies objects, puts a green shield on every value, shows no per-field provenance/freshness, polls every 3 s (each poll writes an audit row). |
| 8 | MSME revokes | PASS (revoke) / PARTIAL (expiry) | Revoke enforced server-side (410 `CONSENT_REVOKED`). Expiry is lazy: an expired consent stays `APPROVED` and shows "Active" to the MSME until the verifier happens to open it. |
| 9 | Audit | PARTIAL | MSME-only. UI silently drops rejections, expiries, access-grant events, profile/report events. Trust View polling floods "Viewed". Verifier has no audit view. Not tamper-evident. |

---

## 4. Critical problems (genuine, with location)

1. **Frontend not version-controlled** — `Downloads/pramaan-frontend`. Blocks safe two-agent work and the finals freeze.
2. **Consent bypass: full business record leaked to any requester** — `src/modules/consent/consent.service.ts` `list()` outgoing branch uses `include: { business: true }`. Confirmed live: a buyer with a *PENDING* request received raw PAN, Udyam number, address, turnover band and owner user id. Also applies after reject/revoke.
3. **Audit action contract mismatch** — backend writes `REJECTED` and `EXPIRED` (`consent.service.ts`, `trustView.service.ts`); frontend `getAuditLogs()` maps `CONSENT_REJECTED` / `CONSENT_EXPIRED`, which don't exist in the enum, so these events never render. `flatMap` also drops every `ACCESS_GRANT_*`, `REPORT_*`, `BUSINESS_PROFILE_*`, `EVIDENCE_GAP_FOUND`, `CONTRADICTION_FOUND`.
4. **Trust View polling writes audit rows** — `DynamicTrustViewPage` polls every 3 s, and `trustView.service.ts` writes `TRUST_PROFILE_VIEWED` on every GET: about 1,200 audit rows/hour per open tab.
5. **Lazy expiry** — consent status only flips to `EXPIRED` inside `getTrustView`; list endpoints return stale `APPROVED`. The expiry audit actor is the verifier. In `accessGrant.service.ts` `resolveGuest`, the expired branch writes `status: ACTIVE` (no-op) and logs `ACCESS_GRANT_EXPIRED` on every hit.
6. **Verification results page reads the wrong source** — `BusinessVerificationPage` derives GSTIN/Udyam/PAN ticks from `passports[0].snapshotJson.fieldConfidence`, not from the cross-check just run. Before a passport exists, everything reads "Unverified".
7. **Demo seed is not demo-ready** — `prisma/seed.ts` creates no passport, no files on disk, no dates, no stale/conflict case, no pending request. `demo:reset` doesn't clear `uploads/`.

---

## 5. Security & privacy findings

| ID | Severity | Finding | Location |
|---|---|---|---|
| S1 | P0, confirmed live | Outgoing consent list returns the entire `Business` row (PAN, Udyam, address, turnover, `userId`, `trustSummary`) regardless of consent state | `consent.service.ts` `list()` |
| S2 | P0, confirmed live | Consent field vocabulary is `allowedPassportFields`, which includes `pan`, `bankAccount`, `fieldConfidence` (bundles *every* claim value), `documentConfidence`, `gaps`, `contradictions`. A buyer can request these via API. The MSME UI renders unknown fields as blank chips, so the MSME can't see what was requested. | `utils/fieldFilter.ts`, `consent.service.ts` `ensureFields` |
| S3 | P0 (privacy/consent integrity) | Labels shown to the MSME don't match what is disclosed. "Bank Verification Status" → `documentConfidence` (confidence + ids for all documents). "Compliance Status" → `summary` metrics. Approving `gstin` / `udyamNumber` also discloses the GST/Udyam certificate metadata, including original filename, without an explicit evidence choice. | `services/api.ts` `fieldToApi`, `trustView.service.ts` `approvedEvidenceTypes` |
| S4 | P1 | Trust View serves the *latest* passport, not the one at consent time. A passport can be stale relative to edited claims (profile edit resets `trustStatus`, but the old passport is still served). No freshness signal to the verifier. | `trustView.service.ts` |
| S5 | P1 | Expiry is not enforced on list views (see §4.5) | consent / accessGrant |
| S6 | P1 | `JWT_SECRET` falls back to a hard-coded default with no production guard. Local `.env` uses `CORS_ORIGIN="*"`. 7-day JWT in localStorage, no server-side logout or revocation. | `config/env.ts` |
| S7 | Product limitation | Anyone can self-register as `BANK` or `BUYER`; verifier identity is unverified. Must be disclosed in the demo. | `auth.routes.ts` |
| S8 | P2 | Register duplicate check uses the un-lowercased email → unique-constraint 500 on case variants | `auth.service.ts` |
| S9 | P2 | Rejected uploads remain on disk; MIME type is taken from the client header | `business.routes.ts` / `uploadDocument` |
| S10 | P2 | Audit log is mutable rows with no hash chain or signature | `audit.service.ts` |

Verified working: role middleware; owner checks on approve/reject/revoke; requester-only Trust View; revoke → 410; MSME A cannot reach B's data via `/business/me` (scoped by JWT user); buyer → `/business/me`, `/audit-logs` = 403; MSME → lookup = 403; guest tokens are 256-bit, stored hashed; no raw document download endpoint exists; report HTML escapes values.

---

## 6. UX problems that reduce judge confidence

- **Misleading trust signals:** fake QR plus "Dynamic credential, not a static PDF" on the Trust Card; a green shield beside every Trust View value; copy saying "only the verified fields" while nothing is externally verified.
- **Naming drift:** Business Trust Passport / Verification Profile / Trust Profile / Trust Card / "Regenerate Passport" all refer to the same object.
- **Information architecture:** the MSME sidebar omits Trust Profile and Business Verification; Topbar has no titles for Evidence and Access; footer reads "Pramaan MVP · Frontend Demo". Registered consent ("Requests") and guest links ("Access") use different vocabularies on different pages.
- **Verifier workspace:** case cards say "MSME business" instead of the business name (`businessName` is mapped but unused). No case detail.
- **Consent history:** rejected cards render "Invalid Date" (`rejectedAt` is never mapped); `durationHours!` label is undefined for non-1/7/30-day durations.
- **Role switcher:** hard-coded personas (Rajeev Sharma / Priya Nair / Vikram Rao) don't match the seed (Ravi Sharma / Ananya Iyer / Karan Mehta).
- **Turnover band:** seed `"INR 1Cr-INR 5Cr"` maps to "₹1.5 Cr – ₹5 Cr"; unknown values silently become "Under ₹40 Lakh", and saving the form then overwrites the backend value.
- **Mobile:** sidebar is hidden below `md` with no alternative nav.
- **Unexposed backend:** the readiness engine and report composer (HTML/PDF) have no UI at all.

---

## 7. Technical debt relevant to finals

Untracked frontend; README out of date; 5 unpushed commits on a misnamed branch; root clutter (logs, PNGs — gitignored); no frontend tests; no consent-leak regression tests; lint gate failing; `playwright` in prod dependencies (needed for PDF, but adds image size); legacy `AuditAction` values (`REQUESTED`, `APPROVED`, `REJECTED`, …) coexisting with `CONSENT_*`.

---

## 8. Finals plan

### P0 — must work

| Item | Owner |
|---|---|
| Bring frontend under git (see decision D1) | Claude (after human decision) |
| S1: shape outgoing consent response to `{legalName, gstin}` + consent metadata only | Codex |
| S2/S3: define one **disclosure catalogue** (fields + evidence items, with human labels) shared by consent requests and access grants; reject anything else; make evidence disclosure explicit | Codex (contract) → Claude (UI) |
| Effective-status-on-read expiry for consents and grants; idempotent expiry audit; system actor | Codex |
| Audit action normalisation (emit `CONSENT_REJECTED` / `CONSENT_EXPIRED` or document the mapping) | Codex (+ Claude mapper) |
| Trust View: audit one `VIEWED` per consent per session/window; frontend stops 3 s polling | Codex + Claude |
| Authorization regression tests (A↔B isolation, scope, revoke, expiry, leak checks) | Codex |
| Deterministic demo seed: passport, real fixture files, dates, one stale + one conflict case, one pending request; `demo:reset` clears uploads | Codex |
| JWT secret production guard | Codex |
| Frontend contract fixes (§4.3, §4.6, §6 consent history, verifier name, turnover, role switcher, approve dialog requested-only) | Claude |
| Remove misleading trust affordances (fake QR, blanket shields, "verified" copy); one shared status-badge component for the evidence status vocabulary | Claude |

### P1 — finals polish

| Item | Owner |
|---|---|
| Trust Card redesign: identity, per-check status, provenance, freshness, conflicts, last checked, snapshot version | Claude |
| Evidence Vault: per-type slots (missing / submitted / cross-checked / expiring / expired / conflict), status + history | Claude |
| Dashboard storytelling: next actions, active access, expiring evidence | Claude |
| Unified "Requests & Access" IA; consent approval shows exact disclosure preview | Claude |
| Verifier workspace: case list with business names, case detail, Trust View with provenance and expiry countdown | Claude |
| Audit timeline: all events, human-readable details | Claude |
| Mobile nav, naming pass, empty/loading/error states, a11y pass, lint green | Claude |
| Verifier-side audit endpoint (own requests/views) | Codex |
| Trust View tied to snapshot version at consent time, plus stale indicator | Codex |
| API-level golden-journey e2e test | Codex |

### P2 — only after P0/P1 are solid

Signed/hashed Trust View snapshot (Codex) + verification page and real QR (Claude); readiness/report UI; richer conflict explanations; hash-chained audit.

---

## 9. Files likely to change (conflict map)

**Codex:** `src/modules/consent/**`, `src/modules/trustView/**`, `src/modules/accessGrant/**`, `src/modules/audit/**`, `src/utils/fieldFilter.ts`, `src/config/env.ts`, `src/docs/openapi.ts`, `prisma/schema.prisma` + new migration (if the enum changes), `prisma/seed.ts`, `scripts/demo-reset.ts`, `scripts/smoke-test.ts`, new `scripts/authz-tests.ts`, `test-fixtures/`.

**Claude:** `frontend/**` once imported (all of `src/pages`, `src/components`, `src/services/api.ts`, `src/types`), README frontend section.

**Shared, coordinate before editing:** this file (edit only your own sections), the disclosure catalogue contract (Codex writes it here first, Claude consumes it).

---

## 10. Recommended first phase

**Phase 0 (≈1 h, low risk):**
1. Human decides D1 and D2.
2. Create branch `finals/main` from current HEAD; import frontend; commit this document.

**Phase 1 (in parallel, no file overlap):**
- **Codex:** fix S1 (one `select`), then expiry-on-read, audit normalisation, de-duplicated Trust View audit, authz regression tests, demo seed.
- **Claude:** frontend truthfulness and contract fixes that don't depend on the new catalogue: misleading badges, QR, audit mapper tolerant of both action names, consent history dates, verifier business names, approve dialog limited to requested fields, polling, role switcher, nav and titles.

Then the disclosure catalogue (S2/S3): Codex publishes the contract here → Claude rebuilds the request, approval and Trust View UI against it.

---

## 11. Decisions needed from the human

- **D1 — Frontend location.** Recommended: import into this repo as `frontend/` (monorepo, one history, one PR, shared docs). Alternative: a separate git repo.
- **D2 — Branch strategy.** Recommended: `finals/main` from current HEAD (which contains Phases 1–3 + hardening), merged to `main` at freeze.
- **D3 — Evidence disclosure model.** Recommended: consent scope becomes `{fields, evidenceTypes}` (same as access grants), so approving GSTIN no longer silently shares certificate metadata. This is a contract change touching both agents.
- **D4 — Two sharing models.** Recommended: keep both. The registered-verifier consent flow is the golden path; secure guest links stay as a secondary "share with someone not on Pramaan" feature, using the same catalogue and vocabulary.

---

## 12. Demo accounts (current)

All passwords are `password123`: `msme@pramaan.demo` (Ravi Sharma, Sharma Textiles, GSTIN `33ABCDE1234F1Z5`), `buyer@pramaan.demo` (Ananya Iyer, Acme Retail Buyers), `bank@pramaan.demo` (Karan Mehta, Kisan NBFC). Reset: `npm run demo:reset`.

## 13. Commit log for finals

## 14. Finals Phase 1 backend contract (Codex)

The registered-consent and guest-link APIs use the same disclosure catalogue. Safe field keys are `legalBusinessName`, `ownerName`, `gstin`, `udyamNumber`, `address`, `turnoverBand`, and `summary`. Explicit evidence keys are `GST_CERTIFICATE`, `UDYAM_CERTIFICATE`, and `BANK_STATEMENT`, labelled respectively Legal business name, Owner name, GSTIN, Udyam number, Business address, Turnover band, Trust summary, GST certificate evidence, Udyam certificate evidence, and Bank statement evidence.

Evidence is explicit. Approving `gstin` or `udyamNumber` does not disclose evidence metadata. Evidence responses omit file paths, original filenames, MIME details, and raw document contents. Requests and approvals use `requestedFields`/`approvedFields` and `requestedEvidenceTypes`/`approvedEvidenceTypes`; approved arrays must be subsets of their corresponding requested arrays.

Consent approvals pin `approvedPassportId` to the exact passport snapshot used for the grant. Trust View and guest links resolve that snapshot, not the latest passport. Reads materialize expired consent/grant state, emit one expiry event, and return `CONSENT_EXPIRED` or `ACCESS_EXPIRED` without reactivating the record. Trust View and guest-open audit events are deduplicated for five minutes.

`NODE_ENV=production` requires an explicit non-default `JWT_SECRET`. Demo seed data is synthetic and deterministic: `npm run demo:reset` creates the three demo credentials above, a verified profile, local fixture paths, a stale bank evidence row, a generated passport, and one pending consent request. No external government verification, LLM, blockchain, lending, marketplace, or scoring service is used.

Registered Trust View fields are disclosed as `{ value, status, evidenceStatus, source, lastCheckedAt, freshnessState }`. `source` is currently `INTERNAL_DETERMINISTIC_CHECKS` for evaluated snapshot fields; it is never external or government verification. Evidence items expose `{ docType, evidenceStatus, confidence, crossCheckMethod, source, issuedAt, checkedAt, expiresAt, uploadedAt, lifecycle }`; filenames, MIME types, paths, and file contents are excluded. Guest responses use the same field/evidence shapes and add `grant.profileVersion`. `lifecycle.freshnessState` is `CURRENT`, `EXPIRING_SOON`, or `EXPIRED`; `lifecycle.state` may additionally be `CONFLICT` or `NEEDS_ATTENTION`.

Field and evidence status values are `SELF_DECLARED`, `DOCUMENT_SUBMITTED`, `CROSS_CHECKED`, `SOURCE_VERIFIED`, `REJECTED`, and `EXPIRED`; `SOURCE_VERIFIED` is reserved for a future source adapter and is not emitted by the current deterministic engine. Field `freshnessState` is `CURRENT` or `EXPIRED` based on the pinned snapshot checks. Evidence `lifecycle.freshnessState` is `CURRENT`, `EXPIRING_SOON`, or `EXPIRED`, and `lifecycle.state` is `CURRENT`, `EXPIRING_SOON`, `EXPIRED`, `CONFLICT`, or `NEEDS_ATTENTION`.

The `summary` disclosure is a calculated Pramaan trust summary, not a business-submitted claim. When disclosed through registered Trust View or a guest link, it is labelled `status: CROSS_CHECKED`, `evidenceStatus: CROSS_CHECKED`, and `source: INTERNAL_DETERMINISTIC_CHECKS`. It is not `SELF_DECLARED`, `MSME_SUBMITTED`, or `SOURCE_VERIFIED`.

The authoritative audit events emitted by the current backend are: `CONSENT_REQUESTED`, `CONSENT_APPROVED`, `CONSENT_REJECTED`, `CONSENT_EXPIRED`, `CONSENT_REVOKED`, `TRUST_VIEW_OPENED`, `GUEST_LINK_CREATED`, `GUEST_LINK_OPENED`, `GUEST_LINK_REVOKED`, `GUEST_LINK_EXPIRED`, `EVIDENCE_UPLOADED`, and `EVIDENCE_REPLACED`. Legacy enum aliases remain in the schema for historical records only and are not emitted by the consent/guest/evidence paths.

Report generation intentionally refreshes a deterministic Trust Profile snapshot before composing the report, so the report records the current business/evidence state and its exact `trustProfileId`. This may increment the Trust Profile version. It cannot alter existing registered consents or guest links because those grants retain `approvedPassportId`/`passportId` and resolve the pinned snapshot; the release smoke and reliability journeys verify this behavior.

| Commit | Agent | Summary |
|---|---|---|
| `8b9c2e7` | — | Baseline at audit time ("Harden Pramaan release candidate") |

## 15. Frontend Phase 0–1 handoff (Claude)

**Commits on `finals/main`:** `0b9017c` audit doc · `3601fa6` verbatim frontend import into `frontend/` (same build asset hashes as the Downloads copy) · `d2a9a6e` lint gate green · `7f3640c` shared navigation + mobile drawer · `5748b6a` frontend correctness pass.

**Validated against the committed backend** (isolated worktree, scratch DB copy, not Codex's in-progress tree): 32/32 headless-browser checks across MSME login → dashboard → evidence upload → cross-check → Trust Profile; verifier request → case list → Trust View; MSME approve (requested-only) / reject / revoke → Activity; 390px mobile nav. Frontend `tsc`, `eslint --max-warnings 0` and `vite build` pass at every commit.

**What the frontend now assumes (please keep stable or tell me):**
- `GET /consent-requests?scope=outgoing` → the UI reads only `business.legalName` and `business.gstin` (the same identity GSTIN lookup already returns). Shaping the response to exactly those (S1) needs no frontend change.
- `POST /business/cross-check` → `{ trustStatus, profile: { lastCalculatedAt, summary, fieldConfidence[], documentConfidence[], gaps[], contradictions[], limitations[] } }` is rendered directly as the cross-check result.
- Passport snapshot keys `fieldConfidence`, `documentConfidence`, `gaps`, `contradictions`, `summary`, `version`, `generatedAt` drive the Trust Card.
- Audit: `frontend/src/lib/auditEvents.ts` maps every current `AuditAction` plus `CONSENT_REJECTED` / `CONSENT_EXPIRED`; unknown actions render humanized. **Codex: please publish the canonical action list here** and I'll trim the legacy aliases. The UI credits expiry events to "Pramaan (automatic)" and guest-link opens to "Link recipient". If you record a system actor, tell me the shape.

**Blocked on the disclosure contract (§14 draft, not yet committed) — next frontend phase:**
1. Replace UI consent keys `complianceStatus`→`summary` and `bankVerificationStatus`→`documentConfidence` with the catalogue keys/labels; drop `documentConfidence` from the request form.
2. Add explicit evidence selection to request and approval (`requestedEvidenceTypes` / `approvedEvidenceTypes`).
3. **Remove** the approve-dialog note "these fields also share details of your current GST/Udyam certificate…" (`IMPLIED_EVIDENCE_BY_BACKEND_FIELD` in `frontend/src/lib/fieldLabels.ts`). It is true for the committed backend and becomes false the moment §14 lands. Codex: please flag in your commit message when that behaviour changes.
4. Trust View / guest link: show the pinned snapshot version (`approvedPassportId`) and handle `ACCESS_EXPIRED`.

**Nice-to-have API additions (P1, not blocking):** `rejectedAt` on consent requests (history currently shows "declined" without a time); a `GET` for the latest cross-check result so field-level results survive a page reload; `GET /audit-logs` for verifiers (their own requests/views).

**Still incomplete or potentially misleading in the UI:** readiness and report features have no screens; Evidence Vault has no per-type "missing" slots and no way to open your own file; the verifier has no audit view; the Access (guest-link) page still uses its own field vocabulary until the catalogue lands.

## 16. Frontend contract alignment (Claude)

**Commit:** `c38260a`, aligned to Codex's `a834f0c` and `bbbd73c`. This supersedes the "blocked on the disclosure contract" list in §15.

**Validation.** `npm run check` (contract sync, `tsc -b`, eslint `--max-warnings 0`, `vite build`) passes. A headless golden journey passed **55/55** against `bbbd73c` in an isolated worktree, using a fresh database built from its migrations and seed. It covered:
- FIELD-only, EVIDENCE-only and mixed requests (payloads verified against the API)
- partial approval, plus an unrequested item that can't be offered in the UI and is rejected by the API (HTTP 400)
- GSTIN approval without the GST certificate, and an explicit GST certificate approval (metadata only, no file name or MIME type)
- "Shared from Trust Profile vN" surviving a newer version
- evidence pinned across a later replacement
- expiry, revocation, invalid-link and guest-link states with no raw backend strings
- a guest-link selector identical to the consent vocabulary
- canonical Activity events
- cross-check, Trust Profile and mobile layout

Expiry was simulated by backdating `expiresAt` in the scratch database.

**Frontend contract guard.** `frontend/src/lib/disclosure.ts` mirrors `src/utils/disclosureCatalogue.ts`. `npm run check:contract` parses both and fails if keys, labels or kinds differ. **Codex: if you change the catalogue, run `cd frontend && npm run check:contract`; a failure means the UI needs a matching update.** Field descriptions are frontend-only copy.

**Discrepancies between docs and implementation (implementation treated as authoritative; nothing compensated in the frontend):**
1. **Trust View and guest fields carry no check status.** `filterPassportFields` now unwraps the snapshot's `{ value, evidenceStatus, confidenceReason }` to the bare value. Verifiers can no longer see whether GSTIN was cross-checked or only self-declared, which golden-flow step 7 asks for. Request: return `{ value, evidenceStatus, confidenceReason }` per disclosed field (the UI already renders a status badge when present).
2. **Guest-link evidence differs from Trust View evidence.** Trust View picks the latest version uploaded at or before the pinned snapshot, current or not. Guest links filter `business.documents`, which only includes `isCurrent: true`. So a document replaced after a guest link is created disappears from that link, while a registered consent keeps showing the pinned version.
3. **Guest links don't expose the pinned Trust Profile version.** The guest response has no `passportVersion`, so "Shared from Trust Profile vN" is only possible for registered consent. Request: add `passportVersion` to `resolveGuest`'s response.
4. **Lifecycle differs.** Guest evidence includes `lifecycle` (freshness); Trust View evidence does not, so verifiers see no "Stale" or "Expiring soon" badge.
5. **No canonical audit event list in §14.** The frontend registry was keyed to the actions the code emits (`grep AuditAction.` in `src/modules`). Legacy names (`REJECTED`, `EXPIRED`, `DOCUMENT_SUBMITTED`, `ACCESS_GRANT_*`, …) are no longer mapped; they render with a humanized fallback.
6. GSTIN lookup no longer returns `address`. That's fine; the UI no longer displays it.

**Behaviour the UI relies on:**
- `metadata.passportVersion` on Trust View.
- Error codes `CONSENT_REVOKED`, `CONSENT_EXPIRED`, `PROFILE_NOT_READY`, `ACCESS_REVOKED`, `ACCESS_EXPIRED`, `INVALID_ACCESS_LINK`, `PROFILE_SNAPSHOT_UNAVAILABLE`, `CONFLICT`.
- `CONSENT_EXPIRED` and `GUEST_LINK_EXPIRED` are shown as "Pramaan (automatic)"; `GUEST_LINK_OPENED` as "Link recipient".

## 17. Phase 2 demo recovery and release runbook

### Normal start

```powershell
npm install
npm run prisma:generate
npm run db:init
npm run db:seed
npm run build
npm start
```

Backend: `http://localhost:4000`. Health: `http://localhost:4000/api/health`. Interactive API docs: `http://localhost:4000/api/docs`.

### Reset demo

Run `npm run demo:reset`. This recreates the tracked SQLite schema and deterministic Sharma Textiles scenario. It is safe to run repeatedly. Demo credentials are `msme@pramaan.demo`, `buyer@pramaan.demo`, and `bank@pramaan.demo`; all use `password123`.

### Verify database

Run `npm run db:status`. It must report `Database schema is up to date!`. For a full release check, run `npm run build`, `npm test`, `npm run smoke`, and `npm run reliability`.

### Restart frontend/backend

Backend: stop the existing process with `Ctrl+C`, then run `npm start`. Frontend: from `frontend/`, run `npm install` once and `npm run dev`; use the URL printed by Vite, normally `http://localhost:5173`.

### Golden journey

Log in as the MSME, confirm the seeded Trust Profile and evidence, log in as the buyer, open the pending request, approve only selected fields as the MSME, open the buyer Trust View, create and open a guest link, then verify revoke and expiry states. The automated equivalent is `npm run reliability`.

### Recovery if the database becomes inconsistent

Stop the backend, run `npm run demo:reset`, confirm `npm run db:status`, and restart the backend. Do not delete migrations or edit `dev.db` manually. If reset itself fails, preserve the error output and return to the last known safe commit below before retrying.

### Last known safe commit

Phase 2 reliability checkpoint: `5be69e6c8e63ad7defc6d74c6621857dc417c196` (Phase 1.5 contract parity). The current Phase 2 changes should only be promoted after `npm run reliability` and the full validation suite pass.

## 18. Frontend Phase 2 — product experience (Claude)

**Commits:** `eb5a00e` design system + dashboard · `0278497` Trust Card + Evidence Vault · `ec33a4a` Consent & Access center · `3028346` verifier workspace + case page · `92d615e` Activity, Readiness, Reports · `e65cf7f` accessibility + touch targets. No backend, schema, contract, auth, audit or snapshot semantics were changed.

**Screen map**

| Route | Purpose |
|---|---|
| `/msme/dashboard` | Identity, Trust Profile version/freshness, trust readiness, evidence health, access; Action Center (next actions derived from backend state, each deep-linked) |
| `/msme/verification` | Business Profile claims + internal cross-check results |
| `/msme/evidence-vault` | Three evidence slots (present/missing, check status, freshness, dates, source, version history, replace); `?upload=<type>` opens the upload dialog |
| `/msme/trust-profile` | Trust Card + claims table (status, freshness, reason) + evidence behind the version + conflicts/gaps + "What Pramaan does not verify" |
| `/msme/consent` | Consent & Access: `?tab=requests | active | links | history`. Old `/msme/consent-requests` and `/msme/access` redirect here |
| `/msme/audit-log` | Activity as plain-language sentences, day headings, category filters |
| `/msme/readiness` | Backend readiness engine: score, level, blockers, next actions, requirement checklist |
| `/msme/reports` | Generate / preview (HTML) / download (PDF) / revoke report snapshots |
| `/buyer|bank/dashboard` | Verification cases list + new request (GSTIN → purpose → canonical scope) |
| `/trust-view/:id` | Case page: overview + approved scope for every state; shared information / evidence / trust context only when active |
| `/verify/:token` | Secure-link recipient page (same components and vocabulary as registered consent) |

**Demo click path (≈4 min, fresh `npm run demo:reset`)**
1. MSME → Dashboard: Action Center shows the seeded request and the stale bank statement.
2. Click **Replace** → upload `test-fixtures/bank-statement.pdf` (issued 2026-09-01, expiry 2027-08-31) → evidence 3/3 current, history kept.
3. Trust Profile → **Generate new version** (v2).
4. Switch to Buyer → **New request** → GSTIN `33ABCDE1234F1Z5` → purpose *Business Loan* (preset includes bank statement evidence) → Send.
5. Switch to MSME → Consent & Access → **Review & approve** → untick *Turnover band* ("Sharing 5 of 6") → read the "What they will see" preview → Approve.
6. Switch to Buyer → **Open** the case → shared information with statuses, the replaced bank statement as *Current*, "Shared from Trust Profile v2".
7. MSME → Active access → **Revoke access** (confirm) → Buyer refresh shows "Access was revoked".
8. MSME → Secure links → create, open in a private window, revoke → "Access was revoked".
9. MSME → Activity → the whole story in sentences.

**Validation (all from a freshly seeded scratch DB in an isolated worktree):**
- **Static checks:** `npm run check` (contract sync, `tsc -b`, eslint `--max-warnings 0`, `vite build`) passes at every commit.
- **Golden journey:** 50/50 headless checks, run against both `5be69e6` and HEAD `e65cf7f` (which includes Codex's `ce0fceb`, `4ac4f8c`, `94d34f6`). Covered: MSME journey, verifier request/approved case/refresh (exactly one Trust View call per open and per refresh), revoke, expiry (backdated in scratch DB), secure link create/open/revoke/expire, Activity sentences, readiness, report PDF (`%PDF-`), keyboard skip link, and mobile at 390px (no horizontal overflow, no tap targets under 32px, drawer, dialog fits viewport).
- **Accessibility:** axe-core WCAG 2.0/2.1 A+AA reports 0 violations on 16 screens (all MSME pages, verifier list and case, secure-link page, login, register, landing).

**Backend observations for Codex (not compensated in the frontend beyond display wording):**
1. `fieldFilter.ts` tags the disclosed **Trust summary** as `status: SELF_DECLARED, source: MSME_SUBMITTED`. It is computed by Pramaan, so the UI shows it without a status badge as "Calculated by Pramaan from internal checks". Suggest a distinct source (e.g. `PRAMAAN_CALCULATED`) and no claim status.
2. `deriveEvidenceLifecycle().conflict` is `true` for any failed check, including expiry, so expired documents carry `conflict: true` while `state` is `EXPIRED`. The UI keys conflict messaging off `state === "CONFLICT"` only.
3. The MSME-side consent list (`publicConsent`) and `GET /access-grants` don't expose the pinned Trust Profile version, so Active access can say "pinned at approval" but not "v2". Request: include `approvedPassportVersion` / `profileVersion`.
4. Generating a report calls passport `generate()` (`report-data-loader.ts`), creating a new Trust Profile version as a side effect. Later approvals pin that version. The Reports page now discloses this; confirm it's intended.
5. Readiness `evaluate` re-runs `calculateAndPersistBusinessTrustProfile`; the Readiness page discloses this.
6. Seed purpose is "Vendor onboarding" while the request enum is "Vendor Onboarding"; cosmetic mismatch between seeded and UI-created requests.
7. Verifiers have no audit endpoint; "Last activity" in the case list is derived from request timestamps only.
