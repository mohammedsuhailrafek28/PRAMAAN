// Domain extraction over the worker's positioned text: GST certificate, Udyam certificate, bank statement.
//
// Layout-agnostic: a label is associated with a value spatially (same cell, the cell to its right, or the cell directly
// below it), so key/value tables, stacked forms and multi-column pages all work without per-template code.
// Document text is untrusted data: it is only matched against fixed anchored patterns, every value is format-validated
// and length-bounded, and nothing in it is ever interpreted as an instruction.
//
// Confidence is built from evidence, not from a model score: how the text was obtained (embedded text vs OCR and the OCR
// engine's own per-segment confidence), how the value was anchored (label vs pattern only), and what validation it passes
// (format, GSTIN check character, PAN-inside-GSTIN consistency). Values that fail validation, were repaired after an OCR
// confusion, rely on OCR for an identifier, or are low-confidence are flagged `needsReview`. A flagged value is never used
// to propose a correction to the owner's declaration.

import type { DocumentType } from "@prisma/client";
import type { DocumentExtraction, ExtractedField, ExtractedFieldName, ExtractionDocumentStatus, ExtractionMethod, TransactionRow, TransactionTable } from "./field-extractors.js";
import type { WorkerOutput } from "./worker-client.js";

type Page = WorkerOutput["pages"][number];
type Line = Page["lines"][number];
type Segment = Line["segments"][number];

type Candidate = { group: number; tier: 1 | 2 | 3; value: string; page: number; line: number; region: [number, number, number, number]; conf: number; method: string; patternOnly?: boolean };

const SENSITIVE_IDENTIFIERS = new Set<ExtractedFieldName>(["gstin", "pan", "udyamNumber", "accountNumber", "ifsc"]);
const MAX_VALUE = 120;
const REVIEW_CONFIDENCE = 0.8;

// ------------------------------------------------------------------------------------------------ identifiers
const DIGIT_FIX: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1", T: "1", Z: "2", S: "5", G: "6", B: "8" };
const LETTER_FIX: Record<string, string> = { "0": "O", "1": "I", "2": "Z", "5": "S", "8": "B", "6": "G" };
type Slot = "D" | "L" | "A" | "Z" | "0" | "N"; // digit, letter, 1-9/A-Z, literal Z, literal 0, alphanumeric
const slotOk = (slot: Slot, ch: string) =>
  slot === "D" ? /[0-9]/.test(ch) : slot === "L" ? /[A-Z]/.test(ch) : slot === "A" ? /[1-9A-Z]/.test(ch) : slot === "Z" ? ch === "Z" : slot === "0" ? ch === "0" : /[0-9A-Z]/.test(ch);

const GSTIN_SLOTS: Slot[] = ["D", "D", "L", "L", "L", "L", "L", "D", "D", "D", "D", "L", "A", "Z", "N"];
const PAN_SLOTS: Slot[] = ["L", "L", "L", "L", "L", "D", "D", "D", "D", "L"];
const IFSC_SLOTS: Slot[] = ["L", "L", "L", "L", "0", "N", "N", "N", "N", "N", "N"];
const UDYAM_SLOTS: Slot[] = ["L", "L", "D", "D", "D", "D", "D", "D", "D", "D", "D"]; // after the literal UDYAM prefix

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export function gstinCheckCharacterValid(gstin: string): boolean {
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const product = ALPHABET.indexOf(gstin[index]) * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36] === gstin[14];
}

/** Fits `raw` to a positional template, correcting at most `maxFixes` classic OCR confusions (O/0, I/1, S/5, B/8...). */
function fit(raw: string, slots: Slot[], maxFixes = 3): { value: string; repaired: boolean } | null {
  if (raw.length !== slots.length) return null;
  let repaired = 0;
  let out = "";
  for (let index = 0; index < slots.length; index += 1) {
    let ch = raw[index];
    if (!slotOk(slots[index], ch)) {
      const candidate = slots[index] === "D" || slots[index] === "0" ? DIGIT_FIX[ch] : slots[index] === "L" || slots[index] === "Z" ? LETTER_FIX[ch] : undefined;
      if (candidate === undefined || !slotOk(slots[index], candidate)) return null;
      ch = candidate;
      repaired += 1;
      if (repaired > maxFixes) return null;
    }
    out += ch;
  }
  return { value: out, repaired: repaired > 0 };
}

const alnumUpper = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

function validateGstin(raw: string, ocr: boolean): { value: string; repaired: boolean; checksum: boolean } | null {
  const compact = alnumUpper(raw);
  for (let start = 0; start + 15 <= compact.length && start <= 2; start += 1) {
    const fitted = fit(compact.slice(start, start + 15), GSTIN_SLOTS, ocr ? 3 : 0);
    if (!fitted) continue;
    const checksum = gstinCheckCharacterValid(fitted.value);
    if (fitted.repaired && !checksum) continue; // a repair is only accepted when the check character then validates
    return { ...fitted, checksum };
  }
  return null;
}
const validatePan = (raw: string, ocr: boolean) => { const c = alnumUpper(raw); return c.length >= 10 ? fit(c.slice(0, 10), PAN_SLOTS, ocr ? 2 : 0) : null; };
const validateIfsc = (raw: string, ocr: boolean) => { const c = alnumUpper(raw); return c.length >= 11 ? fit(c.slice(0, 11), IFSC_SLOTS, ocr ? 1 : 0) : null; };
function validateUdyam(raw: string, ocr: boolean): { value: string; repaired: boolean } | null {
  const c = alnumUpper(raw);
  const at = c.indexOf("UDYAM");
  const body = at >= 0 ? c.slice(at + 5, at + 5 + 11) : c.length === 11 ? c : "";
  const fitted = body.length === 11 ? fit(body, UDYAM_SLOTS, ocr ? 2 : 0) : null;
  return fitted ? { value: `UDYAM-${fitted.value.slice(0, 2)}-${fitted.value.slice(2, 4)}-${fitted.value.slice(4)}`, repaired: fitted.repaired } : null;
}
function validateAccount(raw: string): { masked: string } | null {
  const compact = raw.replace(/[\s-]/g, "");
  if (/^\d{9,18}$/.test(compact)) return { masked: `${"X".repeat(compact.length - 4)}${compact.slice(-4)}` };
  const masked = /^[Xx*#•]{4,17}\d{3,4}$/.exec(compact);
  return masked ? { masked: `${"X".repeat(compact.length - (compact.match(/\d+$/) as RegExpMatchArray)[0].length)}${(compact.match(/\d+$/) as RegExpMatchArray)[0]}` } : null;
}
function cleanName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim().replace(/^[:\-–\s]+|[:\-–\s]+$/g, "");
  if (name.length < 2 || name.length > MAX_VALUE || !/[A-Za-z]{2}/.test(name) || /[<>{}\\]/.test(name) || /^\d+$/.test(name)) return null;
  return name;
}
const ANY_LABEL = /^(?:\d{1,2}\s*[.)]\s*)?(registration|legal\s*name|trade\s*name|constitution|address|date|type\s*of|gstin|pan\b|permanent|name\s*of|udyam|major|account|ifsc|branch|statement|period|customer|bank|nature|principal)/i;

// ------------------------------------------------------------------------------------------------ spatial association
function labelRegexp(label: string): RegExp {
  return new RegExp(`^\\s*(?:\\d{1,2}\\s*[.)]\\s*)?(?:${label})\\s*(?:[:\\-–]\\s*)?(.*)$`, "i");
}
const overlapX = (a: Segment, b: Segment) => Math.min(a.bbox[2], b.bbox[2]) - Math.max(a.bbox[0], b.bbox[0]);

function associate(pages: Page[], label: string): Candidate[] {
  const pattern = labelRegexp(label);
  const out: Candidate[] = [];
  let group = 0;
  for (const page of pages) {
    page.lines.forEach((line, lineIndex) => {
      line.segments.forEach((segment, segmentIndex) => {
        const match = pattern.exec(segment.text);
        if (!match) return;
        group += 1;
        const at = (value: string, tier: 1 | 2 | 3, from: Segment, from_line: number): Candidate => ({
          group, tier, value: value.slice(0, 400), page: page.page, line: from_line + 1, region: from.bbox as [number, number, number, number], conf: from.conf, method: from.method
        });
        const remainder = match[1].trim();
        if (remainder) out.push(at(remainder, 1, segment, lineIndex));
        const right = line.segments[segmentIndex + 1];
        if (right && right.bbox[0] >= segment.bbox[2] - 3 && !ANY_LABEL.test(right.text)) out.push(at(right.text, 2, right, lineIndex));
        const height = Math.max(segment.bbox[3] - segment.bbox[1], 4);
        for (let below = lineIndex + 1; below <= lineIndex + 3 && below < page.lines.length; below += 1) {
          const candidateLine = page.lines[below];
          if (candidateLine.bbox[1] - segment.bbox[3] > height * 2.4) break;
          const target = candidateLine.segments.find((s) => !ANY_LABEL.test(s.text) && (overlapX(segment, s) >= 0.3 * Math.min(segment.bbox[2] - segment.bbox[0], s.bbox[2] - s.bbox[0]) || Math.abs(s.bbox[0] - segment.bbox[0]) <= 25));
          if (target) { out.push(at(target.text, 3, target, below)); break; }
        }
      });
    });
  }
  return out;
}

function patternScan(pages: Page[], pattern: RegExp): Candidate[] {
  const out: Candidate[] = [];
  let group = 1_000_000;
  for (const page of pages) {
    page.lines.forEach((line, lineIndex) => {
      for (const segment of line.segments) {
        const text = segment.text.toUpperCase().replace(/\s+/g, "");
        pattern.lastIndex = 0;
        const match = pattern.exec(text);
        if (match) out.push({ group: (group += 1), tier: 3, value: match[0], page: page.page, line: lineIndex + 1, region: segment.bbox as [number, number, number, number], conf: segment.conf, method: segment.method, patternOnly: true });
      }
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ field construction
type Validated = { value: string; repaired?: boolean; notes?: string[]; confidenceBonus?: number; confidenceCap?: number; reasons?: string[] };

function resolve(documentId: string, field: ExtractedFieldName, candidates: Candidate[], validate: (candidate: Candidate, ocr: boolean) => Validated | null, extraReasons: (value: string) => string[] = () => []): ExtractedField {
  const empty = (status: ExtractedField["status"], note: string | null, needsReview: boolean, reasons: string[]): ExtractedField => ({
    documentId, field, status, value: null, page: null, line: null, confidence: 0, note, method: "EMBEDDED_TEXT", region: null, needsReview, reviewReasons: reasons
  });
  if (candidates.length === 0) return empty("NOT_FOUND", null, false, []);
  const valid = new Map<string, { candidate: Candidate; validated: Validated }>();
  let sawInvalid = false;
  const decidedGroups = new Set<number>();
  for (const candidate of [...candidates].sort((a, b) => a.group - b.group || a.tier - b.tier)) {
    // Alternatives for ONE label occurrence (same cell, cell to the right, cell below) are tried in order and the first
    // valid one wins; only values from different label occurrences can make a field ambiguous.
    if (decidedGroups.has(candidate.group)) continue;
    const ocr = candidate.method.startsWith("OCR");
    const validated = validate(candidate, ocr);
    if (!validated) { sawInvalid = true; continue; }
    decidedGroups.add(candidate.group);
    const key = validated.value.toUpperCase();
    const existing = valid.get(key);
    if (!existing || candidate.conf > existing.candidate.conf) valid.set(key, { candidate, validated });
  }
  if (valid.size === 0) return empty(sawInvalid ? "MALFORMED" : "NOT_FOUND", sawInvalid ? "A value was present but did not have the expected format." : null, sawInvalid, sawInvalid ? ["FAILED_VALIDATION"] : []);
  if (valid.size > 1) return empty("AMBIGUOUS", "More than one different value was found in this document.", true, ["MULTIPLE_CANDIDATES"]);
  const [{ candidate, validated }] = [...valid.values()];
  const ocr = candidate.method.startsWith("OCR");
  let confidence = ocr ? Math.min(candidate.conf, 0.92) : 0.92;
  confidence += validated.confidenceBonus ?? 0;
  confidence -= candidate.tier === 2 ? 0.01 : candidate.tier === 3 && !candidate.patternOnly ? 0.03 : 0;
  if (candidate.patternOnly) confidence = Math.min(confidence, 0.6);
  if (validated.confidenceCap !== undefined) confidence = Math.min(confidence, validated.confidenceCap);
  if (validated.repaired) confidence = Math.min(confidence, 0.7);
  confidence = Math.max(0, Math.min(0.99, Number(confidence.toFixed(3))));
  const reasons = [...(validated.reasons ?? []), ...extraReasons(validated.value)];
  if (validated.repaired) reasons.push("OCR_REPAIRED");
  if (candidate.patternOnly) reasons.push("NO_LABEL");
  if (ocr && SENSITIVE_IDENTIFIERS.has(field)) reasons.push("OCR_IDENTIFIER");
  else if (ocr && confidence < 0.9) reasons.push("OCR_LOW_CONFIDENCE");
  if (confidence < REVIEW_CONFIDENCE) reasons.push("LOW_CONFIDENCE");
  const method: ExtractionMethod = candidate.method.startsWith("OCR") ? "OCR" : candidate.method === "MIXED" ? "MIXED" : "EMBEDDED_TEXT";
  return {
    documentId, field, status: "EXTRACTED", value: validated.value, page: candidate.page, line: candidate.line, confidence, note: validated.notes?.join(" ") || null,
    method, region: candidate.region, needsReview: reasons.length > 0, reviewReasons: [...new Set(reasons)]
  };
}

/**
 * Finds a GSTIN anywhere in the text even when OCR damaged a character: any 15-character window that fits the template
 * after at most three classic confusions AND whose check character then validates. The check character makes this safe.
 */
function gstinWindowScan(pages: Page[]): Candidate[] {
  const out: Candidate[] = [];
  let group = 2_000_000;
  for (const page of pages) {
    page.lines.forEach((line, lineIndex) => {
      for (const segment of line.segments) {
        const compact = alnumUpper(segment.text);
        for (let start = 0; start + 15 <= compact.length; start += 1) {
          const window = compact.slice(start, start + 15);
          if (!/^[0-9OQDILTZSGB]{2}/.test(window)) continue;
          if (validateGstin(window, segment.method.startsWith("OCR"))) {
            out.push({ group: (group += 1), tier: 3, value: window, page: page.page, line: lineIndex + 1, region: segment.bbox as [number, number, number, number], conf: segment.conf, method: segment.method, patternOnly: true });
            break;
          }
        }
      }
    });
  }
  return out;
}

const gstinRe = /\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]/g;
const panRe = /[A-Z]{5}\d{4}[A-Z]/g;
const udyamRe = /UDYAM-?[A-Z]{2}-?\d{2}-?\d{7}/g;
const ifscRe = /[A-Z]{4}0[A-Z0-9]{6}/g;

const L = {
  gstin: "GSTIN(?:\\s*/\\s*UIN)?|GST\\s*(?:IDENTIFICATION|REGISTRATION)\\s*(?:NUMBER|NO\\.?)|REGISTRATION\\s*(?:NUMBER|NO\\.?)",
  legalName: "LEGAL\\s*NAME(?:\\s*OF\\s*(?:THE\\s*)?BUSINESS)?",
  tradeName: "TRADE\\s*NAME(?:\\s*[.,]?\\s*IF\\s*ANY)?",
  pan: "PERMANENT\\s*ACCOUNT\\s*NUMBER(?:\\s*\\(?PAN\\)?)?|PAN",
  regDate: "DATE\\s*OF\\s*(?:LIABILITY|REGISTRATION|UDYAM\\s*REGISTRATION)",
  udyam: "UDYAM\\s*REGISTRATION\\s*(?:NUMBER|NO\\.?)|UDYAM\\s*(?:NUMBER|NO\\.?)",
  enterprise: "NAME\\s*OF\\s*(?:THE\\s*)?ENTERPRISE",
  enterpriseType: "TYPE\\s*OF\\s*ENTERPRISE",
  holder: "ACCOUNT\\s*HOLDER(?:\\s*NAME)?|ACCOUNT\\s*NAME|NAME\\s*OF\\s*(?:THE\\s*)?ACCOUNT\\s*HOLDER|CUSTOMER\\s*NAME|A/C\\s*HOLDER(?:\\s*NAME)?",
  account: "ACCOUNT\\s*(?:NUMBER|NO\\.?)|A/C\\s*(?:NUMBER|NO\\.?)",
  ifsc: "IFSC(?:\\s*CODE)?",
  period: "STATEMENT\\s*PERIOD|PERIOD|STATEMENT\\s*(?:FROM|FOR)"
};

const dateValue = (raw: string): string | null => {
  const text = raw.trim();
  let m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(text);
  let day: number, month: number, year: number;
  if (m) { day = +m[1]; month = +m[2]; year = +m[3]; }
  else if ((m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(text))) { year = +m[1]; month = +m[2]; day = +m[3]; }
  else if ((m = /^(\d{1,2})[ \-]([A-Za-z]{3})[a-z]*[ \-,]*(\d{4})$/.exec(text))) { day = +m[1]; month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase()) + 1; year = +m[3]; }
  else return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  return month >= 1 && d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d.toISOString().slice(0, 10) : null;
};

const KNOWN_BANKS = ["STATE BANK OF INDIA", "HDFC BANK", "ICICI BANK", "AXIS BANK", "KOTAK MAHINDRA BANK", "BANK OF BARODA", "PUNJAB NATIONAL BANK", "CANARA BANK", "UNION BANK OF INDIA", "YES BANK", "IDFC FIRST BANK", "INDUSIND BANK", "BANK OF INDIA", "CENTRAL BANK OF INDIA", "INDIAN BANK", "UCO BANK", "FEDERAL BANK", "RBL BANK", "BANDHAN BANK", "INDIAN OVERSEAS BANK"];
const IFSC_BANK: Record<string, string> = { SBIN: "STATE BANK OF INDIA", HDFC: "HDFC BANK", ICIC: "ICICI BANK", UTIB: "AXIS BANK", KKBK: "KOTAK MAHINDRA BANK", BARB: "BANK OF BARODA", PUNB: "PUNJAB NATIONAL BANK", CNRB: "CANARA BANK", UBIN: "UNION BANK OF INDIA", YESB: "YES BANK", IDFB: "IDFC FIRST BANK", INDB: "INDUSIND BANK" };

function bankName(documentId: string, pages: Page[], ifsc: string | null): ExtractedField {
  const base = { documentId, field: "bankName" as const };
  const top = pages.length ? pages[0].lines.slice(0, 10) : [];
  for (const [index, line] of top.entries()) {
    for (const segment of line.segments) {
      const squashed = segment.text.toUpperCase().replace(/[^A-Z]/g, "");
      const hit = KNOWN_BANKS.find((bank) => squashed.includes(bank.replace(/ /g, "")));
      if (hit) {
        const ocr = segment.method.startsWith("OCR");
        const confidence = Number(Math.min(ocr ? segment.conf : 0.92, 0.95).toFixed(3));
        const corroborated = ifsc !== null && IFSC_BANK[ifsc.slice(0, 4)] === hit;
        const final = Math.min(0.99, confidence + (corroborated ? 0.03 : 0));
        return { ...base, status: "EXTRACTED", value: hit, page: pages[0].page, line: index + 1, confidence: final, note: corroborated ? "Agrees with the IFSC prefix." : null, method: ocr ? "OCR" : "EMBEDDED_TEXT", region: segment.bbox as [number, number, number, number], needsReview: final < REVIEW_CONFIDENCE, reviewReasons: final < REVIEW_CONFIDENCE ? ["LOW_CONFIDENCE"] : [] };
      }
    }
  }
  return { ...base, status: "NOT_FOUND", value: null, page: null, line: null, confidence: 0, note: null, method: "EMBEDDED_TEXT", region: null, needsReview: false, reviewReasons: [] };
}

function maskDigits(text: string): string {
  return text.replace(/\d{9,}/g, (run) => `${"*".repeat(run.length - 4)}${run.slice(-4)}`);
}

function mapTable(output: WorkerOutput): TransactionTable | null {
  const table = output.tables[0];
  if (!table) return null;
  const rows: TransactionRow[] = table.rows.slice(0, 200).map((row) => ({
    page: row.page, date: row.date, description: maskDigits(row.description), reference: row.reference ? maskDigits(row.reference) : null, debit: row.debit, credit: row.credit, balance: row.balance,
    balanceCheck: row.balanceCheck, confidence: row.confidence, method: row.method, region: row.bbox as [number, number, number, number]
  }));
  return { rowCount: table.rowCount, returnedRows: rows.length, balanceChecked: table.balanceChecked, balanceConsistent: table.balanceConsistent, reliable: table.reliable, openingBalance: table.openingBalance, columns: table.columns, rows };
}

const MARKERS: Record<string, RegExp> = {
  GST_CERTIFICATE: /GOODS\s*AND\s*SERVICES\s*TAX|GSTIN|\bGST\b|REGISTRATION\s*CERTIFICATE/i,
  UDYAM_CERTIFICATE: /UDYAM|MICRO,?\s*SMALL|MSME/i,
  BANK_STATEMENT: /STATEMENT\s*OF\s*ACCOUNT|ACCOUNT\s*STATEMENT|BANK\s*STATEMENT|IFSC|NARRATION|PARTICULARS/i
};
const CORE: Record<string, ExtractedFieldName[]> = { GST_CERTIFICATE: ["gstin", "legalName"], UDYAM_CERTIFICATE: ["udyamNumber", "enterpriseName"], BANK_STATEMENT: ["accountHolderName", "accountNumber"] };

export type DomainInput = { documentId: string; docType: DocumentType; output: WorkerOutput; wallMs: number };

export function extractDomainFields(input: DomainInput): DocumentExtraction {
  const { documentId, docType, output } = input;
  const pages = output.pages;
  const base: DocumentExtraction = {
    documentId, docType, status: "UNREADABLE", reason: null, fields: [], pageCount: output.pageCount, engine: "HYBRID", ocrPages: output.ocrPages, table: null, needsReview: false, elapsedMs: input.wallMs,
    pages: pages.map((page) => ({ page: page.page, method: page.method, columns: page.columns, ocrConfidence: page.ocr?.meanConfidence ?? null, rotationDegrees: page.ocr?.rotationDegrees ?? null, notes: page.notes }))
  };
  if (output.status === "UNSUPPORTED" || output.status === "REJECTED" || output.status === "UNREADABLE") return { ...base, status: output.status, reason: output.reason as DocumentExtraction["reason"] };

  const allText = pages.flatMap((page) => page.lines.map((line) => line.text)).join("\n");
  // Markers are also tried with whitespace removed (OCR fuses words), and a GSTIN whose check character validates is itself
  // enough to recognise a GST certificate whose heading was cropped out of a scan.
  const compactText = allText.replace(/\s+/g, "");
  const recognised = MARKERS[docType]?.test(allText) || MARKERS[docType]?.test(compactText) || (docType === "GST_CERTIFICATE" && gstinWindowScan(pages).length > 0);
  if (!recognised) return { ...base, status: "NOT_RECOGNISED", reason: "NOT_RECOGNISED" };

  const id = documentId;
  const fields: ExtractedField[] = [];
  const ocrHeavy = pages.some((page) => page.method === "OCR" || page.method === "MIXED");

  if (docType === "GST_CERTIFICATE") {
    const gstin = resolve(id, "gstin", associate(pages, L.gstin),
      (c, ocr) => { const v = validateGstin(c.value, ocr); return v ? { value: v.value, repaired: v.repaired, confidenceBonus: v.checksum ? 0.05 : 0, confidenceCap: v.checksum ? undefined : 0.4, reasons: v.checksum ? [] : ["CHECKSUM_FAILED"], notes: v.checksum ? [] : ["The GSTIN check character does not validate; the value may contain a typing or scanning error."] } : null; });
    // A pattern-only fallback is also tried when labelled candidates exist but none validated.
    const gstinFinal = gstin.status === "EXTRACTED" || gstin.status === "AMBIGUOUS" ? gstin : (() => {
      const retry = resolve(id, "gstin", [...patternScan(pages, gstinRe), ...gstinWindowScan(pages)], (c, ocr) => { const v = validateGstin(c.value, ocr); return v ? { value: v.value, repaired: v.repaired, confidenceCap: v.checksum ? undefined : 0.4, reasons: v.checksum ? [] : ["CHECKSUM_FAILED"] } : null; });
      return retry.status === "EXTRACTED" ? retry : gstin;
    })();
    fields.push(
      resolve(id, "legalName", associate(pages, L.legalName), (c) => { const v = cleanName(c.value); return v ? { value: v } : null; }),
      gstinFinal,
      resolve(id, "pan", (() => { const a = associate(pages, L.pan); return a.length ? a : patternScan(pages, panRe); })(), (c, ocr) => { const v = validatePan(c.value, ocr); return v ? { value: v.value, repaired: v.repaired, confidenceBonus: 0.02 } : null; },
        (value) => (gstinFinal.value && gstinFinal.value.slice(2, 12) !== value ? ["INCONSISTENT_WITH_GSTIN"] : [])),
      resolve(id, "tradeName", associate(pages, L.tradeName), (c) => { const v = cleanName(c.value); return v ? { value: v } : null; }),
      resolve(id, "registrationDate", associate(pages, L.regDate), (c) => { const v = dateValue(c.value.split(/\s{2,}/)[0]); return v ? { value: v } : null; })
    );
  } else if (docType === "UDYAM_CERTIFICATE") {
    fields.push(
      resolve(id, "udyamNumber", (() => { const a = associate(pages, L.udyam); return a.length ? a : patternScan(pages, udyamRe); })(), (c, ocr) => { const v = validateUdyam(c.value, ocr); return v ? { value: v.value, repaired: v.repaired } : null; }),
      resolve(id, "enterpriseName", associate(pages, L.enterprise), (c) => { const v = cleanName(c.value); return v ? { value: v } : null; }),
      resolve(id, "enterpriseType", associate(pages, L.enterpriseType), (c) => { const v = /MICRO|SMALL|MEDIUM/i.exec(c.value); return v ? { value: v[0][0].toUpperCase() + v[0].slice(1).toLowerCase() } : null; }),
      resolve(id, "registrationDate", associate(pages, L.regDate), (c) => { const v = dateValue(c.value.split(/\s{2,}/)[0]); return v ? { value: v } : null; })
    );
  } else {
    const ifsc = resolve(id, "ifsc", (() => { const a = associate(pages, L.ifsc); return a.length ? a : patternScan(pages, ifscRe); })(), (c, ocr) => { const v = validateIfsc(c.value, ocr); return v ? { value: v.value, repaired: v.repaired } : null; });
    const account = resolve(id, "accountNumber", associate(pages, L.account), (c) => { const v = validateAccount(c.value); return v ? { value: v.masked } : null; });
    const period = resolve(id, "statementPeriod", associate(pages, L.period), (c) => {
      const parts = c.value.split(/\s+(?:to|-|–|and)\s+|\s*(?:to)\s*/i).map((p) => dateValue(p.trim()));
      return parts.length >= 2 && parts[0] && parts[1] && parts[0] <= parts[1] ? { value: `${parts[0]}/${parts[1]}` } : null;
    });
    fields.push(
      resolve(id, "accountHolderName", associate(pages, L.holder), (c) => { const v = cleanName(c.value); return v ? { value: v } : null; }),
      account, ifsc, bankName(id, pages, ifsc.value), period
    );
  }

  const core = CORE[docType] ?? [];
  const coreFields = fields.filter((field) => core.includes(field.field));
  const usable = coreFields.filter((field) => field.status === "EXTRACTED").length;
  const table = docType === "BANK_STATEMENT" ? mapTable(output) : null;
  let status: ExtractionDocumentStatus = usable === 0 && !(table && table.rowCount > 0) ? "UNREADABLE" : usable === coreFields.length && output.status === "OK" ? "EXTRACTED" : "PARTIAL";
  if (docType === "BANK_STATEMENT" && usable === 0 && table) status = "PARTIAL";
  const lowOcr = pages.some((page) => (page.method === "OCR" || page.method === "MIXED") && (page.ocr?.meanConfidence ?? 1) < 0.85);
  return {
    ...base, status, reason: status === "UNREADABLE" ? "NO_EXTRACTABLE_TEXT" : (output.reason as DocumentExtraction["reason"]), fields, table,
    needsReview: fields.some((field) => field.needsReview) || lowOcr || (table !== null && !table.reliable && table.rowCount > 0) || (ocrHeavy && fields.some((f) => f.status === "AMBIGUOUS"))
  };
}
