// Deterministic, label-anchored field extraction for the three supported document types.
//
// Document text is untrusted DATA. It is only ever matched against fixed, anchored patterns; it is never interpreted
// as an instruction, never evaluated, and values are length-bounded and format-validated before being returned.
// A successful extraction means "this text appeared in the file". It does NOT authenticate the document, and no
// external source is consulted.

import type { DocumentType } from "@prisma/client";
import { extractPdfText, type PdfPageText, type PdfReason } from "./pdf-text.js";

export type ExtractedFieldName = "legalName" | "gstin" | "pan" | "udyamNumber" | "enterpriseName" | "accountHolderName" | "accountNumber" | "ifsc";
export type ExtractionFieldStatus = "EXTRACTED" | "AMBIGUOUS" | "MALFORMED" | "NOT_FOUND";
export type ExtractionDocumentStatus = "EXTRACTED" | "PARTIAL" | "NOT_RECOGNISED" | "UNREADABLE" | "UNSUPPORTED" | "REJECTED";

export type ExtractedField = {
  documentId: string;
  field: ExtractedFieldName;
  status: ExtractionFieldStatus;
  /** Internal only. Never serialise, log or notify this raw value; use the display value from the serializer. */
  value: string | null;
  page: number | null;
  line: number | null;
  confidence: number;
  note: string | null;
};

export type DocumentExtraction = {
  documentId: string;
  docType: DocumentType;
  status: ExtractionDocumentStatus;
  reason: PdfReason | "TYPE_NOT_SUPPORTED" | "NOT_A_PDF" | "NOT_RECOGNISED" | null;
  fields: ExtractedField[];
  pageCount: number;
};

export const SUPPORTED_EXTRACTION_TYPES: ReadonlySet<DocumentType> = new Set<DocumentType>(["GST_CERTIFICATE", "UDYAM_CERTIFICATE", "BANK_STATEMENT"]);

const GSTIN = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/g;
const PAN = /\b([A-Z]{5}\d{4}[A-Z])\b/g;
const UDYAM = /\b(UDYAM-[A-Z]{2}-\d{2}-\d{7})\b/g;
const IFSC = /\b([A-Z]{4}0[A-Z0-9]{6})\b/g;
const MAX_VALUE = 120;

type Located = { page: number; line: number; text: string };

function flatten(pages: PdfPageText[]): Located[] {
  const out: Located[] = [];
  for (const page of pages) page.lines.forEach((text, index) => out.push({ page: page.page, line: index + 1, text }));
  return out;
}

/** Value following a label on the same line, or on the next line when the label stands alone. */
function labelled(lines: Located[], label: RegExp): Array<{ value: string; at: Located }> {
  const found: Array<{ value: string; at: Located }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = new RegExp(`^(?:${label.source})\\s*[:\\-]?\\s*(.*)$`, "i").exec(lines[index].text);
    if (!match) continue;
    let value = match[1].trim();
    if (value.length === 0 && lines[index + 1]) value = lines[index + 1].text.trim();
    if (value.length > 0) found.push({ value: value.slice(0, MAX_VALUE), at: lines[index] });
  }
  return found;
}

function pick(documentId: string, field: ExtractedFieldName, candidates: Array<{ value: string; at: Located; confidence: number; note?: string }>, accept: (value: string) => string | null): ExtractedField {
  const valid = new Map<string, { at: Located; confidence: number; note?: string }>();
  let malformed = false;
  for (const candidate of candidates) {
    const normalised = accept(candidate.value);
    if (normalised === null) { malformed = true; continue; }
    if (!valid.has(normalised)) valid.set(normalised, candidate);
  }
  if (valid.size === 0) {
    return { documentId, field, status: malformed ? "MALFORMED" : "NOT_FOUND", value: null, page: null, line: null, confidence: 0, note: malformed ? "A value was present but did not have the expected format." : null };
  }
  if (valid.size > 1) {
    return { documentId, field, status: "AMBIGUOUS", value: null, page: null, line: null, confidence: 0, note: "More than one different value was found in this document." };
  }
  const [[value, where]] = [...valid.entries()];
  return { documentId, field, status: "EXTRACTED", value, page: where.at.page, line: where.at.line, confidence: where.confidence, note: where.note ?? null };
}

function matches(lines: Located[], pattern: RegExp): Array<{ value: string; at: Located }> {
  const out: Array<{ value: string; at: Located }> = [];
  for (const line of lines) {
    const upper = line.text.toUpperCase();
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(upper)) !== null && out.length < 50) out.push({ value: match[1], at: line });
  }
  return out;
}

const gstinChecksumValid = (gstin: string) => {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const code = alphabet.indexOf(gstin[index]);
    const product = code * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return alphabet[(36 - (sum % 36)) % 36] === gstin[14];
};

const cleanName = (value: string) => {
  const name = value.replace(/\s+/g, " ").trim();
  return name.length >= 2 && name.length <= MAX_VALUE && /[A-Za-z]/.test(name) && !/[<>{}\\]/.test(name) ? name : null;
};

function labelledOrPattern(lines: Located[], label: RegExp, pattern: RegExp, valuePattern: RegExp) {
  const candidates: Array<{ value: string; at: Located; confidence: number; note?: string }> = [];
  for (const item of labelled(lines, label)) {
    const found = valuePattern.exec(item.value.toUpperCase().replace(/\s+/g, ""));
    candidates.push({ value: found ? found[0] : item.value, at: item.at, confidence: 0.9 });
  }
  if (candidates.length === 0) for (const item of matches(lines, pattern)) candidates.push({ ...item, confidence: 0.55, note: "Found by format only; no label was present." });
  return candidates;
}

function gstFields(id: string, lines: Located[]): ExtractedField[] {
  const gstin = pick(id, "gstin", labelledOrPattern(lines, /(?:GSTIN(?:\/UIN)?|GST (?:IDENTIFICATION|REGISTRATION) (?:NUMBER|NO\.?)|REGISTRATION (?:NUMBER|NO\.?))/, GSTIN, /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/), (value) => {
    const normalised = value.toUpperCase().replace(/\s+/g, "");
    return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(normalised) ? normalised : null;
  });
  if (gstin.value && !gstinChecksumValid(gstin.value)) {
    gstin.confidence = Math.min(gstin.confidence, 0.5);
    gstin.note = "The GSTIN check character does not validate; the value may contain a typing or scanning error.";
  }
  const legalName = pick(id, "legalName", labelled(lines, /LEGAL NAME(?: OF (?:THE )?BUSINESS)?/).map((item) => ({ ...item, confidence: 0.9 })), cleanName);
  const pan = pick(id, "pan", labelledOrPattern(lines, /(?:PERMANENT ACCOUNT NUMBER(?: \(PAN\))?|PAN)/, PAN, /^[A-Z]{5}\d{4}[A-Z]$/), (value) => {
    const normalised = value.toUpperCase().replace(/\s+/g, "");
    return /^[A-Z]{5}\d{4}[A-Z]$/.test(normalised) ? normalised : null;
  });
  return [legalName, gstin, pan];
}

function udyamFields(id: string, lines: Located[]): ExtractedField[] {
  const number = pick(id, "udyamNumber", labelledOrPattern(lines, /(?:UDYAM REGISTRATION (?:NUMBER|NO\.?)|UDYAM (?:NUMBER|NO\.?))/, UDYAM, /UDYAM-[A-Z]{2}-\d{2}-\d{7}/), (value) => {
    const normalised = value.toUpperCase().replace(/\s+/g, "").replace(/[‐-―]/g, "-");
    return /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(normalised) ? normalised : null;
  });
  const name = pick(id, "enterpriseName", labelled(lines, /NAME OF (?:THE )?ENTERPRISE/).map((item) => ({ ...item, confidence: 0.9 })), cleanName);
  return [number, name];
}

function bankFields(id: string, lines: Located[]): ExtractedField[] {
  const holder = pick(id, "accountHolderName", labelled(lines, /(?:ACCOUNT HOLDER(?: NAME)?|ACCOUNT NAME|NAME OF (?:THE )?ACCOUNT HOLDER|CUSTOMER NAME)/).map((item) => ({ ...item, confidence: 0.9 })), cleanName);
  const account = pick(id, "accountNumber", labelled(lines, /(?:ACCOUNT (?:NUMBER|NO\.?)|A\/C (?:NUMBER|NO\.?))/).map((item) => ({ ...item, confidence: 0.9 })), (value) => {
    const digits = value.replace(/[\s-]/g, "");
    return /^\d{9,18}$/.test(digits) ? digits : null;
  });
  const ifsc = pick(id, "ifsc", labelledOrPattern(lines, /(?:IFSC(?: CODE)?)/, IFSC, /^[A-Z]{4}0[A-Z0-9]{6}$/), (value) => {
    const normalised = value.toUpperCase().replace(/\s+/g, "");
    return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalised) ? normalised : null;
  });
  return [holder, account, ifsc];
}

const MARKERS: Record<string, RegExp> = {
  GST_CERTIFICATE: /GOODS AND SERVICES TAX|\bGSTIN\b|\bGST\b/i,
  UDYAM_CERTIFICATE: /UDYAM|MINISTRY OF (?:MICRO|MSME)/i,
  BANK_STATEMENT: /STATEMENT OF ACCOUNT|ACCOUNT STATEMENT|BANK STATEMENT|\bIFSC\b/i
};

/** Extracts structured facts from one stored file. Never throws; never returns raw text. */
export function extractDocument(input: { documentId: string; docType: DocumentType; mimeType: string; bytes: Buffer }): DocumentExtraction {
  const base = { documentId: input.documentId, docType: input.docType, fields: [] as ExtractedField[], pageCount: 0 };
  if (!SUPPORTED_EXTRACTION_TYPES.has(input.docType)) return { ...base, status: "UNSUPPORTED", reason: "TYPE_NOT_SUPPORTED" };
  if (input.mimeType !== "application/pdf") return { ...base, status: "UNSUPPORTED", reason: "NOT_A_PDF" };
  const text = extractPdfText(input.bytes);
  base.pageCount = text.pageCount;
  if (text.status === "UNSUPPORTED" || text.status === "REJECTED" || text.status === "UNREADABLE") {
    return { ...base, status: text.status, reason: text.reason };
  }
  const lines = flatten(text.pages);
  if (!lines.some((line) => MARKERS[input.docType].test(line.text))) return { ...base, status: "NOT_RECOGNISED", reason: "NOT_RECOGNISED" };
  const fields = input.docType === "GST_CERTIFICATE" ? gstFields(input.documentId, lines) : input.docType === "UDYAM_CERTIFICATE" ? udyamFields(input.documentId, lines) : bankFields(input.documentId, lines);
  const usable = fields.filter((field) => field.status === "EXTRACTED").length;
  const complete = usable === fields.length && text.status === "OK";
  return { ...base, fields, status: usable === 0 ? "UNREADABLE" : complete ? "EXTRACTED" : "PARTIAL", reason: usable === 0 ? "NO_EXTRACTABLE_TEXT" : text.reason };
}
