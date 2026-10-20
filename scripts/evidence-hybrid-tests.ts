// Integration tests for the hybrid document pipeline (Python worker: embedded text + selective OCR + layout/tables).
//
// Needs the worker's Python dependencies (see docs/HORIZON_DOCUMENT_INTELLIGENCE.md). It builds a synthetic corpus with
// python/evidence_eval, runs a representative subset through the real worker subprocess, and checks accuracy and safety.
// If the worker cannot run on this machine it says so loudly and exits 2 instead of passing silently.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractDocumentHybrid } from "../src/modules/evidenceIntelligence/hybrid-extractor.js";
import type { DocumentExtraction } from "../src/modules/evidenceIntelligence/field-extractors.js";
import { compareNames } from "../src/modules/evidenceIntelligence/reconciliation.js";
import { workerAvailable, workerMode } from "../src/modules/evidenceIntelligence/worker-client.js";

type Case = { id: string; file: string; category: string; variant: string; docType: any; layout: string; truth: { fields: Record<string, string>; rows: Array<{ date: string | null; debit: number | null; credit: number | null; balance: number | null }> }; expected?: string };

let failures = 0;
async function test(name: string, callback: () => Promise<void>) {
  try { await callback(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const pythonRoot = path.resolve("python");
const python = process.env.EVIDENCE_WORKER_PYTHON ?? (process.platform === "win32" ? "python" : "python3");

async function main() {
  if (!(await workerAvailable())) {
    console.error("SKIPPED (not passed): the worker is not available in mode \"" + workerMode() + "\" (local: pip install -r python/requirements.txt AND python/requirements-eval.txt for the corpus generator; container: npm run worker:image). See docs/HORIZON_DOCUMENT_INTELLIGENCE.md.");
    process.exit(2);
  }
  const corpus = mkdtempSync(path.join(os.tmpdir(), "pramaan-hybrid-corpus-"));
  const tmpBefore = readdirSync(os.tmpdir()).filter((name) => name.startsWith("pramaan-extract-")).length;
  try {
    execFileSync(python, ["-m", "evidence_eval.generate_corpus", "--out", corpus, "--quick"], { cwd: pythonRoot, stdio: "ignore", timeout: 240_000 });
    const cases = (JSON.parse(readFileSync(path.join(corpus, "manifest.json"), "utf8")) as { cases: Case[] }).cases;
    const pick = (docType: string, variant: string, layout?: string) => {
      const found = cases.find((item) => item.docType === docType && item.variant === variant && (!layout || item.layout === layout));
      assert.ok(found, `corpus has ${docType}/${variant}`);
      return found as Case;
    };
    const run = async (item: Case): Promise<DocumentExtraction> =>
      extractDocumentHybrid({ documentId: item.id, docType: item.docType, mimeType: "application/pdf", bytes: readFileSync(path.join(corpus, item.file)) });
    const same = (field: string, truth: string, got: string | null | undefined) => {
      if (got == null) return false;
      if (field === "accountNumber") return got.slice(-4) === truth.slice(-4);
      if (["legalName", "enterpriseName", "accountHolderName"].includes(field)) { const s = compareNames(truth, got); return s === "EXACT" || s === "NORMALIZED"; }
      if (field === "bankName") return got.toUpperCase() === truth.toUpperCase();
      return got === truth;
    };
    const assertFields = (item: Case, result: DocumentExtraction, names: string[]) => {
      for (const name of names) {
        const field = result.fields.find((f) => f.field === name);
        assert.ok(field && field.status === "EXTRACTED", `${item.id} ${name} extracted (${field?.status})`);
        assert.ok(same(name, item.truth.fields[name], field.value), `${item.id} ${name} equals truth`);
      }
    };
    const GST = ["gstin", "legalName", "pan"];
    const UDYAM = ["udyamNumber", "enterpriseName"];
    const BANK = ["accountHolderName", "accountNumber", "ifsc"];

    await test("text PDFs: GST, Udyam and bank fields are exact with no review flags", async () => {
      for (const [type, names] of [["GST_CERTIFICATE", GST], ["UDYAM_CERTIFICATE", UDYAM], ["BANK_STATEMENT", BANK]] as const) {
        const item = pick(type, "text");
        const result = await run(item);
        assert.equal(result.engine, "HYBRID");
        assertFields(item, result, [...names]);
        assert.ok(result.fields.filter((f) => names.includes(f.field as never)).every((f) => !f.needsReview && f.method === "EMBEDDED_TEXT"), `${item.id} embedded text is not flagged`);
      }
    });

    await test("scanned PDFs are read by OCR, the identifiers are right, and identifiers are flagged for the owner to check", async () => {
      for (const [type, names] of [["GST_CERTIFICATE", GST], ["UDYAM_CERTIFICATE", UDYAM]] as const) {
        const item = pick(type, "scan300");
        const result = await run(item);
        assert.ok(result.ocrPages >= 1, "OCR was used");
        assertFields(item, result, [...names]);
        const id = result.fields.find((f) => f.field === (type === "GST_CERTIFICATE" ? "gstin" : "udyamNumber"));
        assert.equal(id?.method, "OCR");
        assert.equal(id?.needsReview, true, "an identifier read from a scan always needs the owner's check");
      }
    });

    await test("rotated PDF pages and upside-down scans are read correctly", async () => {
      for (const variant of ["pdf_rotate_90", "pdf_rotate_180", "pdf_rotate_270"]) { const item = pick("GST_CERTIFICATE", variant); assertFields(item, await run(item), GST); }
      const flipped = pick("UDYAM_CERTIFICATE", "scan_pixels_rotated_180");
      assertFields(flipped, await run(flipped), UDYAM);
    });

    await test("a font with no usable Unicode mapping is detected as garbled and read by OCR instead", async () => {
      const item = pick("GST_CERTIFICATE", "identity_h_without_tounicode");
      const result = await run(item);
      assert.ok(result.ocrPages >= 1, "fell back to OCR");
      assertFields(item, result, ["gstin", "legalName"]);
    });

    await test("image region on a text page is read (mixed page)", async () => {
      const item = pick("GST_CERTIFICATE", "image_region_on_text_page");
      assertFields(item, await run(item), ["gstin", "legalName"]);
    });

    await test("multi-page bank statements: every row is reconstructed and checked against the running balance", async () => {
      const multi = cases.filter((item) => item.docType === "BANK_STATEMENT" && item.variant === "text" && (item.truth.rows.length > 30) && item.layout !== "withdrawals");
      assert.ok(multi.length > 0, "corpus has a long statement");
      for (const item of multi) {
        const result = await run(item);
        assert.ok(result.table?.reliable, `${item.id} table reliable`);
        assert.equal(result.table?.rowCount, item.truth.rows.length, `${item.id} row count`);
        assert.equal(result.table?.balanceConsistent, result.table?.balanceChecked);
        const key = (row: { date: string | null; debit: number | null; credit: number | null; balance: number | null }) => `${row.date}|${row.debit ?? ""}|${row.credit ?? ""}|${row.balance ?? ""}`;
        assert.deepEqual((result.table?.rows ?? []).map(key), item.truth.rows.map(key), `${item.id} rows equal truth`);
      }
    });

    await test("mixed statement (text pages then scanned pages) yields a reliable table across both kinds of page", async () => {
      const item = pick("BANK_STATEMENT", "text_then_scanned_pages");
      const result = await run(item);
      assert.ok(result.ocrPages >= 1);
      assert.ok(result.table, "table present");
      assert.equal(result.table.rowCount, item.truth.rows.length, "every row recovered");
      const undated = result.table.rows.filter((row) => row.date === null);
      assert.ok(undated.every((row) => row.balanceCheck === "PASSED"), "a row whose date was unreadable is kept only if it continues the running balance exactly");
    });

    await test("sensitive values never leave the pipeline unmasked and nothing confident is wrong on a poor scan", async () => {
      const bank = await run(pick("BANK_STATEMENT", "text"));
      const account = bank.fields.find((f) => f.field === "accountNumber");
      assert.match(account?.value ?? "", /^X+\d{4}$/, "account number is masked at extraction");
      assert.ok(!(bank.table?.rows ?? []).some((row) => /\d{9,}/.test(row.description)), "long digit runs are masked in narrations");
      const poor = pick("GST_CERTIFICATE", "scan100");
      const result = await run(poor);
      for (const field of result.fields) {
        if (field.status !== "EXTRACTED") continue;
        const truth = poor.truth.fields[field.field];
        if (truth !== undefined && !same(field.field, truth, field.value)) assert.equal(field.needsReview, true, `${field.field} was misread and is flagged, never presented as certain`);
      }
    });

    await test("adversarial files are refused or bounded and never yield extracted values", async () => {
      const adversarial = cases.filter((item) => item.category === "adversarial" && item.expected === "NO_EXTRACTION");
      assert.ok(adversarial.length >= 8);
      for (const item of adversarial) {
        const result = await run(item);
        assert.ok(["UNREADABLE", "UNSUPPORTED", "REJECTED", "NOT_RECOGNISED"].includes(result.status), `${item.file} -> ${result.status}`);
        assert.equal(result.fields.filter((f) => f.status === "EXTRACTED").length, 0, `${item.file} extracted nothing`);
      }
      const js = cases.find((item) => item.file.includes("javascript"));
      assert.equal((await run(js as Case)).status, "REJECTED");
    });

    await test("when the worker cannot start: local mode falls back to the basic reader (labelled); container mode fails closed", async () => {
      const container = workerMode() === "container";
      const savedPython = process.env.EVIDENCE_WORKER_PYTHON;
      const savedImage = process.env.EVIDENCE_WORKER_IMAGE;
      process.env.EVIDENCE_WORKER_PYTHON = "python-that-does-not-exist";
      process.env.EVIDENCE_WORKER_IMAGE = "pramaan-evidence-worker:does-not-exist";
      try {
        const result = await run(pick("GST_CERTIFICATE", "text"));
        if (container) {
          assert.equal(result.status, "UNREADABLE");
          assert.equal(result.reason, "WORKER_UNAVAILABLE");
        } else {
          assert.equal(result.engine, "LEGACY");
          assert.ok(result.reason !== null);
          const scan = await run(pick("GST_CERTIFICATE", "scan300"));
          assert.ok(scan.status !== "EXTRACTED", "a scan is not 'read' by the fallback");
        }
      } finally {
        if (savedPython === undefined) delete process.env.EVIDENCE_WORKER_PYTHON; else process.env.EVIDENCE_WORKER_PYTHON = savedPython;
        if (savedImage === undefined) delete process.env.EVIDENCE_WORKER_IMAGE; else process.env.EVIDENCE_WORKER_IMAGE = savedImage;
      }
    });

    await test("bytes decide the file type, not the client MIME type", async () => {
      const exe = await extractDocumentHybrid({ documentId: "x", docType: "GST_CERTIFICATE", mimeType: "application/pdf", bytes: Buffer.from("MZ\x90\x00 not a pdf") });
      assert.equal(exe.status, "UNSUPPORTED");
      const fakePng = await extractDocumentHybrid({ documentId: "x", docType: "GST_CERTIFICATE", mimeType: "image/png", bytes: Buffer.from("%PDF-1.4 pretending") });
      assert.equal(fakePng.status, "UNSUPPORTED");
    });

    await test("isolated temp directories are removed after every extraction", async () => {
      const after = readdirSync(os.tmpdir()).filter((name) => name.startsWith("pramaan-extract-")).length;
      assert.equal(after, tmpBefore);
    });
  } finally {
    rmSync(corpus, { recursive: true, force: true, maxRetries: 3 });
  }
  if (failures > 0) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
  console.log("\nAll hybrid document pipeline tests passed");
}

main().catch((error) => { console.error(error); process.exit(1); });
