# HorizonXT — Advanced Document Intelligence

Extension of [HORIZON_EVIDENCE_INTELLIGENCE.md](HORIZON_EVIDENCE_INTELLIGENCE.md). The owner evidence review, the
reconciliation rules, the Minimal Evidence Challenge planner, the API and the owner-confirmed correction flow are
unchanged in shape; what changed is **how documents are read**: from "text-based, simple PDFs only" to a page-aware hybrid
pipeline that also reads scanned, rotated, mixed and multi-column documents and reconstructs multi-page bank-statement
tables — locally, with no external service.

A second hardening pass (this revision) added two things that the first pass lacked and flagged as gaps:
**asynchronous review jobs** (§1a: reading takes seconds to minutes, so it no longer happens inside one HTTP request) and a
**containerised, network-less worker** (§4a: the OS-level isolation that §4 used to list as "not enforced"). It also adds an
**experimental, opt-in pypdfium2 backend** (§2a) to evaluate replacing the AGPL-licensed PyMuPDF; it is *not* the default.

> Extraction is not authentication. Nothing here consults GST, Udyam, a bank, Account Aggregator or DigiLocker.
> Every number below was measured on a **synthetic corpus**; no real GST certificate, Udyam certificate or bank statement
> was available, so this document makes **no claim about accuracy on real documents or on universal PDF compatibility**.

## 1. Architecture

```
upload (PDF/PNG/JPEG, ≤5 MB)           Node (Express)                             Python worker (separate process)
────────────────────────────  ──────────────────────────────────  ───────────────────────────────────────────────
stored under UPLOAD_DIR  ──▶  evidence-intelligence.service
                              · reads file inside UPLOAD_DIR only
                              · cache (owner+doc+sha256+version)
                              hybrid-extractor.ts
                              · magic-byte check (MIME not trusted)
                              worker-client.ts  ─ spawn(argv, no shell) ─▶  worker.py
                              · private temp dir, 0600 copy                  limits.py: no network, memory cap, no children
                              · minimal env, TEMP → private dir              pipeline.py
                              · 120 s kill, 24 MB stdout cap                   1. validate: encrypted? xref count? active content?
                              · concurrency 2 + queue 8 → 503                  2. per page: embedded words + bboxes (+ rotation)
                              · zod schema validation of the JSON              3. text usable? (alnum, words, garbling, letter stats)
                              · temp dir removed in `finally`                  4. no → render (pixel cap) → RapidOCR (offline ONNX)
                                      ▲                                           orientation recovery, mixed-page image regions
                                      │ validated JSON (pages→lines→segments:   5. reading order, columns, line/segment boxes
                              domain-extraction.ts   text, bbox, conf, method)  6. bank table reconstruction + balance validation
                              · label→value association by geometry
                              · identifier validation (GSTIN check char, PAN, Udyam, IFSC)
                              · evidence-based confidence + review reasons
                              · account number masked at extraction
                              reconciliation.ts / planner.ts  (UNCERTAIN readings never conflict or correct)
                              serializer → owner-only JSON → frontend EvidenceReviewPage
```

Fallback: in **local** mode, if the worker cannot start (Python/dependencies missing), PDFs are read by the original
dependency-free TypeScript parser (`pdf-text.ts`), the result is labelled `engine: "LEGACY"` and the UI says scanned pages
cannot be read in that mode. Images are then `UNSUPPORTED`. In **container** mode (the production default) there is *no*
silent downgrade: if the container cannot run, the document is reported `UNREADABLE / WORKER_UNAVAILABLE` and the job is
marked `degraded` — parsing untrusted files inside the API process is exactly what the container exists to avoid.

## 1a. Asynchronous review jobs

Scanned pages take 5–30 s each, so a three-document review can take over a minute — longer than an HTTP request should
be held open (the previous synchronous design failed the 30 s browser timeout on a 22 s bank statement). Reading is now a job:

```
POST /api/evidence-intelligence/jobs            → 202 { job }           (returns at once; joins the owner's active job if there is one)
GET  /api/evidence-intelligence/jobs/:jobId     → { job, resultState?, review? }     (poll; cheap row read; own rate limit 900/10 min)
POST /api/evidence-intelligence/jobs/:jobId/cancel → { job }
GET  /api/evidence-intelligence/review          → 409 REVIEW_NOT_READY unless results are cached (never runs OCR)
POST /api/evidence-intelligence/corrections     → 409 REVIEW_EXPIRED unless results are cached (never runs OCR)
```

`job` = `{ id, status: QUEUED|RUNNING|SUCCEEDED|FAILED|CANCELLED, docsTotal, docsDone, currentStep: "READING:<DOC_TYPE>"|null,
errorCode, degraded, isolation: CONTAINER|LOCAL_PROCESS|null, createdAt, startedAt, finishedAt }`. `resultState` (SUCCEEDED jobs
only): `READY` (review attached, belongs to the current documents), `STALE` (a document was replaced after the job read the
files; no review), `EXPIRED` (the in-memory results are gone; no review).

| Property | Behaviour |
|---|---|
| Storage | SQLite table `EvidenceReviewJob` (additive migration `202610200001_evidence_review_jobs`). Stores status, progress, error *code*, a fingerprint of the document revisions — **no extracted content, no filenames, no identifiers**. Extracted values stay in the existing short-lived in-memory cache |
| One active job per business | Partial unique index (`WHERE status IN ('QUEUED','RUNNING')`). Starting again with unchanged documents returns the same job; concurrent starts are resolved by the index (the loser joins the winner) |
| Reuse | Cache key = owner + document id + pipeline version (a document row is immutable per revision). If every current document is cached the new job is `SUCCEEDED` immediately and nothing is re-read. Cache: 30 min, 48 entries, in memory; degraded results only 2 min so a retry re-runs the full pipeline |
| Changed documents | Starting after a document changed **supersedes** (cancels, `errorCode: SUPERSEDED`) the running job. A `SUCCEEDED` job whose fingerprint no longer matches reports `STALE` and carries no review |
| Capacity | At most `EVIDENCE_REVIEW_CONCURRENCY` (default 2) jobs run at once and `EVIDENCE_REVIEW_QUEUE_MAX` (default 20) are queued+running system-wide; beyond that `503 QUEUE_FULL`. At most 6 documents per job. The worker client also bounds concurrent processes/containers |
| Ownership | Jobs are looked up by `(id, owner's business)`; another tenant gets the same `404` as for a missing id, for status and cancel |
| Cancellation | Aborts the in-flight extraction: the container is `docker rm -f`'d / the child process killed, the job becomes `CANCELLED` and can never flip back |
| Restarts and crashes | On boot, `RUNNING` jobs become `FAILED / SERVER_RESTARTED` and `QUEUED` jobs are resumed. A `RUNNING` row nobody in this process is working on, or whose heartbeat is older than `EVIDENCE_REVIEW_STALE_MS` (default 6 min), is failed (`JOB_INTERRUPTED` / `JOB_TIMEOUT`) on the next poll, so the UI never polls forever |
| Retention | Finished job rows are pruned after 24 h |
| What jobs never touch | Consent, Passport snapshots, business/trust fields, audit rows, notifications (tested by snapshotting those tables before and after a job) |

Limits of this design (deliberate, small): the queue is a database table polled by one in-process pump, so it is correct for a
single API instance; running several instances needs a claim lease per job. The extraction cache is per process, so after a
restart or on another instance results are `EXPIRED` and the owner re-runs the review.

## 2. Dependency decisions

| Concern | Decision | Why | Not chosen |
|---|---|---|---|
| PDF parsing, text + boxes, rendering | **PyMuPDF** (AGPL-3.0 / commercial) | Fast, robust on malformed files, gives word boxes, rotation, images, xref access for the active-content scan | pdfplumber/pdfminer (slower, no rendering; evaluated as a comparator only, not shipped) |
| OCR | **RapidOCR (onnxruntime)**, models bundled in the wheel | Runs fully offline, no binary install, works on Windows/Linux, no runtime download | **Tesseract / OCRmyPDF**: not installable in the reference environment (the user-scope installer failed and a machine-wide install is an infrastructure change that was deliberately not made), so it is **not implemented and not tested**. The OCR call sits behind `ocr.py`; Tesseract could be added behind the same function |
| Layout models (LayoutLM etc.) | none | Heavy, GPU-oriented, unverifiable here; geometry + labels + validators are enough for three known document families | |
| External/paid OCR or LLM APIs | none | Sensitive MSME documents must not leave the server | |
| Original TS parser | kept | Dependency-free fallback and the benchmark baseline | |

**Licence note (verified against the projects' own documentation, not from memory):**
* PyMuPDF — the project's documentation states it is "available under both, open-source AGPL and commercial license
  agreements" (Artifex). Whether the AGPL obligations apply to a hosted Pramaan, and whether to buy a commercial licence,
  is a **legal/business decision for the product owner; it is not made or implied here**. Running PyMuPDF in a separate
  process does not by itself settle that question.
* pypdfium2 — its README states it "is available by the terms and conditions of Apache-2.0 / BSD-3-Clause" (its docs are
  CC-BY-4.0). The PDFium library it bundles is BSD-style, and PDFium's licence plus its dependencies' licences must be
  distributed with binaries; the exact set depends on the build, so a release process must collect them. pypdf is BSD-3-Clause.
* RapidOCR is Apache-2.0; its bundled PP-OCR models are Apache-2.0.

## 2a. PDF backend: PyMuPDF (default) vs pypdfium2 (experimental) — gate results

`python/evidence_worker/backends.py` puts the PDF library behind a small interface (words with boxes in displayed-page
coordinates, text direction, image regions, rendering, encryption and active-content checks). `EVIDENCE_PDF_BACKEND=pdfium`
selects an alternative built on pypdfium2 (text, geometry, rendering) + pypdf (object walk for active content, because PDFium
exposes no object access). **It is never selected automatically, is not in the production image, and stays experimental.**
Install: `pip install -r python/requirements-experimental-pdfium.txt`.

The same 124-file synthetic corpus (111 scored documents + 13 adversarial) was run through both backends, in local mode, with
the same worker and domain code (`scripts/evidence-benchmark.mts`; `python -m evidence_eval.compare_coordinates|compare_adversarial <corpus>`):

| Gate | Result | Evidence |
|---|---|---|
| No regression in exact identifier accuracy | **Equal** (98.9% on both; identical per-group figures) | benchmark |
| No regression in bank-table extraction | **Met**: row recall 69.7% → 70.8%, precision of balance-checked rows 100% on both | benchmark |
| All adversarial files safe | **Met**: 13/13 safe on both; reasons differ for two files (flate bomb: pdfium path refuses it as `ACTIVE_CONTENT/UNPARSEABLE_STRUCTURE` because pypdf cannot parse it — stricter; truncated file: `NOT_A_PDF` instead of `NO_PAGES`) | `compare_adversarial` |
| Correct rotated-page coordinates | **Met**: on 45 text and `/Rotate` 90/180/270 cases, page size is identical and every line's centre and x-extent agree within 0.6 pt, with identical line text (except where words abut with ~0 gap, and 180° pages where whitespace joining differs). PDFium's tight glyph boxes had to be replaced by its *loose* (ascent–descent) boxes, otherwise the layout code's spacing thresholds inserted spurious double spaces. Side finding: PyMuPDF reports the page rectangle *after* `/Rotate` but extracts text in the *unrotated* frame, so the old code used swapped page dimensions on quarter-turn pages; the adapter now corrects that (benchmark unchanged) | `compare_coordinates` |
| Equivalent rejection of active/malicious features | **Met on the corpus** (JavaScript+OpenAction, Launch, EmbeddedFile, encrypted all rejected identically). Only synthetic samples were tested; the detector is a different implementation (pypdf walks every object including object streams; unparseable structure is rejected) and has not been compared on real-world malicious PDFs | `compare_adversarial` |
| **No new wrong confident values / false conflicts** | **NOT met**: field precision 100.0% → 99.7% and false conflicts 0/233 → 1/235. On the 100 dpi bank scan (case 105) the different rasterisation led OCR to read "Tulsi Textiles LLP" as "Tuisi Textiles LLP" without a review flag, which surfaces as a conflict with the declared name. (It also *recovered* three fields PyMuPDF missed, so the two backends fail on different pages) | benchmark, case 105 |

**Decision: do not switch.** One gate fails, so PyMuPDF remains the default and the only backend that ships. The failure is a
single case on a synthetic low-resolution scan, but it is precisely the failure class the pipeline must never exhibit (a
confident wrong value), and pypdfium2's render path differs from PyMuPDF's in ways that would need re-tuning and a wider
corpus to trust. pypdfium2 rendering was ~3× slower per page in an isolated test but end-to-end medians were similar (OCR dominates).
Remaining work to make the switch viable: fix the confidence on that reading (OCR digit/letter confusion on low-res names),
re-run on real documents, security-review the pypdf-based active-content scan, and collect PDFium's licence notices.

**Licensing outcome.** PyMuPDF: AGPL-3.0 *or* a commercial licence from Artifex (per its documentation) — the shipping default
therefore carries an unresolved legal/commercial decision for the product owner. pypdfium2: Apache-2.0 / BSD-3-Clause with
PDFium BSD-style (notices to ship); pypdf BSD-3-Clause. The permissive alternative exists and works on most of the corpus, but
is not yet good enough to replace PyMuPDF. **Options for the owner:** (1) buy the PyMuPDF commercial licence, (2) obtain legal
advice that the AGPL is acceptable for the deployment model, or (3) finish the pdfium backend (days, not hours, plus real
documents). Until then the product should not be described as free of AGPL obligations.

## 3. What the pipeline does

1. **Validate** (worker): reject encrypted files (`UNSUPPORTED/ENCRYPTED`), more than 20 000 PDF objects, and any
   JavaScript, Launch, EmbeddedFile, RichMedia, SubmitForm or ImportData (`REJECTED/ACTIVE_CONTENT`). Node first
   enforces ≤5 MB and magic bytes.
2. **Per page**: embedded words with boxes; rotated text and `/Rotate` pages are normalised to upright.
3. **Is the text layer usable?** alphanumeric count, word count, garbled-character ratio and an English letter-frequency
   likeness test. Fonts without a Unicode mapping often produce plausible-looking noise; the likeness test catches it
   and the page is OCR'd instead.
4. **Selective OCR**: only unusable pages are rendered (pixel cap, scale floor, page-size cap) and OCR'd. Large image
   regions on otherwise-text pages are OCR'd and merged (`MIXED`). Orientation recovery handles 90/180/270 scans, and
   reuses the first page's rotation for later pages. Caps: 12 OCR pages, 40 pages, 100 s budget (stops before a page
   that would probably overrun).
5. **Reading order and structure**: lines, gap-separated segments, simple two-column detection that does not split aligned
   key/value forms.
6. **Key-value association by geometry**: the value is the same cell, the cell to the right, or the cell below the label;
   alternatives from one label occurrence never make a field ambiguous, but values from *different* occurrences do.
7. **Validation**: GSTIN (structure + check character), PAN, Udyam (`UDYAM-XX-00-0000000`), IFSC, account-number length.
   OCR-classic confusions (O/0, I/1, S/5, B/8…) are repaired only inside slots the format fixes, and a repaired GSTIN is
   accepted only if its check character then validates. A repaired value is flagged.
8. **Bank tables**: header roles (date, value date, narration, reference, debit/credit/amount, balance) → rows start at a
   date; wrapped narrations are joined; `Dr/Cr` suffixes handled; opening balance; header repeated or only on page 1;
   run-together fixed-width cells are split. **Every row is checked against the running balance**; the table is
   `reliable` only if ≥3 rows were checked and ≥80% are consistent.
9. **Provenance kept** for each value: page, line, bounding box, method (`EMBEDDED_TEXT` / `OCR` / `MIXED`),
   confidence, review reasons.

### Confidence and owner review

Confidence is built from extraction quality (embedded 0.92; OCR uses the engine's segment confidence, capped) and
validation evidence (checksum passes, label found, cross-field agreement such as GSTIN-embedded PAN). A value is marked
`needsReview` when any of these holds: read by OCR and it is an identifier (always), OCR confidence low, a repaired
character, no label found, more than one different candidate, failed format or checksum, inconsistent with the GSTIN.

An uncertain reading:

* is **never** a conflict — a differing OCR reading yields `UNREADABLE` + `needsOwnerReview` with the owner asked to
  check the document;
* is **never** a correction proposal and never auto-corrects a claim;
* equal to the declaration is still a `MATCH` (agreement, not correction);
* never "fills in" a missing value to satisfy a trust requirement: missing stays `NOT_FOUND`.

Name comparison ignores case, punctuation, whitespace (OCR often fuses words) and company-suffix spelling, for
**comparison only**; the stored claim is untouched.

## 4. Security boundary — what is enforced and what is not

The worker handles untrusted files, so it is a separate process with a bounded contract. Be exact about what holds:

| Control | Status |
|---|---|
| No shell: `spawn(python, argv[], {shell:false})` | **Enforced** (code) |
| Private temp dir per request (mode 0600 file), TEMP/TMP pointed at it, removed in `finally` on every path | **Enforced** (code; tested: no `pramaan-extract-*` dirs left) |
| Minimal environment (no secrets, no `DATABASE_URL`, no JWT secrets passed to the child) | **Enforced** (whitelist) |
| Node-side wall-clock kill (120 s), stdout cap (24 MB), concurrency 2 + queue 8 (→ HTTP 503) | **Enforced** |
| Output validated by a strict zod schema before use; field lengths and counts bounded | **Enforced** |
| Size ≤5 MB, magic bytes, ≤40 pages, ≤12 OCR pages, ≤12 MP rendered pixels, ≤60 MP images, ≤20 000 PDF objects, page ≤6000 pt | **Enforced** (tested with the adversarial corpus) |
| Decompression bombs | **Bounded** (the 60 MB Flate bomb is returned unreadable in ~6 s without exhausting memory); not "detected by ratio" |
| No JS / launch / attachments / forms executed or followed | **Enforced**: such files are rejected; PyMuPDF does not execute them |
| Hard memory cap | **Container: enforced by the cgroup limit (1800 MB, no swap) and tested** (a 2.6 GB allocation is OOM-killed). **Windows local mode: verified** Job Object `ProcessMemoryLimit` plus "no child processes". POSIX local mode: `RLIMIT_AS` is a deliberately generous backstop (≥ 8 GB, because OpenCV/ONNX reserve address space per thread) and `RLIMIT_CPU` is 4× the time budget (CPU seconds add up across threads); neither is the primary bound |
| Cooperative working-set check between pages | **Enforced** (all platforms) |
| No network from the worker | **Container mode: enforced and tested** (`--network none`; only `lo` exists; TCP and DNS fail; a negative control proves the probe can detect a network). **Local mode: not enforced at OS level** — sockets are only disabled inside the Python process (defence in depth, native code could bypass it) |
| Syscall filtering, read-only filesystem, unprivileged user, dropped capabilities | **Container mode: enforced and tested** (default Docker seccomp profile active, root fs read-only, uid 10001, `CapEff/CapBnd = 0`, `NoNewPrivs = 1`) — see §4a. **Local mode: none of these.** |
| CPU time limit on Windows | **Not enforced** except by the Node kill and the 100 s cooperative budget |
| Sandboxed PyMuPDF/ONNX native code | **Contained, not eliminated.** In container mode a memory-corruption bug in a native dependency runs as an unprivileged user in a network-less, read-only container with no secrets; escaping that needs a kernel or container-runtime vulnerability, which this design does not defend against (no gVisor/Kata/rootless Docker was evaluated). In local mode the native code runs with the API's privileges |
| No raw document text or values in logs | **Enforced**: the worker prints one JSON object to stdout only; stderr is ignored by the parent; MuPDF error display is disabled; the service logs nothing extracted. API tests scan server logs, audit rows and notifications for PAN/account/GSTIN |
| Owner-only values; cross-tenant isolation | **Enforced** by the existing owner-scoped route (`MSME` role, own business only); a document id of another owner cannot drive a correction (tested) |
| Account numbers | **Masked at extraction** (last four digits). The worker's JSON (which contains the page text) exists in Node memory only for the duration of one extraction; the structured result that is returned, cached or serialised holds only the masked value and no page text, so the full number cannot reach an API response, log, audit row, notification or the cache. Long digit runs in transaction narrations are masked too |
| PAN | Masked in every API response (existing rule); the raw value only exists in memory to compare with the declaration |
| Requester access | **Unchanged.** Nothing here touches consent, Passport snapshots, requester views or trust scoring (non-regression tests pass) |
| Result cache | **In-memory only**, 30 min, 48 entries (degraded results 2 min), keyed by owner+document id+pipeline version; structured values only, no page text; per-process (not shared between instances; lost on restart). Trade-off: owner-only values sit in process memory for ≤30 min |
| Rate limit | Per-owner limiter on starting a review (30 / 10 min) and a separate generous one on status polls (900 / 10 min); **in-memory, single-instance** |

## 4a. Container isolation of the worker

Production default (`NODE_ENV=production` → `EVIDENCE_WORKER_MODE=container`). Every extraction is one **one-shot container**
(`docker run --rm -i`): the file goes in on **stdin**, the JSON result comes back on **stdout**, nothing else crosses the boundary
(no bind mounts, no volumes, no environment variables, logging driver `none`). The container is removed on completion, on
timeout and on cancellation (`docker rm -f <name>`).

`src/modules/evidenceIntelligence/worker-container.ts` builds the argument vector (no shell, no string interpolation):

| Flag | Purpose |
|---|---|
| `--network none` | no network |
| `--read-only` + `--tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m` | immutable root; scratch is RAM-backed, size-capped, non-executable and vanishes with the container |
| `--user 10001:10001` | non-root, no home, no login shell |
| `--cap-drop ALL`, `--security-opt no-new-privileges` | no capabilities, no setuid escalation |
| default seccomp profile (not disabled) | syscall filtering |
| `--pids-limit 64` | fork bombs |
| `--memory 1800m --memory-swap 1800m`, `--cpus 4` (`EVIDENCE_WORKER_CPUS`) | memory and CPU ceilings (OCR with 2 CPUs took ~2.3× longer) |
| `--ulimit nofile / nproc / core=0` | descriptor/process limits, no core dumps |
| never `--privileged`, never the Docker socket, no `-e`, no `-v` | no ambient authority |

The image (`docker/evidence-worker/Dockerfile`, `npm run worker:image`, ~800 MB) is `python:3.12-slim-bookworm` + the pinned
`python/requirements.txt` with the headless OpenCV build, running as uid 10001. The worker reads the upload from stdin into
its own private temp directory (inside the tmpfs) and removes it in `finally`.

**What was actually tested** (`npm run test:worker-isolation`, 11 tests, run against the real image with *exactly* the flags
the runtime uses; the script exits 2 — never "passes" — if Docker or the image is missing):
uid/gid 10001 · only the loopback interface, outbound TCP and DNS fail (with a negative control: a default-network container
*can* connect, so the probe is able to fail) · root and `/app` read-only, `/tmp` writable but a binary copied there cannot be
executed · `CapEff = CapBnd = 0`, `NoNewPrivs = 1`, `Seccomp = 2` · fake `JWT_SECRET`/`DATABASE_URL`/`UPLOAD_DIR` set in the
`docker` CLI's environment do not appear inside · no `/var/run/docker.sock`, no host mounts · a fork bomb stops below 100
processes · a 2.6 GB allocation is killed by the memory limit · the real worker reads a synthetic GST PDF through stdin/stdout ·
an aborted extraction leaves no container running or stopped · a missing image fails closed (`WORKER_UNAVAILABLE`, no
in-process fallback). The whole hybrid suite (`EVIDENCE_WORKER_MODE=container npx tsx scripts/evidence-hybrid-tests.ts`) also passes in
container mode, including OCR of scans and the adversarial files.

**What was NOT tested or is not claimed:** it was run on **Docker Desktop (Windows, WSL2 VM)** only — not on a Linux host, in
Kubernetes, with rootless Docker, gVisor or Kata; the seccomp profile is Docker's default, not a custom allow-list; the
Docker daemon is trusted and its socket is a powerful credential that the API process (which runs `docker run`) must hold —
in production the API should talk to a locked-down daemon or a small job-runner service instead of a shared host daemon;
image provenance/scanning and a read-only image registry are deployment work; `--pids-limit` must stay above the OCR thread
count (threads are capped at 2 via `EVIDENCE_OCR_THREADS`, otherwise OpenCV fails with "Can't spawn new thread"); container
start-up adds roughly 1 s per document. **Local mode** (`EVIDENCE_WORKER_MODE=local`, default outside production) is a bounded child
process **without** any of the above and is labelled `LOCAL_PROCESS` in every job and result — suitable for development only.

Prior art consulted rather than invented: the OWASP *Docker Security Cheat Sheet* (non-root user, `--cap-drop all`,
`no-new-privileges`, `--read-only` with `--tmpfs`, memory/CPU/pids/ulimit limits, never `--privileged`, never mount the Docker
socket, keep the default seccomp profile) and the Dangerzone project's pattern of converting untrusted documents inside a
locked-down container so that only the processed output leaves it.

## 5. Setup and deployment

### Requirements
* Node 24 (the version used for all tests here); **Python 3.12** (3.10+ expected to work, only 3.12.10 was tested)
* Python packages: `pip install -r python/requirements.txt` (PyMuPDF, rapidocr-onnxruntime, numpy, pillow).
  **`pip install -r python/requirements-eval.txt` is additionally required to run `npm run test:evidence-hybrid` and the
  benchmark in local mode**: it adds `reportlab`, which the synthetic corpus generator imports (the hybrid tests print
  `SKIPPED (not passed)` and exit 2 without it). In container mode only Docker and the built image are needed on the test
  machine for the worker, but the corpus generator still runs on the host and needs `requirements-eval.txt`.
* Docker (for container mode): `npm run worker:image` builds `pramaan-evidence-worker:local`.
* System packages: none for the pipeline itself on Windows/macOS. On slim Linux images ONNX Runtime and OpenCV need
  `libgl1`/`libglib2.0-0` (OpenCV is pulled in by RapidOCR; `opencv-python-headless` avoids the GL dependency).
* Disk: ~350 MB for the Python environment (ONNX Runtime, OpenCV, models). RAM: plan **~700 MB per concurrent OCR page**
  (measured peak 520–680 MB for scans, ~90 MB for text PDFs); with the default concurrency of 2, reserve ~1.5 GB.

### Environment variables
| Variable | Default | Meaning |
|---|---|---|
| `EVIDENCE_WORKER_PYTHON` | `python` (Windows) / `python3` | Interpreter of the virtualenv that has the dependencies |
| `EVIDENCE_WORKER_DIR` | `<cwd>/python` | Directory containing the `evidence_worker` package (local mode) |
| `EVIDENCE_WORKER_MODE` | `container` if `NODE_ENV=production`, else `local` | `container` = isolated one-shot container, never falls back to in-process parsing; `local` = child process (less isolated) |
| `EVIDENCE_WORKER_IMAGE` | `pramaan-evidence-worker:local` | Image to run in container mode |
| `EVIDENCE_WORKER_DOCKER` | `docker` | Docker CLI executable |
| `EVIDENCE_WORKER_CPUS` | `4` | CPU ceiling per container |
| `EVIDENCE_OCR_THREADS` | `2` | OpenCV / ONNX Runtime threads inside the worker |
| `EVIDENCE_REVIEW_CONCURRENCY` | `2` | Review jobs running at once |
| `EVIDENCE_REVIEW_QUEUE_MAX` | `20` | Queued + running jobs system-wide before `503 QUEUE_FULL` |
| `EVIDENCE_REVIEW_STALE_MS` | `360000` | A running job with no heartbeat for this long is failed |
| `EVIDENCE_PDF_BACKEND` | `pymupdf` | `pdfium` selects the **experimental** pypdfium2 backend (§2a); ignored values fall back to `pymupdf` |

Limits are constants in `worker-client.ts` (`WORKER_DEFAULTS`) and passed as flags to the worker.

### Deploying the API next to the container worker
The API process needs the Docker CLI and access to a daemon, and the image. Illustrative (not built as a whole here; the
worker image and its runtime flags *were* built and tested, §4a):
```
npm run worker:image                       # docker build -t pramaan-evidence-worker:local -f docker/evidence-worker/Dockerfile python
NODE_ENV=production EVIDENCE_WORKER_MODE=container npm start
```
Giving the API container a Docker socket hands it root on the host; prefer a small dedicated runner (or a managed job
service) that only accepts "run this image with these fixed flags on these bytes". That runner is **not implemented**.

### Verifying an installation
```
npm run test:evidence-hybrid       # builds a synthetic corpus, runs the real worker; exits 2 (not "pass") if the worker/deps are missing
EVIDENCE_WORKER_MODE=container npm run test:evidence-hybrid    # same, through the isolated container
npm run test:worker-isolation      # probes the container's isolation; exits 2 if Docker or the image is missing
npm run test:evidence-jobs         # job API: progress, dedupe, reuse, ownership, stale/expired, capacity, cancel, failures, restart
npm run benchmark:evidence -- <corpus dir>
python -m evidence_eval.generate_demo_pack --out <dir>   # one consistent fictional business (text GST + scanned Udyam + scanned 2-page statement)
```

## 6. Evaluation

### Corpus (synthetic, privacy-safe)
`python -m evidence_eval.generate_corpus --out <dir> --quick` (from `python/`) creates fictional entities (valid GSTIN check
characters; PAN/Udyam/IFSC shapes; no real people or businesses) in: GST certificates (4 layouts: numbered, stacked,
two-column, inline), Udyam certificates (3 layouts), bank statements (3 layouts: debit/credit columns, withdrawals/deposits,
amount with Dr/Cr suffix; 1–3 pages, Indian digit grouping, wrapped narrations, running balances), 7 fonts (Helvetica,
Times, Courier, Arial, Calibri, Verdana, Consolas), and variants: embedded text; uncompressed/standard-font re-save (the
only form the original parser can read); scans at 300/150/100 dpi with skew, noise and JPEG compression; PDF page
rotation 90/180/270; pixel-rotated scans 90/180; fonts with the Unicode map removed; image-region-on-text-page; bank
statements whose first page is text and the rest scanned. Plus 13 adversarial files (60 MB Flate bomb, JavaScript
OpenAction, Launch action, embedded executable, AES-256 encrypted, 14 000 pt page, truncated, random bytes, polyglot,
6 MB padded file, 150 pages, 18 000 px image, wrong document).

**Limitation:** layouts were modelled from general knowledge of Indian GST/Udyam/bank documents, not copied from real
ones, and no redacted public examples were available in this environment. Real documents will differ (stamps, logos
behind text, hand-written fields, bilingual text, bank-specific formats). The benchmark therefore shows that the pipeline
works on a *varied* corpus and compares it fairly with the original parser; it does not show real-world accuracy.

### Results
All numbers: 124-file synthetic corpus, seed 7, `--quick` (111 scored documents + 13 adversarial), measured on one
Windows 11 laptop (Python 3.12.10, PyMuPDF 1.26.3, RapidOCR 1.4.4 on CPU). Timings include spawning the worker and loading
the OCR models on every request (about 1 s). "Precision" counts a field as wrong only if a value was returned and differs
from the truth; "abstained" means no value was returned. Reproduce with `npm run benchmark:evidence -- <corpus>`.

#### Upgraded pipeline

| Input type | Cases | Field recall | Field precision | Identifier exact | Abstained | Marked "check this" | Bank-row recall | Bank-row precision | Balance-checked-row precision | False conflicts | Median ms | p95 ms | Peak MB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| broken font encoding | 7 | 100.0% | 100.0% | 100.0% | 0.0% | 88.9% | n/a | n/a | n/a | 0/18 | 4990 | 8129 | 514 |
| embedded text | 10 | 100.0% | 100.0% | 100.0% | 0.0% | 6.1% | 100.0% | 100.0% | 100.0% | 0/21 | 1070 | 1222 | 87 |
| embedded text, plain streams + standard fonts (the original parser's best case) | 5 | 100.0% | 100.0% | 100.0% | 0.0% | 5.6% | 100.0% | 100.0% | 100.0% | 0/10 | 1082 | 1183 | 87 |
| low-res scan (100 dpi) | 10 | 78.8% | 100.0% | 88.2% | 21.2% | 57.7% | 4.3% | 16.7% | 100.0% | 0/17 | 5622 | 30041 | 652 |
| mixed (image on text page) | 7 | 100.0% | 100.0% | 100.0% | 0.0% | 77.8% | n/a | n/a | n/a | 0/18 | 4956 | 7452 | 519 |
| mixed (text then scanned pages) | 2 | 100.0% | 100.0% | 100.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% | 0/2 | 21775 | 21775 | 656 |
| rotated PDF page | 30 | 100.0% | 100.0% | 100.0% | 0.0% | 6.1% | 100.0% | 100.0% | 100.0% | 0/63 | 1046 | 1190 | 87 |
| rotated scan | 20 | 100.0% | 100.0% | 100.0% | 0.0% | 60.6% | 48.8% | 98.1% | 100.0% | 0/42 | 13023 | 48472 | 671 |
| scan (150 dpi) | 10 | 100.0% | 100.0% | 100.0% | 0.0% | 60.6% | 31.9% | 65.0% | 100.0% | 0/21 | 5956 | 31015 | 655 |
| scan (300 dpi) | 10 | 100.0% | 100.0% | 100.0% | 0.0% | 60.6% | 48.5% | 97.5% | 100.0% | 0/21 | 6070 | 32464 | 675 |
| **All** | 111 | 98.1% | 100.0% | 98.9% | 1.9% | 37.9% | 69.7% | 94.6% | 100.0% | 0/233 | 4956 | 30041 | 675 |

#### Original dependency-free parser, same files

| Input type | Cases | Field recall | Field precision | Identifier exact | Abstained | Marked "check this" | Bank-row recall | Bank-row precision | Balance-checked-row precision | False conflicts | Median ms | p95 ms | Peak MB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| broken font encoding | 7 | 0.0% | n/a | 0.0% | 100.0% | n/a | n/a | n/a | n/a | 0/0 | 1 | 3 | - |
| embedded text | 10 | 0.0% | n/a | 0.0% | 100.0% | n/a | 0.0% | n/a | n/a | 0/0 | 0 | 2 | - |
| embedded text, plain streams + standard fonts (the original parser's best case) | 5 | 33.3% | 66.7% | 55.6% | 50.0% | 0.0% | 0.0% | n/a | n/a | 3/7 | 3 | 7 | - |
| low-res scan (100 dpi) | 10 | 0.0% | n/a | 0.0% | 100.0% | n/a | 0.0% | n/a | n/a | 0/0 | 0 | 1 | - |
| mixed (image on text page) | 7 | 0.0% | n/a | 0.0% | 100.0% | n/a | n/a | n/a | n/a | 0/0 | 2 | 4 | - |
| mixed (text then scanned pages) | 2 | 0.0% | n/a | 0.0% | 100.0% | n/a | 0.0% | n/a | n/a | 0/0 | 1 | 1 | - |
| rotated PDF page | 30 | 0.0% | n/a | 0.0% | 100.0% | n/a | 0.0% | n/a | n/a | 0/0 | 0 | 0 | - |
| rotated scan | 20 | 0.0% | n/a | 0.0% | 100.0% | n/a | 0.0% | n/a | n/a | 0/0 | 0 | 1 | - |
| scan (150 dpi) | 10 | 0.0% | n/a | 0.0% | 100.0% | n/a | 0.0% | n/a | n/a | 0/0 | 0 | 1 | - |
| scan (300 dpi) | 10 | 0.0% | n/a | 0.0% | 100.0% | n/a | 0.0% | n/a | n/a | 0/0 | 1 | 2 | - |
| **All** | 111 | 1.7% | 66.7% | 2.7% | 97.5% | 0.0% | 0.0% | n/a | n/a | 3/7 | 0 | 3 | - |

**Reading the comparison fairly.** The corpus PDFs are written by ReportLab/PyMuPDF with compressed streams and, for TrueType
fonts, Identity-H encodings; the original parser reads only uncompressed/Flate streams with simple fonts, so it returns
nothing on most of them (that is a limit of the original design, not a defect in the test). To avoid overstating the
upgrade, the same documents were also re-saved in the one form the original parser *can* read (row "plain streams +
standard fonts"): there the original parser gets field recall 33.3% with precision 66.7% and made
3/7 false conflicts, while the upgraded pipeline gets 100.0% / 100.0% with 0/10.

#### Headline numbers (upgraded pipeline, all 111 scored documents)
* Field recall 98.1%, **field precision 100.0%** (no confidently wrong value in the corpus), exact identifier accuracy 98.9%.
* Abstention (no value returned): 1.9% of expected fields — all on 100-dpi scans (see misses below). Values marked "check this value": 37.9% of returned values (every OCR-read identifier by design, plus any low-confidence or repaired reading).
* **False conflict rate: 0/233** claims reconciled against a declaration equal to the truth (the original parser on its friendly subset: 3/7).
* Bank transactions: row recall 69.7%, row precision 94.6%; **every row that passed the running-balance check was correct (100.0%)**; rows that fail the check are labelled and the table is called unreliable if <80% of checked rows agree. 12 rows on mixed statements were recovered without a date (OCR dropped the date cell) because they continued the running balance exactly; nothing was inferred for them.
* Character error rate against the known page text (order-independent): embedded text 0/56238 = 0.0%; OCR/mixed pages 1257/62661 = 2.01%.
* Latency (this machine, includes ~1 s start-up): embedded text median ≈ 1.1 s (p95 1.2 s, peak ≈ 87 MB); scanned/rotated/mixed median ≈ 5–13 s, p95 ≈ 30–48 s (3-page dense scans), peak ≈ 520–680 MB. Worst case observed: 48 s, one 82-row three-page statement scanned sideways, which hit the time budget and returned PARTIAL.
* Adversarial files: 13/13 refused, bounded or handled safely (original parser 13/13). The upgraded pipeline additionally rejects JavaScript/Launch/EmbeddedFile files explicitly, where the original parser merely failed to decode them.

#### Adversarial detail

| File | Expected | Upgraded pipeline | Original parser |
|---|---|---|---|
| adv-flate-bomb | no extraction | UNREADABLE/NO_EXTRACTABLE_TEXT (7723 ms) ✔ | REJECTED/DECOMPRESSION_LIMIT ✔ |
| adv-javascript-openaction | no extraction | REJECTED/ACTIVE_CONTENT (1030 ms) ✔ | UNREADABLE/UNSUPPORTED_FILTER ✔ |
| adv-launch-action | no extraction | REJECTED/ACTIVE_CONTENT (1059 ms) ✔ | UNREADABLE/UNSUPPORTED_FILTER ✔ |
| adv-embedded-file | no extraction | REJECTED/ACTIVE_CONTENT (1146 ms) ✔ | UNREADABLE/UNSUPPORTED_FILTER ✔ |
| adv-encrypted | no extraction | UNSUPPORTED/ENCRYPTED (1235 ms) ✔ | UNSUPPORTED/ENCRYPTED ✔ |
| adv-huge-page | no extraction | UNREADABLE/PAGE_TOO_LARGE (1253 ms) ✔ | NOT_RECOGNISED/NOT_RECOGNISED ✔ |
| adv-truncated | no extraction | UNREADABLE/NO_PAGES (1189 ms) ✔ | UNREADABLE/CORRUPT_STREAM ✔ |
| adv-garbage | no extraction | UNSUPPORTED/NOT_A_PDF (1210 ms) ✔ | UNSUPPORTED/NOT_A_PDF ✔ |
| adv-polyglot | any | EXTRACTED (1223 ms) ✔ | UNREADABLE/UNSUPPORTED_FILTER ✔ |
| adv-oversize | no extraction | REJECTED/TOO_LARGE (0 ms) ✔ | REJECTED/TOO_LARGE ✔ |
| adv-many-pages | partial or none | PARTIAL/PAGE_LIMIT (43341 ms) ✔ | NOT_RECOGNISED/NOT_RECOGNISED ✔ |
| adv-huge-pixel-image | no extraction | UNREADABLE/NO_EXTRACTABLE_TEXT (7309 ms) ✔ | UNREADABLE/NO_EXTRACTABLE_TEXT ✔ |
| adv-wrong-document | no extraction | NOT_RECOGNISED/NOT_RECOGNISED (1149 ms) ✔ | NOT_RECOGNISED/NOT_RECOGNISED ✔ |

#### Misses, abstentions and slow cases (every one of them is a safe abstention, never a wrong value)

* 009 scan100 pan: expected=ENWCB1815U got=NOT_FOUND review=false 
* 020 scan100 legalName: expected=Tulsi Plastics Enterprises got=NOT_FOUND review=false 
* 031 scan100 legalName: expected=Prakash Agro Products & Sons got=NOT_FOUND review=false 
* 075 scan100 enterpriseName: expected=Moonrise Agro Products LLP got=NOT_FOUND review=false 
* 080 scan150 table not reliable rows=25/26
* 086 scan100 accountNumber: expected=â€¦3537 got=NOT_FOUND review=false 
* 086 scan100 statementPeriod: expected=2026-04-01/2026-04-16 got=NOT_FOUND review=false 
* 086 scan100 table not reliable rows=5/26
* 088 scan300 NO TABLE (truth 82) status=EXTRACTED
* 089 scan150 NO TABLE (truth 82) status=EXTRACTED
* 093 scan_pixels_rotated_90 NO TABLE (truth 82) status=PARTIAL
* 093 scan_pixels_rotated_90 SLOW 48472ms status=PARTIAL reason=TIME_LIMIT
* 094 scan_pixels_rotated_180 NO TABLE (truth 82) status=EXTRACTED
* 094 scan_pixels_rotated_180 SLOW 44413ms status=EXTRACTED reason=null
* 095 scan100 statementPeriod: expected=2026-04-01/2026-06-28 got=NOT_FOUND review=false 
* 095 scan100 NO TABLE (truth 82) status=EXTRACTED
* 103 scan_pixels_rotated_90 SLOW 40244ms status=EXTRACTED reason=null
* 105 scan100 table not reliable rows=37/55

Why: (a) 100-dpi, skewed, JPEG-compressed scans are at the edge of what the OCR can read — names and the period line are
sometimes not recognised and the pipeline abstains (precision stays 100%); (b) dense 82-row statements in a
fixed-width Courier layout, scanned (three at 82 rows plus the 100-dpi variant), produced no reliable table because OCR splits the monospaced columns differently
from the vector text (the same layout as vector text is reconstructed 82/82); (c) the sideways 3-page scan hit the time
budget and was returned as PARTIAL rather than being allowed to run on.


## 7. Known limitations

1. **No real documents.** Everything above is synthetic. Real GST/Udyam certificates and bank statements have stamps,
   QR codes, watermarks, logos behind text, handwriting, bilingual (Hindi/regional) text and bank-specific layouts that this
   corpus does not contain. Accuracy on them is unknown; do not quote the figures above as real-world accuracy.
2. **OCR is English/Latin-script only.** The bundled models do not read Devanagari or other Indian scripts; such text is
   ignored or misread, and fields depending on it abstain.
3. **OCR is slow and memory-hungry on CPU:** 5–30 s per scanned page, 0.5–0.7 GB resident. Dense multi-page scans can hit the
   100 s budget (PARTIAL result). The worker queue (2 + 8) protects the server but a burst can see HTTP 503 `EXTRACTION_BUSY`.
   Reviews now run as background jobs (§1a), so the browser no longer times out; the job queue is single-instance (see §1a).
4. **Isolation is real only in container mode** (§4a, tested on Docker Desktop/WSL2 only). Local mode is a bounded child
   process with in-process network blocking and (Windows) Job Object limits — development use. A Linux host, rootless
   Docker/gVisor, a locked-down runner instead of a shared Docker socket, and image supply-chain controls are not done.
5. **Tesseract/OCRmyPDF not implemented**; RapidOCR is the single OCR engine. pdfplumber was evaluated as a comparator only.
   No layout-model (LayoutLM-style) path was built; table reconstruction is rule-based and covers only bank-statement
   transaction tables with recognisable headers. GST/Udyam tables beyond key-value pairs are not extracted.
6. **Dense fixed-width scanned statements** can fail to yield a reliable table (four 82-row Courier scans in this corpus); the pipeline then reports
   that the table could not be confirmed rather than guessing.
7. **PAN is read only from GST certificates**; the Udyam certificate's printed PAN is not extracted.
8. **Name reconciliation is deliberately conservative**: fused-word OCR output matches, but abbreviations ("Pvt." vs
   "Private") beyond the listed suffix forms, transliteration and re-ordered words are *not* matched and surface as
   "check this value" (scans) or a conflict (embedded text).
9. **Encrypted PDFs are refused**, not unlocked. Password-protected statements (common with banks) need the owner to upload
   an unprotected copy.
10. **Result cache, job pump and rate limiters are per-process.** Multiple API instances need a shared cache/lease; after a
    restart, finished jobs report `EXPIRED` and the owner re-runs the review (corrections require a fresh review).
11. **Frontend:** the review page polls jobs (progress, cancel, failed/stale/expired recovery). It is covered by type-checking,
    lint, the production build, unit tests of the plain-language mapping, and a real-browser multi-document journey against the
    real backend (see the delivery report); no cross-browser or accessibility-tool audit beyond that was run.
12. **Licensing:** PyMuPDF is AGPL-3.0 / commercial; a legal decision is still needed (§2a). The pypdfium2 alternative
    failed one accuracy gate and remains experimental.
13. A syntactically valid, checksum-valid but *fabricated* document will be read and matched like a real one. Reading is not
    authentication; that is why nothing here changes trust status, scores or consent.
