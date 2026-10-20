// Reconciles values extracted from submitted documents against the MSME's own declared claims.
//
// Pure and deterministic. It never changes a claim: normalisation is applied to a COPY used for comparison only, and
// legal identifiers (GSTIN, PAN, Udyam number) are compared exactly after trimming/upper-casing/whitespace removal.
// "MATCHED" means the document text agrees with the declaration; it does not mean either is true or government-verified.

import type { DocumentType } from "@prisma/client";
import type { DocumentExtraction, ExtractedField, ExtractedFieldName } from "./field-extractors.js";

export type ReconciledClaim = "legalName" | "gstin" | "pan" | "udyamNumber" | "bankAccount";
export type ReconciliationStatus = "MATCHED" | "CONFLICTED" | "INSUFFICIENT" | "UNREADABLE";
export type ComparisonOutcome = "MATCH" | "NEAR_MATCH" | "DIFFERENT" | "NOT_FOUND" | "UNREADABLE";
export type Similarity = "EXACT" | "NORMALIZED" | "NEAR" | "DIFFERENT";

export type DeclaredClaims = { legalName: string | null; gstin: string | null; pan: string | null; udyamNumber: string | null };

export type Comparison = {
  documentId: string;
  docType: DocumentType;
  sourceField: ExtractedFieldName;
  outcome: ComparisonOutcome;
  similarity: Similarity | null;
  /** Internal raw extracted value; callers must serialise through `displayValue`. */
  extractedValue: string | null;
  page: number | null;
  line: number | null;
  confidence: number;
};

export type ClaimReconciliation = {
  claim: ReconciledClaim;
  status: ReconciliationStatus;
  declaredValue: string | null;
  comparisons: Comparison[];
  /** Extracted documents disagree among themselves (distinct values) regardless of the declaration. */
  crossDocumentConflict: boolean;
  summary: string;
};

export const SENSITIVE_CLAIMS: ReadonlySet<string> = new Set(["pan", "accountNumber", "bankAccount"]);

/** Masks identifiers that must not appear in full in logs, notifications or requester-facing output. */
export function maskPan(value: string | null): string | null {
  if (!value) return null;
  return value.length === 10 ? `${value.slice(0, 2)}${"*".repeat(6)}${value.slice(8)}` : "*".repeat(Math.min(value.length, 10));
}
export function maskAccount(value: string | null): string | null {
  if (!value) return null;
  return value.length > 4 ? `${"*".repeat(Math.min(value.length - 4, 12))}${value.slice(-4)}` : "*".repeat(value.length);
}
/** A GSTIN embeds the PAN in characters 3-12, so it is masked the same way when shown outside the owner's own session. */
export function maskGstin(value: string | null): string | null {
  return value && value.length === 15 ? `${value.slice(0, 2)}${"*".repeat(6)}${value.slice(8)}` : value ? "*".repeat(Math.min(value.length, 15)) : null;
}

export function displayValue(field: ExtractedFieldName | ReconciledClaim, value: string | null): string | null {
  if (value === null) return null;
  if (field === "pan") return maskPan(value);
  if (field === "accountNumber" || field === "bankAccount") return maskAccount(value);
  return value;
}

const identifier = (value: string | null | undefined) => (value ?? "").toUpperCase().replace(/[\s‐-―]+/g, (m) => (m.match(/[‐-―]/) ? "-" : "")).trim();

const SUFFIXES: Array<[RegExp, string]> = [
  [/\bPRIVATE LIMITED\b/g, "PVT LTD"], [/\bPVT\.? LTD\.?\b/g, "PVT LTD"], [/\bPRIVATE LTD\b/g, "PVT LTD"], [/\bPVT LIMITED\b/g, "PVT LTD"],
  [/\bLIMITED\b/g, "LTD"], [/\bAND\b/g, "&"]
];
/** Comparison-only name normalisation: case, punctuation, whitespace, common company-suffix spellings. */
export function normalizeNameForComparison(value: string | null | undefined): string {
  let name = (value ?? "").toUpperCase().replace(/[.,'"()]/g, " ").replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of SUFFIXES) name = name.replace(pattern, replacement);
  return name.replace(/\s+/g, " ").trim();
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length];
}

export function compareNames(declared: string, extracted: string): Similarity {
  if (declared.trim().toUpperCase() === extracted.trim().toUpperCase()) return "EXACT";
  const a = normalizeNameForComparison(declared);
  const b = normalizeNameForComparison(extracted);
  if (a === b && a.length > 0) return "NORMALIZED";
  const longest = Math.max(a.length, b.length);
  if (longest > 0 && longest <= 200 && 1 - editDistance(a, b) / longest >= 0.85) return "NEAR";
  return "DIFFERENT";
}

function compareIdentifier(declared: string, extracted: string): Similarity {
  if (declared.trim() === extracted.trim()) return "EXACT";
  return identifier(declared) === identifier(extracted) ? "NORMALIZED" : "DIFFERENT";
}

/** Document fields that carry evidence for each declared claim. */
const SOURCES: Record<Exclude<ReconciledClaim, "bankAccount">, Array<{ docType: DocumentType; field: ExtractedFieldName }>> = {
  legalName: [{ docType: "GST_CERTIFICATE", field: "legalName" }, { docType: "UDYAM_CERTIFICATE", field: "enterpriseName" }, { docType: "BANK_STATEMENT", field: "accountHolderName" }],
  gstin: [{ docType: "GST_CERTIFICATE", field: "gstin" }],
  pan: [{ docType: "GST_CERTIFICATE", field: "pan" }],
  udyamNumber: [{ docType: "UDYAM_CERTIFICATE", field: "udyamNumber" }]
};

function outcomeFor(claim: ReconciledClaim, declared: string, field: ExtractedField): { outcome: ComparisonOutcome; similarity: Similarity | null } {
  if (field.status !== "EXTRACTED" || field.value === null) return { outcome: field.status === "NOT_FOUND" ? "NOT_FOUND" : "UNREADABLE", similarity: null };
  const similarity = claim === "legalName" ? compareNames(declared, field.value) : compareIdentifier(declared, field.value);
  if (similarity === "EXACT" || similarity === "NORMALIZED") return { outcome: "MATCH", similarity };
  return { outcome: similarity === "NEAR" ? "NEAR_MATCH" : "DIFFERENT", similarity };
}

function reconcileClaim(claim: Exclude<ReconciledClaim, "bankAccount">, declared: string | null, extractions: DocumentExtraction[]): ClaimReconciliation {
  const trimmed = declared && declared.trim().length > 0 ? declared : null;
  const comparisons: Comparison[] = [];
  let documentSeen = false;
  let documentUnreadable = false;
  for (const source of SOURCES[claim]) {
    for (const extraction of extractions.filter((item) => item.docType === source.docType)) {
      documentSeen = true;
      const field = extraction.fields.find((item) => item.field === source.field);
      if (!field) {
        documentUnreadable = true;
        comparisons.push({ documentId: extraction.documentId, docType: source.docType, sourceField: source.field, outcome: "UNREADABLE", similarity: null, extractedValue: null, page: null, line: null, confidence: 0 });
        continue;
      }
      const { outcome, similarity } = trimmed ? outcomeFor(claim, trimmed, field) : { outcome: field.status === "EXTRACTED" ? ("MATCH" as const) : field.status === "NOT_FOUND" ? ("NOT_FOUND" as const) : ("UNREADABLE" as const), similarity: null };
      if (outcome === "UNREADABLE") documentUnreadable = true;
      comparisons.push({ documentId: extraction.documentId, docType: source.docType, sourceField: source.field, outcome: trimmed ? outcome : outcome === "MATCH" ? "NOT_FOUND" : outcome, similarity, extractedValue: field.value, page: field.page, line: field.line, confidence: field.confidence });
    }
  }
  const extracted = comparisons.filter((item) => item.extractedValue !== null);
  const distinctExtracted = new Set(extracted.map((item) => (claim === "legalName" ? normalizeNameForComparison(item.extractedValue) : identifier(item.extractedValue))));
  let crossDocumentConflict = distinctExtracted.size > 1;
  if (claim === "pan") {
    // The PAN printed on a GST certificate must agree with the PAN embedded in that certificate's own GSTIN.
    for (const extraction of extractions.filter((item) => item.docType === "GST_CERTIFICATE")) {
      const gstin = extraction.fields.find((item) => item.field === "gstin" && item.status === "EXTRACTED")?.value;
      const pan = extraction.fields.find((item) => item.field === "pan" && item.status === "EXTRACTED")?.value;
      if (gstin && pan && gstin.slice(2, 12) !== pan) crossDocumentConflict = true;
    }
  }
  const base = { claim, declaredValue: trimmed, comparisons, crossDocumentConflict };

  if (!trimmed) return { ...base, status: extracted.length > 0 ? "INSUFFICIENT" : documentUnreadable ? "UNREADABLE" : "INSUFFICIENT", summary: "No declared value to compare against." };
  if (comparisons.some((item) => item.outcome === "DIFFERENT" || item.outcome === "NEAR_MATCH")) {
    const near = comparisons.every((item) => item.outcome !== "DIFFERENT");
    return { ...base, status: "CONFLICTED", summary: near ? "A document value is close to, but not the same as, the declaration." : "A document value differs from the declaration." };
  }
  if (crossDocumentConflict) return { ...base, status: "CONFLICTED", summary: "Submitted documents disagree with each other." };
  if (comparisons.some((item) => item.outcome === "MATCH")) return { ...base, status: "MATCHED", summary: "Document text agrees with the declaration. This is not source verification." };
  if (documentUnreadable) return { ...base, status: "UNREADABLE", summary: "A relevant document could not be read well enough to compare." };
  return { ...base, status: "INSUFFICIENT", summary: documentSeen ? "A relevant document was read but did not contain this value." : "No relevant document has been submitted." };
}

function reconcileBank(extractions: DocumentExtraction[]): ClaimReconciliation {
  const banks = extractions.filter((item) => item.docType === "BANK_STATEMENT");
  const number = banks.flatMap((item) => item.fields).find((item) => item.field === "accountNumber" && item.status === "EXTRACTED");
  const unreadable = banks.some((item) => item.status === "UNREADABLE" || item.status === "UNSUPPORTED" || item.status === "REJECTED" || item.status === "NOT_RECOGNISED");
  const comparisons: Comparison[] = number
    ? [{ documentId: number.documentId, docType: "BANK_STATEMENT", sourceField: "accountNumber", outcome: "NOT_FOUND", similarity: null, extractedValue: number.value, page: number.page, line: number.line, confidence: number.confidence }]
    : [];
  return {
    claim: "bankAccount",
    status: number ? "INSUFFICIENT" : unreadable ? "UNREADABLE" : "INSUFFICIENT",
    declaredValue: null,
    comparisons,
    crossDocumentConflict: false,
    summary: number ? "An account number was read from the statement, but Pramaan holds no declared bank-account claim to compare it with." : unreadable ? "The bank statement could not be read well enough to extract an account number." : "No bank statement has been submitted."
  };
}

export function reconcileClaims(claims: DeclaredClaims, extractions: DocumentExtraction[]): ClaimReconciliation[] {
  return [
    reconcileClaim("legalName", claims.legalName, extractions),
    reconcileClaim("gstin", claims.gstin, extractions),
    reconcileClaim("pan", claims.pan, extractions),
    reconcileClaim("udyamNumber", claims.udyamNumber, extractions),
    reconcileBank(extractions)
  ];
}
