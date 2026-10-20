# HorizonXT — Evidence Intelligence (owner-facing vertical slice)

Branch `feature/horizon-evidence-intelligence`, based on `finals/main @ 05532f2`. Not merged, pushed or deployed.

Pramaan now reads the text of the PDFs an MSME uploaded, compares it with what the MSME declared, and computes the
smallest set of owner actions that closes the open issues. **Reading a document is not authenticating it.** No external
source is consulted and no external AI service is used.

## Modules (`src/modules/evidenceIntelligence/`)

| File | Role |
|---|---|
| `pdf-text.ts` | Bounded, dependency-free PDF text extraction. Never executes PDF content. |
| `field-extractors.ts` | Label-anchored, format-validated extraction for GST certificate, Udyam certificate, bank statement. |
| `reconciliation.ts` | Declared claims vs extracted values: `MATCHED / CONFLICTED / INSUFFICIENT / UNREADABLE`. Masking helpers. |
| `planner.ts` | Minimal Evidence Challenge planner. Pure, deterministic, validated through the real `runInternalCrossCheck`. |
| `evidence-intelligence.service.ts` | Owner-only service: reads the owner's own files, extracts, reconciles, plans, applies confirmed corrections. |
| `evidence-intelligence.routes.ts` | `GET /api/evidence-intelligence/review`, `POST /api/evidence-intelligence/corrections`. |

No schema or migration change. Nothing extracted is persisted.

## Extraction

Structured output per field: source document id, field, value (internal), page, line, confidence, status
(`EXTRACTED / AMBIGUOUS / MALFORMED / NOT_FOUND`). Per document: `EXTRACTED / PARTIAL / NOT_RECOGNISED / UNREADABLE /
UNSUPPORTED / REJECTED` plus a reason code.

**Supported:** text-based, unencrypted PDFs; uncompressed or FlateDecode content streams; single-byte fonts.
**Explicitly not supported (reported, never guessed):** images/scans (no OCR), PNG/JPEG, encrypted PDFs, object-stream
PDFs, composite (Type0/CID) fonts, other stream filters or predictors.

Limits: 5 MB, 20,000 objects, 12 pages, 2 MB per inflated stream / 8 MB total, 400k content operations, 200k text
characters, 2,000 lines. Limits are counters, not clocks, so results are deterministic. Stored paths are read only if they
resolve inside `UPLOAD_DIR`. The `%PDF-` magic number is checked (the client-supplied MIME type is not trusted).
PDF actions/JavaScript are never interpreted; extracted text is only matched against fixed anchored patterns, values are
format-validated and length-bounded, and a hostile name value is rejected.

A GSTIN whose check character does not validate is returned with reduced confidence and a note rather than trusted.

## Reconciliation

`legalName` (vs GST legal name, Udyam enterprise name, bank account holder), `gstin`, `pan` (vs the GST certificate's
PAN; also checks that PAN against the certificate's own GSTIN), `udyamNumber`, and `bankAccount`.
Name normalisation (case, punctuation, whitespace, "Private Limited"/"Pvt Ltd") is used for comparison only and never
alters a stored value. Identifiers are compared exactly after trim/upper-case/whitespace removal. A close-but-different
name (edit similarity ≥ 0.85) is `CONFLICTED`, never silently accepted. Declarations are never overwritten by a review.
`bankAccount` is always `INSUFFICIENT`/`UNREADABLE`: Pramaan has no structured bank-account claim to compare with.

## Planner

Issues: `DOC:<type>` (missing, expired, unreadable, unsupported, rejected, not recognised, essential field unclear),
`CONFLICT:<claim>` (reconciliation conflict or engine contradiction), `GAP:bankAccount` (by design unresolvable).
Actions: `SUBMIT_DOCUMENT` (always *conditional* — new content is unknown) and `CORRECT_CLAIM` (owner confirmation
required; candidates come from document text, the GSTIN-embedded PAN, or the account organisation name).

The planner enumerates every combination (≤ 20,000 evaluated) and re-runs the real trust rules plus reconciliation on each
hypothetical state. Objective, lexicographic: fewest unresolved issues → fewest owner actions → fewest new documents →
fewest identity-claim edits → stable tie-break. A document submission never resolves a content conflict (old extractions are
kept in the simulation). Any issue no action closes is returned in `unresolved` with a reason (`DOCUMENTS_DISAGREE`,
`NEEDS_HUMAN_REVIEW`, `NOT_SUPPORTED_BY_DESIGN`).

## API

`GET /api/evidence-intelligence/review` (MSME role, `Cache-Control: no-store`, 30 per 10 min per owner) →
`{ review: { documents, reconciliations, issues, plan: { actions, unresolved, benchmark }, limitations, … } }`.
PAN and account numbers are masked in every field; the GSTIN is shown in full to its owner only (it embeds the PAN).

`POST /api/evidence-intelligence/corrections` body `{ claim, sourceDocumentId, source, confirm: true }` (`.strict()`).
The value is **re-derived on the server from the current plan**; the client cannot supply it. A proposal that is not
currently in the plan returns `409`. Applying goes through the existing `upsertProfile` (same effect as editing the
profile: trust status returns to `SELF_DECLARED` until the owner re-runs the cross-check), plus an audit row with
`{ origin, claim, source }` and **no values**. Re-evaluation is simply the next `GET`.

## Privacy and security properties (tested)

* Owner-only. Requesters get no access to extracted values; no consent, grant or disclosure model was touched.
* No raw PAN or account number in audit rows, notifications or server logs (asserted by scanning).
* Existing Passport snapshots and consent records are byte-identical after a correction; no Passport is created.
* Cross-tenant: a second owner sees only their own documents; another owner's document id cannot drive a correction.
* Hostile input: decompression bomb, object flood, content-operation flood, truncated/garbage structures, oversized
  upload, encrypted PDF, composite font, PDF OpenAction/JavaScript, injected instructions, tampered stored path.

## Measured evidence-request reduction

Documents asked of the owner (`scripts/evidence-intelligence-tests.ts`, synthetic fixtures; "closed" counts issues the
plan closes; the by-design bank-account gap is counted as an open issue in every row):

| Scenario | Full pack (B1) | Outstanding-only (B2) | Planner docs | Planner owner actions | Issues closed (planner / B2) |
|---|---|---|---|---|---|
| All consistent | 3 | 0 | 0 | 0 | 0 / 0 |
| Udyam + bank missing | 3 | 2 | 2 | 2 | 2 / 2 |
| Expired Udyam | 3 | 1 | 1 | 1 | 1 / 1 |
| Unreadable GST certificate | 3 | 0 | 1 | 1 | 1 / 0 |
| Mistyped GSTIN | 3 | 0 | 0 | 1 (confirmed correction) | 2 / 0 |
| Mistyped legal name | 3 | 0 | 0 | 1 (confirmed correction) | 1 / 0 |
| Documents disagree | 3 | 0 | 0 | 0 (human review) | 0 / 0 |
| Typo + expired + missing | 3 | 2 | 2 | 3 | 4 / 2 |

Reading: vs the full pack the planner asks for 0–2 documents instead of 3 (a 33–100 % reduction) in every scenario. vs the
outstanding-only checklist it asks for the **same** number where only missing/expired documents are the problem, **more**
(1 vs 0) when a present document is unreadable — because a presence-only checklist cannot see that — and it closes issues
(typos, conflicts) that a checklist cannot address at all. It never reduces below B2 for missing/expired documents; that is
not claimed. B1/B2 here are computed from the vendor-onboarding pack's three document types and the Phase 1A
missing/expired rule; the numbers come from a synthetic scenario set, not production data.

## Known limitations

* No OCR: scanned certificates are `UNREADABLE`. Real-world GST/Udyam/bank PDFs vary; the label patterns match the
  synthetic fixtures and common wording, and have **not** been validated against real government or bank documents.
* Extraction is recomputed per request (bounded by 3–6 files); a per-owner rate limit is the only cost control.
* A correction resets `trustStatus` to `SELF_DECLARED` (existing `upsertProfile` behaviour) until the owner re-runs the
  cross-check; the review does not run it automatically.
* `organizationName` on the account cannot be edited through this flow, so a legal-name conflict whose only fix is a
  different account name is reported for human review.
* Human review is a reported state only; there is no reviewer queue yet.
* Expiry comes from owner-entered metadata, not from document text.
* The rate limiter is in-process (single instance).
* Merge risk: `frontend/src/App.tsx`, `navigation.ts`, `services/api.ts` and `src/app.ts` are small additive edits that
  may conflict with Codex's Phase 1A branch.
