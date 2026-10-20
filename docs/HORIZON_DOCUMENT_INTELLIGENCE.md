# HorizonXT — Advanced Document Intelligence

Extension of [HORIZON_EVIDENCE_INTELLIGENCE.md](HORIZON_EVIDENCE_INTELLIGENCE.md). The owner evidence review, the
reconciliation rules, the Minimal Evidence Challenge planner, the API and the owner-confirmed correction flow are
unchanged in shape; what changed is **how documents are read**: from "text-based, simple PDFs only" to a page-aware hybrid
pipeline that also reads scanned, rotated, mixed and multi-column documents and reconstructs multi-page bank-statement
tables — locally, with no external service.

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

Fallback: if the worker cannot start (Python/dependencies missing), PDFs are read by the original dependency-free TypeScript
parser (`pdf-text.ts`), the result is labelled `engine: "LEGACY"` and the UI says scanned pages cannot be read in that
mode. Images are then `UNSUPPORTED`. A degraded result is never cached.

## 2. Dependency decisions

| Concern | Decision | Why | Not chosen |
|---|---|---|---|
| PDF parsing, text + boxes, rendering | **PyMuPDF** (AGPL-3.0 / commercial) | Fast, robust on malformed files, gives word boxes, rotation, images, xref access for the active-content scan | pdfplumber/pdfminer (slower, no rendering; evaluated as a comparator only, not shipped) |
| OCR | **RapidOCR (onnxruntime)**, models bundled in the wheel | Runs fully offline, no binary install, works on Windows/Linux, no runtime download | **Tesseract / OCRmyPDF**: not installable in the reference environment (the user-scope installer failed and a machine-wide install is an infrastructure change that was deliberately not made), so it is **not implemented and not tested**. The OCR call sits behind `ocr.py`; Tesseract could be added behind the same function |
| Layout models (LayoutLM etc.) | none | Heavy, GPU-oriented, unverifiable here; geometry + labels + validators are enough for three known document families | |
| External/paid OCR or LLM APIs | none | Sensitive MSME documents must not leave the server | |
| Original TS parser | kept | Dependency-free fallback and the benchmark baseline | |

**Licence note:** PyMuPDF is AGPL-3.0 (commercial licence available). Running it as a separate server-side process
that the Pramaan backend calls is the intended use; legal review of AGPL obligations for the hosted product is a
**decision for the owner of the product, not made here**. RapidOCR is Apache-2.0; its bundled PP-OCR models are
Apache-2.0.

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
| Hard memory cap | **Windows only, verified**: Job Object `ProcessMemoryLimit` (a 600 MB allocation fails at a 300 MB cap) plus "no child processes" (`ActiveProcessLimit=1`, verified). **POSIX: `RLIMIT_AS`/`RLIMIT_CPU` are set but were NOT tested here** |
| Cooperative working-set check between pages | **Enforced** (all platforms) |
| No network from the worker | **Partly**: sockets are disabled *inside the Python process* (defence in depth, not a boundary — native code could bypass it). **Not enforced at OS level.** Run the container with `--network none` |
| Syscall filtering (seccomp), namespaces, chroot, read-only filesystem, separate unprivileged user | **NOT enforced by this code.** Provide them in deployment (below) |
| CPU time limit on Windows | **Not enforced** except by the Node kill and the 100 s cooperative budget |
| Sandboxed PyMuPDF/ONNX native code | **Not sandboxed.** A memory-corruption bug in a native dependency would run with the worker's privileges. Mitigation is deployment isolation + patching |
| No raw document text or values in logs | **Enforced**: the worker prints one JSON object to stdout only; stderr is ignored by the parent; MuPDF error display is disabled; the service logs nothing extracted. API tests scan server logs, audit rows and notifications for PAN/account/GSTIN |
| Owner-only values; cross-tenant isolation | **Enforced** by the existing owner-scoped route (`MSME` role, own business only); a document id of another owner cannot drive a correction (tested) |
| Account numbers | **Masked at extraction** (last four digits). The worker's JSON (which contains the page text) exists in Node memory only for the duration of one extraction; the structured result that is returned, cached or serialised holds only the masked value and no page text, so the full number cannot reach an API response, log, audit row, notification or the cache. Long digit runs in transaction narrations are masked too |
| PAN | Masked in every API response (existing rule); the raw value only exists in memory to compare with the declaration |
| Requester access | **Unchanged.** Nothing here touches consent, Passport snapshots, requester views or trust scoring (non-regression tests pass) |
| Result cache | **In-memory only**, 10 min, 24 entries, keyed by owner+document+sha256+pipeline version; structured values only, no page text; per-process (not shared between instances). Trade-off: owner-only values sit in process memory for ≤10 min |
| Rate limit | Existing per-owner limiter (30 / 10 min), **in-memory, single-instance** |

## 5. Setup and deployment

### Requirements
* Node 24 (the version used for all tests here); **Python 3.12** (3.10+ expected to work, only 3.12.10 was tested)
* Python packages: `pip install -r python/requirements.txt` (PyMuPDF, rapidocr-onnxruntime, numpy, pillow).
  `python/requirements-eval.txt` adds `reportlab` for the corpus generator.
* System packages: none for the pipeline itself on Windows/macOS. On slim Linux images ONNX Runtime and OpenCV need
  `libgl1`/`libglib2.0-0` (OpenCV is pulled in by RapidOCR; `opencv-python-headless` avoids the GL dependency).
* Disk: ~350 MB for the Python environment (ONNX Runtime, OpenCV, models). RAM: plan **~700 MB per concurrent OCR page**
  (measured peak 520–680 MB for scans, ~90 MB for text PDFs); with the default concurrency of 2, reserve ~1.5 GB.

### Environment variables
| Variable | Default | Meaning |
|---|---|---|
| `EVIDENCE_WORKER_PYTHON` | `python` (Windows) / `python3` | Interpreter of the virtualenv that has the dependencies |
| `EVIDENCE_WORKER_DIR` | `<cwd>/python` | Directory containing the `evidence_worker` package |

Limits are constants in `worker-client.ts` (`WORKER_DEFAULTS`) and passed as flags to the worker.

### Example container (illustrative — not built or run in this environment)
```dockerfile
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libglib2.0-0 libgl1 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY python/requirements.txt python/requirements.txt
RUN python3 -m venv /opt/worker-venv && /opt/worker-venv/bin/pip install --no-cache-dir -r python/requirements.txt
COPY . .
RUN npm ci && npm run build
ENV EVIDENCE_WORKER_PYTHON=/opt/worker-venv/bin/python EVIDENCE_WORKER_DIR=/app/python
USER node
CMD ["npm", "start"]
```
Run with: `--read-only --tmpfs /tmp:size=256m --memory 2g --cpus 2 --pids-limit 128 --cap-drop ALL --security-opt no-new-privileges`.
Note `--network none` cannot be applied to the *API* container (it serves HTTP); to get a network-less worker, run the
worker in a **separate network-less container/sidecar** invoked over a local socket or a job queue. That split is **not
implemented** — today the worker runs as a child of the API process, so OS-level network isolation applies to both
or neither. This is the largest remaining gap between the current code and a production-grade sandbox.

### Verifying an installation
```
npm run test:evidence-hybrid       # builds a synthetic corpus, runs the real worker; exits 2 (not "pass") if Python deps are missing
npm run benchmark:evidence -- <corpus dir>
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
   100 s budget (PARTIAL result). The queue (2 + 8) protects the server but a burst of scanned uploads will see HTTP 503
   `EXTRACTION_BUSY`. Reviews are computed synchronously per request (cached 10 min); a job queue would be better at scale.
4. **No OS-level sandbox, no network-less worker process** (section 4). The in-process network block and Job Object limits are
   defence in depth. Hard memory caps are verified on Windows only; POSIX `RLIMIT_*` are applied but untested here.
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
10. **Result cache is per-process, in memory.** Multiple API instances re-run OCR and do not share results; the existing
    per-owner rate limiter is likewise per-instance.
11. **Frontend:** the new review elements (read-method line, "Check this value" notes, uncertain-reading item,
    transactions preview) are covered by type-checking, the production build and unit tests of the plain-language mapping,
    and the API contract is exercised end to end by the backend tests; **no browser/visual run was done in this phase.**
12. **Licensing:** PyMuPDF is AGPL-3.0; a legal decision is needed before shipping it in a hosted product (alternatives:
    commercial licence, or pypdfium2 + pdfplumber at the cost of re-validating the pipeline).
13. A syntactically valid, checksum-valid but *fabricated* document will be read and matched like a real one. Reading is not
    authentication; that is why nothing here changes trust status, scores or consent.
