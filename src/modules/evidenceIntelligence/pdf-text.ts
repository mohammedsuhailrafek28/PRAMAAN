// Bounded, dependency-free PDF text extraction.
//
// The PDF is untrusted input. This module never executes anything: no JavaScript, actions, launch or embedded files
// are interpreted, and nothing is fetched. It tolerates (rather than trusts) the file structure, so it does not rely on
// the cross-reference table, and every stage is bounded by an explicit counter (not a clock), so the same bytes always
// produce the same result.
//
// Supported: classic (non-compressed-object) PDFs whose page content streams are uncompressed or FlateDecode, with
// simple single-byte fonts. Everything else is reported explicitly (UNSUPPORTED / UNREADABLE / REJECTED / PARTIAL)
// instead of being guessed at: encryption, object streams, other stream filters, composite (Type0/CID) fonts and
// image-only (scanned) pages. There is no OCR.
//
// Reading text out of a PDF does not authenticate the document.

import { inflateSync } from "node:zlib";

export const PDF_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxObjects: 20_000,
  maxPages: 12,
  maxInflatedPerStream: 2 * 1024 * 1024,
  maxInflatedTotal: 8 * 1024 * 1024,
  maxContentOperations: 400_000,
  maxTextChars: 200_000,
  maxLineChars: 400,
  maxLines: 2_000
} as const;

export type PdfTextStatus = "OK" | "PARTIAL" | "UNREADABLE" | "UNSUPPORTED" | "REJECTED";

export type PdfReason =
  | "TOO_LARGE" | "NOT_A_PDF" | "ENCRYPTED" | "COMPRESSED_OBJECT_STREAMS" | "TOO_MANY_OBJECTS" | "DECOMPRESSION_LIMIT"
  | "NO_PAGES" | "NO_EXTRACTABLE_TEXT" | "UNSUPPORTED_FILTER" | "UNSUPPORTED_FONT" | "CORRUPT_STREAM" | "CONTENT_LIMIT"
  | "PAGE_LIMIT" | "PARSE_ERROR";

export type PdfPageText = { page: number; lines: string[] };

export type PdfTextResult = {
  status: PdfTextStatus;
  reason: PdfReason | null;
  pages: PdfPageText[];
  pageCount: number;
  truncated: boolean;
};

type PdfObject = { dict: string; streamStart: number; streamEnd: number };

const isDigit = (code: number) => code >= 48 && code <= 57;

function failure(status: PdfTextStatus, reason: PdfReason): PdfTextResult {
  return { status, reason, pages: [], pageCount: 0, truncated: false };
}

/** Printable Latin-1 only; control and exotic characters become spaces so extracted text is safe data. */
function sanitizeText(text: string): string {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    out += (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) ? text[index] : " ";
  }
  return out.replace(/ {2,}/g, " ").trim();
}

function parseObjects(source: string): Map<number, PdfObject> | PdfReason {
  const objects = new Map<number, PdfObject>();
  const header = /(\d{1,7})\s{1,3}(\d{1,5})\s{1,3}obj\b/g;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = header.exec(source)) !== null) {
    count += 1;
    if (count > PDF_LIMITS.maxObjects) return "TOO_MANY_OBJECTS";
    const id = Number(match[1]);
    const bodyStart = match.index + match[0].length;
    const streamKeyword = source.indexOf("stream", bodyStart);
    const endObject = source.indexOf("endobj", bodyStart);
    const limit = endObject === -1 ? source.length : endObject;
    let dict: string;
    let streamStart = -1;
    let streamEnd = -1;
    if (streamKeyword !== -1 && streamKeyword < limit + 1 && source.slice(Math.max(bodyStart, streamKeyword - 12), streamKeyword).indexOf("endstream") === -1) {
      dict = source.slice(bodyStart, streamKeyword);
      let dataStart = streamKeyword + 6;
      if (source[dataStart] === "\r" && source[dataStart + 1] === "\n") dataStart += 2;
      else if (source[dataStart] === "\n" || source[dataStart] === "\r") dataStart += 1;
      streamStart = dataStart;
      const declared = /\/Length\s+(\d{1,9})(?!\s+\d{1,5}\s+R)/.exec(dict);
      const declaredEnd = declared ? dataStart + Number(declared[1]) : -1;
      if (declaredEnd > dataStart && declaredEnd <= source.length && /^\s*endstream/.test(source.slice(declaredEnd, declaredEnd + 12))) streamEnd = declaredEnd;
      else {
        const found = source.indexOf("endstream", dataStart);
        streamEnd = found === -1 ? source.length : found;
      }
      header.lastIndex = Math.max(header.lastIndex, streamEnd);
    } else {
      dict = source.slice(bodyStart, limit);
    }
    if (dict.length > 40_000) dict = dict.slice(0, 40_000);
    if (!objects.has(id)) objects.set(id, { dict, streamStart, streamEnd });
  }
  return objects;
}

const refPattern = /(\d{1,7})\s+\d{1,5}\s+R/g;
function references(text: string): number[] {
  const ids: number[] = [];
  let match: RegExpExecArray | null;
  refPattern.lastIndex = 0;
  while ((match = refPattern.exec(text)) !== null && ids.length < 5_000) ids.push(Number(match[1]));
  return ids;
}

function pageOrder(objects: Map<number, PdfObject>): number[] {
  const isPage = (dict: string) => /\/Type\s*\/Page(?![A-Za-z])/.test(dict);
  const filePages = [...objects.entries()].filter(([, object]) => isPage(object.dict)).map(([id]) => id);
  const catalog = [...objects.values()].find((object) => /\/Type\s*\/Catalog(?![A-Za-z])/.test(object.dict));
  const rootRef = catalog ? /\/Pages\s+(\d{1,7})\s+\d{1,5}\s+R/.exec(catalog.dict) : null;
  if (!rootRef) return filePages;
  const ordered: number[] = [];
  const visited = new Set<number>();
  const walk = (id: number, depth: number) => {
    if (depth > 8 || visited.has(id) || ordered.length >= PDF_LIMITS.maxPages * 4) return;
    visited.add(id);
    const node = objects.get(id);
    if (!node) return;
    if (isPage(node.dict)) { ordered.push(id); return; }
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(node.dict);
    if (kids) for (const kid of references(kids[1])) walk(kid, depth + 1);
  };
  walk(Number(rootRef[1]), 0);
  return ordered.length > 0 ? ordered : filePages;
}

function pageContentRefs(page: PdfObject): number[] {
  const array = /\/Contents\s*\[([^\]]*)\]/.exec(page.dict);
  if (array) return references(array[1]);
  const single = /\/Contents\s+(\d{1,7})\s+\d{1,5}\s+R/.exec(page.dict);
  return single ? [Number(single[1])] : [];
}

function fontsOf(page: PdfObject, objects: Map<number, PdfObject>): Map<string, { composite: boolean }> {
  const fonts = new Map<string, { composite: boolean }>();
  let resources = page.dict;
  const resourceRef = /\/Resources\s+(\d{1,7})\s+\d{1,5}\s+R/.exec(page.dict);
  if (resourceRef) resources = objects.get(Number(resourceRef[1]))?.dict ?? "";
  let fontDict = "";
  const inline = /\/Font\s*<<([^>]*(?:>(?!>)[^>]*)*)>>/.exec(resources);
  if (inline) fontDict = inline[1];
  else {
    const fontRef = /\/Font\s+(\d{1,7})\s+\d{1,5}\s+R/.exec(resources);
    if (fontRef) fontDict = (objects.get(Number(fontRef[1]))?.dict ?? "").replace(/^\s*<<|>>\s*$/g, "");
  }
  const entry = /\/([A-Za-z0-9_.+-]{1,40})\s+(\d{1,7})\s+\d{1,5}\s+R/g;
  let match: RegExpExecArray | null;
  let guard = 0;
  while ((match = entry.exec(fontDict)) !== null && guard++ < 200) {
    const font = objects.get(Number(match[2]));
    fonts.set(match[1], { composite: font ? /\/Subtype\s*\/Type0(?![A-Za-z0-9])/.test(font.dict) : false });
  }
  return fonts;
}

type StreamResult = { ok: true; text: string } | { ok: false; reason: PdfReason };

function decodeStream(object: PdfObject, source: string, budget: { inflated: number }): StreamResult {
  if (object.streamStart < 0) return { ok: false, reason: "CORRUPT_STREAM" };
  const filter = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/.exec(object.dict);
  const raw = Buffer.from(source.slice(object.streamStart, object.streamEnd), "latin1");
  if (!filter) return { ok: true, text: raw.toString("latin1") };
  const names = (filter[1].match(/\/[A-Za-z0-9]+/g) ?? []);
  if (names.length !== 1 || (names[0] !== "/FlateDecode" && names[0] !== "/Fl")) return { ok: false, reason: "UNSUPPORTED_FILTER" };
  if (/\/DecodeParms|\/DP\b/.test(object.dict)) return { ok: false, reason: "UNSUPPORTED_FILTER" }; // predictors are not supported
  try {
    const inflated = inflateSync(raw, { maxOutputLength: PDF_LIMITS.maxInflatedPerStream });
    budget.inflated += inflated.length;
    if (budget.inflated > PDF_LIMITS.maxInflatedTotal) return { ok: false, reason: "DECOMPRESSION_LIMIT" };
    return { ok: true, text: inflated.toString("latin1") };
  } catch (error) {
    const code = (error as { code?: string }).code;
    return { ok: false, reason: code === "ERR_BUFFER_TOO_LARGE" || error instanceof RangeError ? "DECOMPRESSION_LIMIT" : "CORRUPT_STREAM" };
  }
}

type Piece = { y: number; x: number; text: string };

function decodeLiteral(content: string, start: number): { value: string; next: number } | null {
  let depth = 1;
  let out = "";
  let index = start + 1;
  while (index < content.length) {
    const char = content[index];
    if (char === "\\") {
      const following = content[index + 1];
      if (following === undefined) return null;
      if (isDigit(following.charCodeAt(0)) && following <= "7") {
        let octal = following;
        let taken = 1;
        while (taken < 3 && content[index + 1 + taken] !== undefined && content[index + 1 + taken] >= "0" && content[index + 1 + taken] <= "7") { octal += content[index + 1 + taken]; taken += 1; }
        out += String.fromCharCode(parseInt(octal, 8) & 0xff);
        index += 1 + taken;
        continue;
      }
      const escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
      if (following === "\r" || following === "\n") { index += following === "\r" && content[index + 2] === "\n" ? 3 : 2; continue; }
      out += escapes[following] ?? following;
      index += 2;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") { depth -= 1; if (depth === 0) return { value: out, next: index + 1 }; }
    out += char;
    index += 1;
  }
  return null;
}

function decodeHex(content: string, start: number): { value: string; next: number } | null {
  const end = content.indexOf(">", start + 1);
  if (end === -1) return null;
  let hex = content.slice(start + 1, end).replace(/\s+/g, "");
  if (!/^[0-9A-Fa-f]*$/.test(hex)) return null;
  if (hex.length % 2 === 1) hex += "0";
  let out = "";
  for (let index = 0; index < hex.length; index += 2) out += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16));
  return { value: out, next: end + 1 };
}

/** Walks one content stream, collecting positioned text pieces from simple single-byte fonts. */
function contentText(content: string, fonts: Map<string, { composite: boolean }>, budget: { operations: number }, flags: { unsupportedFont: boolean; limit: boolean }): Piece[] {
  const pieces: Piece[] = [];
  const operands: Array<string | number | string[]> = [];
  let x = 0, y = 0, lineX = 0, lineY = 0, leading = 0;
  let composite = false;
  let index = 0;
  const show = (text: string) => { if (!composite) pieces.push({ y: Math.round(y), x, text }); else flags.unsupportedFont = true; };
  while (index < content.length) {
    budget.operations += 1;
    if (budget.operations > PDF_LIMITS.maxContentOperations) { flags.limit = true; break; }
    const char = content[index];
    if (char === " " || char === "\n" || char === "\r" || char === "\t" || char === "\f" || char === "\0") { index += 1; continue; }
    if (char === "%") { const end = content.indexOf("\n", index); index = end === -1 ? content.length : end + 1; continue; }
    if (char === "(") { const parsed = decodeLiteral(content, index); if (!parsed) break; operands.push(parsed.value); index = parsed.next; continue; }
    if (char === "<" && content[index + 1] === "<") { const end = content.indexOf(">>", index + 2); index = end === -1 ? content.length : end + 2; operands.length = 0; continue; }
    if (char === "<") { const parsed = decodeHex(content, index); if (!parsed) { index += 1; continue; } operands.push(parsed.value); index = parsed.next; continue; }
    if (char === "[") {
      const items: string[] = [];
      index += 1;
      while (index < content.length && content[index] !== "]") {
        budget.operations += 1;
        if (budget.operations > PDF_LIMITS.maxContentOperations) { flags.limit = true; break; }
        const inner = content[index];
        if (inner === "(") { const parsed = decodeLiteral(content, index); if (!parsed) { index = content.length; break; } items.push(parsed.value); index = parsed.next; }
        else if (inner === "<") { const parsed = decodeHex(content, index); if (!parsed) { index += 1; } else { items.push(parsed.value); index = parsed.next; } }
        else if (inner === "-" || inner === "." || isDigit(inner.charCodeAt(0))) {
          let end = index + 1;
          while (end < content.length && (content[end] === "." || isDigit(content.charCodeAt(end)))) end += 1;
          const number = Number(content.slice(index, end));
          if (number < -200 && items.length > 0) items.push(" ");
          index = end;
        } else index += 1;
      }
      operands.push(items);
      index += 1;
      continue;
    }
    if (char === "/") {
      let end = index + 1;
      while (end < content.length && /[A-Za-z0-9_.+-]/.test(content[end])) end += 1;
      operands.push(content.slice(index, end));
      index = end;
      continue;
    }
    if (char === "-" || char === "+" || char === "." || isDigit(char.charCodeAt(0))) {
      let end = index + 1;
      while (end < content.length && (content[end] === "." || isDigit(content.charCodeAt(end)))) end += 1;
      operands.push(Number(content.slice(index, end)) || 0);
      index = end;
      continue;
    }
    let end = index;
    while (end < content.length && /[A-Za-z*'"]/.test(content[end])) end += 1;
    if (end === index) { index += 1; continue; }
    const operator = content.slice(index, end);
    index = end;
    const numbers = operands.filter((item): item is number => typeof item === "number");
    switch (operator) {
      case "BT": x = 0; y = 0; lineX = 0; lineY = 0; break;
      case "Tf": { const name = operands.find((item): item is string => typeof item === "string" && item.startsWith("/")); composite = name ? Boolean(fonts.get(name.slice(1))?.composite) : false; break; }
      case "Td": case "TD": if (numbers.length >= 2) { lineX += numbers[numbers.length - 2]; lineY += numbers[numbers.length - 1]; if (operator === "TD") leading = -numbers[numbers.length - 1]; x = lineX; y = lineY; } break;
      case "Tm": if (numbers.length >= 6) { lineX = numbers[4]; lineY = numbers[5]; x = lineX; y = lineY; } break;
      case "TL": if (numbers.length) leading = numbers[numbers.length - 1]; break;
      case "T*": lineY -= leading; x = lineX; y = lineY; break;
      case "Tj": { const text = operands.find((item): item is string => typeof item === "string" && !item.startsWith("/")); if (text !== undefined) show(text); break; }
      case "'": { lineY -= leading; x = lineX; y = lineY; const text = operands.find((item): item is string => typeof item === "string"); if (text !== undefined) show(text); break; }
      case '"': { lineY -= leading; x = lineX; y = lineY; const text = [...operands].reverse().find((item): item is string => typeof item === "string"); if (text !== undefined) show(text); break; }
      case "TJ": { const list = operands.find((item): item is string[] => Array.isArray(item)); if (list) show(list.join("")); break; }
      default: break;
    }
    operands.length = 0;
  }
  return pieces;
}

function linesFromPieces(pieces: Piece[]): string[] {
  const rows = new Map<number, Piece[]>();
  for (const piece of pieces) {
    const row = rows.get(piece.y);
    if (row) row.push(piece); else rows.set(piece.y, [piece]);
  }
  return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, row]) => sanitizeText(row.sort((a, b) => a.x - b.x).map((piece) => piece.text).join(" "))).filter((line) => line.length > 0);
}

/** Extracts text from a PDF buffer. Never throws. */
export function extractPdfText(buffer: Buffer): PdfTextResult {
  try {
    if (!Buffer.isBuffer(buffer)) return failure("UNREADABLE", "PARSE_ERROR");
    if (buffer.length > PDF_LIMITS.maxBytes) return failure("REJECTED", "TOO_LARGE");
    if (buffer.subarray(0, 1024).indexOf("%PDF-") === -1) return failure("UNSUPPORTED", "NOT_A_PDF");
    const source = buffer.toString("latin1");
    if (/\/Encrypt\b/.test(source.slice(-8192)) || /trailer[^]{0,2000}\/Encrypt\b/.test(source.slice(-16384))) return failure("UNSUPPORTED", "ENCRYPTED");

    const parsed = parseObjects(source);
    if (typeof parsed === "string") return failure("REJECTED", parsed);
    const objects = parsed;
    const order = pageOrder(objects);
    if (order.length === 0) {
      const hasObjectStreams = [...objects.values()].some((object) => /\/Type\s*\/ObjStm\b/.test(object.dict));
      return failure(hasObjectStreams ? "UNSUPPORTED" : "UNREADABLE", hasObjectStreams ? "COMPRESSED_OBJECT_STREAMS" : "NO_PAGES");
    }

    const budget = { inflated: 0 };
    const operations = { operations: 0 };
    const flags = { unsupportedFont: false, limit: false };
    const pages: PdfPageText[] = [];
    let totalChars = 0;
    let totalLines = 0;
    let degraded: PdfReason | null = null;
    const truncatedPages = order.length > PDF_LIMITS.maxPages;
    for (const [position, pageId] of order.slice(0, PDF_LIMITS.maxPages).entries()) {
      const page = objects.get(pageId) as PdfObject;
      const fonts = fontsOf(page, objects);
      const pieces: Piece[] = [];
      for (const contentId of pageContentRefs(page)) {
        const stream = objects.get(contentId);
        if (!stream) { degraded ??= "CORRUPT_STREAM"; continue; }
        const decoded = decodeStream(stream, source, budget);
        if (!decoded.ok) {
          if (decoded.reason === "DECOMPRESSION_LIMIT") return failure("REJECTED", "DECOMPRESSION_LIMIT");
          degraded ??= decoded.reason;
          continue;
        }
        pieces.push(...contentText(decoded.text, fonts, operations, flags));
        if (flags.limit) return failure("REJECTED", "CONTENT_LIMIT");
      }
      const lines: string[] = [];
      for (const line of linesFromPieces(pieces)) {
        const bounded = line.slice(0, PDF_LIMITS.maxLineChars);
        totalChars += bounded.length;
        totalLines += 1;
        if (totalChars > PDF_LIMITS.maxTextChars || totalLines > PDF_LIMITS.maxLines) return failure("REJECTED", "CONTENT_LIMIT");
        lines.push(bounded);
      }
      pages.push({ page: position + 1, lines });
    }
    const textual = pages.some((page) => page.lines.length > 0);
    if (!textual) return { status: "UNREADABLE", reason: flags.unsupportedFont ? "UNSUPPORTED_FONT" : degraded ?? "NO_EXTRACTABLE_TEXT", pages, pageCount: order.length, truncated: truncatedPages };
    const partialReason = flags.unsupportedFont ? "UNSUPPORTED_FONT" : degraded ?? (truncatedPages ? "PAGE_LIMIT" : null);
    return { status: partialReason ? "PARTIAL" : "OK", reason: partialReason, pages, pageCount: order.length, truncated: truncatedPages };
  } catch {
    return failure("UNREADABLE", "PARSE_ERROR");
  }
}
