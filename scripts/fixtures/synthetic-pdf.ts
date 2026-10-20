// Synthetic PDF builders for tests. All identifiers are fictional.
import { deflateSync } from "node:zlib";

type Options = { compress?: boolean; pages?: string[][]; font?: "Helvetica" | "Type0"; encrypt?: boolean };

const escapeText = (text: string) => text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function pageStream(lines: string[]): string {
  const ops = ["BT", "/F1 11 Tf", "14 TL", "40 780 Td"];
  lines.forEach((line, index) => {
    // Label and value are emitted as separate pieces on the same row, as many generators do.
    const split = line.indexOf(" : ");
    if (split > 0) ops.push(`(${escapeText(line.slice(0, split + 2))}) Tj`, "[ (" + escapeText(line.slice(split + 3)) + ") ] TJ");
    else ops.push(`(${escapeText(line)}) Tj`);
    if (index < lines.length - 1) ops.push("T*");
  });
  ops.push("ET");
  return ops.join("\n");
}

/** Builds a minimal classic PDF. Each page is a list of text lines. */
export function buildPdf(lines: string[] | string[][], options: Options = {}): Buffer {
  const pages = Array.isArray(lines[0]) ? (lines as string[][]) : [lines as string[]];
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = add("PAGES_PLACEHOLDER");
  const fontId = add(options.font === "Type0" ? "<< /Type /Font /Subtype /Type0 /BaseFont /Fake /Encoding /Identity-H >>" : "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  for (const page of pages) {
    const raw = Buffer.from(pageStream(page), "latin1");
    const data = options.compress ? deflateSync(raw) : raw;
    const contentId = objects.length + 2;
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    add(`<< /Length ${data.length}${options.compress ? " /Filter /FlateDecode" : ""} >>\nstream\n${data.toString("latin1")}\nendstream`);
  }
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => { offsets.push(out.length); out += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${options.encrypt ? " /Encrypt 99 0 R" : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export const gstCertificate = (v: { gstin: string; legalName: string; pan?: string; extra?: string[] }) => [
  "Government of India",
  "Form GST REG-06 - Registration Certificate",
  `Registration Number : ${v.gstin}`,
  `Legal Name : ${v.legalName}`,
  ...(v.pan ? [`Permanent Account Number (PAN) : ${v.pan}`] : []),
  "Constitution of Business : Private Limited Company",
  ...(v.extra ?? [])
];

export const udyamCertificate = (v: { number: string; name: string; extra?: string[] }) => [
  "Ministry of Micro, Small and Medium Enterprises",
  "UDYAM REGISTRATION CERTIFICATE",
  `Udyam Registration Number : ${v.number}`,
  `Name of Enterprise : ${v.name}`,
  "Type of Enterprise : Micro",
  ...(v.extra ?? [])
];

export const bankStatement = (v: { holder: string; account: string; ifsc: string; extra?: string[] }) => [
  "Statement of Account",
  `Account Holder : ${v.holder}`,
  `Account Number : ${v.account}`,
  `IFSC Code : ${v.ifsc}`,
  "Period : 01-04-2026 to 30-09-2026",
  ...(v.extra ?? [])
];

/** A valid GSTIN (with correct check character) for a given state, PAN and entity number. */
export function makeGstin(state: string, pan: string, entity = "1"): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const body = `${state}${pan}${entity}Z`;
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const product = alphabet.indexOf(body[index]) * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return body + alphabet[(36 - (sum % 36)) % 36];
}
