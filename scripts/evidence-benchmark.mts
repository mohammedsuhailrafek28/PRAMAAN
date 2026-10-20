// Benchmark of the hybrid document pipeline against the original dependency-free parser on the synthetic corpus.
//
//   python -m evidence_eval.generate_corpus --out <dir> [--quick]      (from python/; needs reportlab, pillow, pymupdf)
//   npx tsx scripts/evidence-benchmark.ts <dir> [--json out.json] [--only 001,002] [--skip-legacy]
//
// The corpus is SYNTHETIC (fictional entities, layouts modelled from general knowledge, not copied from real documents),
// so the numbers measure this pipeline on this corpus and say nothing about real-world accuracy.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractDomainFields } from "../src/modules/evidenceIntelligence/domain-extraction.js";
import { extractDocumentLegacy, type DocumentExtraction, type ExtractedField } from "../src/modules/evidenceIntelligence/field-extractors.js";
import { compareNames, reconcileClaims } from "../src/modules/evidenceIntelligence/reconciliation.js";
import { runWorker } from "../src/modules/evidenceIntelligence/worker-client.js";

type Truth = { fields: Record<string, string>; rows: Array<{ page: number; date: string | null; debit: number | null; credit: number | null; balance: number | null }>; lines: string[][] };
type Case = { id: string; file: string; category: string; variant: string; docType: any; truth?: Truth; entity?: Record<string, string>; expected?: string };

const args = process.argv.slice(2);
const dir = args.find((item) => !item.startsWith("--")) as string;
if (!dir) throw new Error("usage: evidence-benchmark.ts <corpus dir> [--json out.json] [--only ids] [--skip-legacy]");
const flag = (name: string) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const only = flag("--only")?.split(",");
const skipLegacy = args.includes("--skip-legacy");
const onlyVariants = flag("--variants")?.split(",");
const detail: string[] = [];
const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as { cases: Case[] };

const IDENTIFIERS = new Set(["gstin", "pan", "udyamNumber", "accountNumber", "ifsc"]);
const FAMILY: Record<string, string> = {
  text: "embedded text", text_plain_streams: "embedded text, plain streams + standard fonts (original-parser friendly)", scan300: "scan (300 dpi)", scan150: "scan (150 dpi)", scan100: "low-res scan (100 dpi)",
  pdf_rotate_90: "rotated PDF page", pdf_rotate_180: "rotated PDF page", pdf_rotate_270: "rotated PDF page",
  scan_pixels_rotated_90: "rotated scan", scan_pixels_rotated_180: "rotated scan",
  identity_h_without_tounicode: "broken font encoding", image_region_on_text_page: "mixed (image on text page)", text_then_scanned_pages: "mixed (text then scanned pages)"
};

const strip = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
function matches(field: string, truth: string, got: string): boolean {
  if (field === "accountNumber") return got.slice(-4) === truth.slice(-4);
  if (field === "legalName" || field === "enterpriseName" || field === "accountHolderName") { const s = compareNames(truth, got); return s === "EXACT" || s === "NORMALIZED"; }
  if (field === "bankName") return strip(got) === strip(truth);
  return got === truth;
}

function levenshteinSemiGlobal(needle: string, haystack: string): number {
  // Smallest edit distance between `needle` and any substring of `haystack` (order-independent, tolerant of line wrapping).
  let previous = new Array<number>(haystack.length + 1).fill(0);
  for (let i = 1; i <= needle.length; i += 1) {
    const current = new Array<number>(haystack.length + 1);
    current[0] = i;
    for (let j = 1; j <= haystack.length; j += 1) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (needle[i - 1] === haystack[j - 1] ? 0 : 1));
    previous = current;
  }
  return Math.min(...previous);
}

type Acc = { truthFields: number; correct: number; wrong: number; notExtracted: number; flagged: number; identifierTruth: number; identifierExact: number; cases: number; ms: number[]; peakMb: number[]; rowTruth: number; rowGot: number; rowCorrect: number; passedGot: number; passedCorrect: number; rowsWithoutDate: number; tableCases: number; tableReliable: number; cerDist: number; cerChars: number; falseConflicts: number; comparable: number; ownerReview: number };
const fresh = (): Acc => ({ truthFields: 0, correct: 0, wrong: 0, notExtracted: 0, flagged: 0, identifierTruth: 0, identifierExact: 0, cases: 0, ms: [], peakMb: [], rowTruth: 0, rowGot: 0, rowCorrect: 0, passedGot: 0, passedCorrect: 0, rowsWithoutDate: 0, tableCases: 0, tableReliable: 0, cerDist: 0, cerChars: 0, falseConflicts: 0, comparable: 0, ownerReview: 0 });

function score(acc: Acc, testCase: Case, extraction: DocumentExtraction, ms: number) {
  const truth = testCase.truth as Truth;
  acc.cases += 1;
  acc.ms.push(ms);
  const entity = testCase.entity ?? {};
  for (const [name, expected] of Object.entries(truth.fields)) {
    acc.truthFields += 1;
    const isId = IDENTIFIERS.has(name);
    if (isId) acc.identifierTruth += 1;
    const field = extraction.fields.find((item: ExtractedField) => item.field === name);
    if (!field || field.status !== "EXTRACTED" || field.value === null) { acc.notExtracted += 1; continue; }
    if (field.needsReview) acc.flagged += 1;
    if (matches(name, expected, field.value)) { acc.correct += 1; if (isId) acc.identifierExact += 1; } else acc.wrong += 1;
  }
  if (testCase.docType === "BANK_STATEMENT" && truth.rows.length > 0) {
    acc.tableCases += 1;
    if (extraction.table?.reliable) acc.tableReliable += 1;
    acc.rowTruth += truth.rows.length;
    const remaining = new Map<string, number>();
    const key = (row: { date: string | null; debit: number | null; credit: number | null; balance: number | null }) => `${row.date}|${row.debit ?? ""}|${row.credit ?? ""}|${row.balance ?? ""}`;
    for (const row of truth.rows) remaining.set(key(row), (remaining.get(key(row)) ?? 0) + 1);
    for (const row of extraction.table?.rows ?? []) {
      acc.rowGot += 1;
      const k = key(row);
      let isCorrect = (remaining.get(k) ?? 0) > 0;
      if (isCorrect) { remaining.set(k, (remaining.get(k) as number) - 1); acc.rowCorrect += 1; }
      else if (row.date === null) {
        // A row recovered from its amounts alone (date cell unreadable) counts if some unmatched true row has the same amounts.
        const amounts = (r: { debit: number | null; credit: number | null; balance: number | null }) => `${r.debit ?? ""}|${r.credit ?? ""}|${r.balance ?? ""}`;
        const hit = [...remaining.entries()].find(([key, count]) => count > 0 && key.split("|").slice(1).join("|") === amounts(row));
        if (hit) { remaining.set(hit[0], hit[1] - 1); acc.rowCorrect += 1; acc.rowsWithoutDate += 1; isCorrect = true; }
      }
      if (row.balanceCheck === "PASSED") { acc.passedGot += 1; if (isCorrect) acc.passedCorrect += 1; }
    }
  }
  // Reconcile against a declaration equal to the truth: any CONFLICTED claim is a false conflict.
  const declared = { legalName: entity.legalName ?? null, gstin: entity.gstin ?? null, pan: entity.pan ?? null, udyamNumber: entity.udyamNumber ?? null };
  for (const claim of reconcileClaims(declared, [extraction])) {
    if (claim.claim === "bankAccount" || claim.comparisons.length === 0) continue;
    const readable = claim.comparisons.some((item) => item.outcome === "MATCH" || item.outcome === "DIFFERENT" || item.outcome === "NEAR_MATCH" || item.outcome === "UNCERTAIN");
    if (!readable) continue;
    acc.comparable += 1;
    if (claim.status === "CONFLICTED") acc.falseConflicts += 1;
    if (claim.needsOwnerReview) acc.ownerReview += 1;
  }
}

function addCer(acc: Acc, testCase: Case, pageTexts: string[][], methods: string[]) {
  const truth = testCase.truth as Truth;
  truth.lines.forEach((lines, index) => {
    if (methods[index] === undefined) return;
    const haystack = strip(pageTexts[index]?.join("") ?? "");
    for (const line of lines) {
      const needle = strip(line);
      if (needle.length < 4) continue;
      acc.cerChars += needle.length;
      acc.cerDist += haystack.length === 0 ? needle.length : levenshteinSemiGlobal(needle, haystack);
    }
  });
}

type Bucket = { hybrid: Acc; legacy: Acc };
const buckets = new Map<string, Bucket>();
const bucket = (name: string) => { if (!buckets.has(name)) buckets.set(name, { hybrid: fresh(), legacy: fresh() }); return buckets.get(name) as Bucket; };
const adversarial: Array<{ id: string; file: string; expected: string; hybrid: string; legacy: string; hybridSafe: boolean; legacySafe: boolean; hybridMs: number }> = [];

const ocrCer = fresh();
const embeddedCer = fresh();

for (const testCase of manifest.cases) {
  if (only && !only.includes(testCase.id)) continue;
  if (onlyVariants && !onlyVariants.includes(testCase.variant)) continue;
  const bytes = readFileSync(path.join(dir, testCase.file));
  const input = { documentId: testCase.id, docType: testCase.docType, mimeType: "application/pdf", bytes };
  const startedHybrid = performance.now();
  const run = bytes.length <= 5 * 1024 * 1024 ? await runWorker(bytes, "pdf") : null;
  const hybrid: DocumentExtraction = run ? extractDomainFields({ documentId: testCase.id, docType: testCase.docType, output: run.output, wallMs: run.wallMs })
    : { documentId: testCase.id, docType: testCase.docType, status: "REJECTED", reason: bytes.length > 5 * 1024 * 1024 ? "TOO_LARGE" : "WORKER_UNAVAILABLE", fields: [], pageCount: 0, engine: "HYBRID", ocrPages: 0, pages: [], table: null, needsReview: false, elapsedMs: null };
  const hybridMs = performance.now() - startedHybrid;
  const startedLegacy = performance.now();
  let legacy: DocumentExtraction | null = null;
  if (!skipLegacy) legacy = bytes.length > 5 * 1024 * 1024 ? { ...hybrid, engine: "LEGACY", status: "REJECTED", fields: [] } : extractDocumentLegacy(input);
  const legacyMs = performance.now() - startedLegacy;

  if (testCase.category === "adversarial") {
    const expected = testCase.expected ?? "NO_EXTRACTION";
    const safe = (extraction: DocumentExtraction) => {
      const refused = ["UNREADABLE", "UNSUPPORTED", "REJECTED", "NOT_RECOGNISED"].includes(extraction.status);
      if (expected === "NO_EXTRACTION") return refused;
      if (expected === "PARTIAL_OR_NONE") return refused || extraction.status === "PARTIAL";
      return true;
    };
    adversarial.push({ id: testCase.id, file: testCase.file, expected, hybrid: `${hybrid.status}${hybrid.reason ? "/" + hybrid.reason : ""}`, legacy: legacy ? `${legacy.status}${legacy.reason ? "/" + legacy.reason : ""}` : "-", hybridSafe: safe(hybrid), legacySafe: legacy ? safe(legacy) : false, hybridMs: Math.round(hybridMs) });
    continue;
  }

  const family = FAMILY[testCase.variant] ?? testCase.variant;
  for (const name of [family, "ALL"]) {
    const target = bucket(name);
    score(target.hybrid, testCase, hybrid, hybridMs);
    if (name === "ALL") {
      for (const [fieldName, expected] of Object.entries((testCase.truth as Truth).fields)) {
        const got = hybrid.fields.find((item) => item.field === fieldName);
        if (!got || got.status !== "EXTRACTED" || got.value === null || !matches(fieldName, expected, got.value)) detail.push(`${testCase.id} ${testCase.variant} ${fieldName}: expected=${fieldName === "accountNumber" ? "…" + expected.slice(-4) : expected} got=${got?.status === "EXTRACTED" ? got.value : got?.status ?? "none"} review=${got?.needsReview ?? "-"} ${got?.reviewReasons?.join(",") ?? ""}`);
      }
      const entity = testCase.entity ?? {};
      for (const claim of reconcileClaims({ legalName: entity.legalName ?? null, gstin: entity.gstin ?? null, pan: entity.pan ?? null, udyamNumber: entity.udyamNumber ?? null }, [hybrid])) {
        if (claim.status === "CONFLICTED") detail.push(`${testCase.id} ${testCase.variant} FALSE CONFLICT ${claim.claim}: declared=${claim.declaredValue} read=${claim.comparisons.map((item) => item.extractedValue).join("|")}`);
      }
      if (hybrid.table && !hybrid.table.reliable) detail.push(`${testCase.id} ${testCase.variant} table not reliable rows=${hybrid.table.rowCount}/${(testCase.truth as Truth).rows.length}`);
      if (!hybrid.table && testCase.docType === "BANK_STATEMENT") detail.push(`${testCase.id} ${testCase.variant} NO TABLE (truth ${(testCase.truth as Truth).rows.length}) status=${hybrid.status}`);
      if (hybridMs > 40_000) detail.push(`${testCase.id} ${testCase.variant} SLOW ${Math.round(hybridMs)}ms status=${hybrid.status} reason=${hybrid.reason}`);
    }
    if (run) target.hybrid.peakMb.push(run.output.metrics.peakWorkingSetMb);
    if (legacy) score(target.legacy, testCase, legacy, legacyMs);
  }
  if (run) {
    const pageTexts = run.output.pages.map((page) => page.lines.map((line) => line.text));
    const methods = run.output.pages.map((page) => page.method);
    for (let index = 0; index < methods.length; index += 1) {
      const single = { ...testCase, truth: { ...(testCase.truth as Truth), lines: [(testCase.truth as Truth).lines[index] ?? []] } } as Case;
      addCer(methods[index] === "EMBEDDED_TEXT" ? embeddedCer : ocrCer, single, [pageTexts[index]], [methods[index]]);
    }
  }
  process.stderr.write(`${testCase.id} ${testCase.variant} ${Math.round(hybridMs)}ms\n`);
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);
const median = (values: number[]) => { if (!values.length) return 0; const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const p95 = (values: number[]) => { if (!values.length) return 0; const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; };

const rows: Array<Record<string, string | number>> = [];
for (const [name, value] of [...buckets.entries()].sort((a, b) => (a[0] === "ALL" ? 1 : b[0] === "ALL" ? -1 : a[0].localeCompare(b[0])))) {
  for (const engine of ["hybrid", "legacy"] as const) {
    const a = value[engine];
    if (a.cases === 0) continue;
    rows.push({
      group: name, engine, cases: a.cases,
      "field recall": pct(a.correct, a.truthFields), "field precision": pct(a.correct, a.correct + a.wrong), "identifier exact": pct(a.identifierExact, a.identifierTruth),
      "abstained": pct(a.notExtracted, a.truthFields), "flagged for review": pct(a.flagged, a.correct + a.wrong),
      "row recall": pct(a.rowCorrect, a.rowTruth), "row precision": pct(a.rowCorrect, a.rowGot), "precision of balance-checked rows": pct(a.passedCorrect, a.passedGot), "rows w/o date": a.rowsWithoutDate,
      "false conflicts": `${a.falseConflicts}/${a.comparable}`, "owner-review claims": `${a.ownerReview}/${a.comparable}`,
      "median ms": Math.round(median(a.ms)), "p95 ms": Math.round(p95(a.ms)), "peak MB": engine === "hybrid" ? Math.round(Math.max(0, ...a.peakMb)) : "-"
    });
  }
}
console.log("\n## Field and table accuracy by input type (synthetic corpus)");
console.table(rows);
console.log("\n## OCR / text read quality (character error rate vs known page text, order-independent)");
console.table([
  { source: "embedded text pages", chars: embeddedCer.cerChars, CER: pct(embeddedCer.cerDist, embeddedCer.cerChars) },
  { source: "OCR / mixed pages", chars: ocrCer.cerChars, CER: pct(ocrCer.cerDist, ocrCer.cerChars) }
]);
console.log("\n## Adversarial files (safe failure)");
console.table(adversarial.map((item) => ({ id: item.id, file: item.file, expected: item.expected, hybrid: item.hybrid, "hybrid safe": item.hybridSafe, legacy: item.legacy, "legacy safe": item.legacySafe, "hybrid ms": item.hybridMs })));
console.log(`hybrid safe: ${adversarial.filter((i) => i.hybridSafe).length}/${adversarial.length}; legacy safe: ${adversarial.filter((i) => i.legacySafe).length}/${adversarial.length}`);

if (detail.length) { console.log("\n## Misses, false conflicts and slow cases"); for (const line of detail) console.log(line); }
const outPath = flag("--json");
if (outPath) writeFileSync(outPath, JSON.stringify({ rows, adversarial, detail, cer: { embedded: embeddedCer, ocr: ocrCer } }, null, 1));
