// Types and plain-language mapping for the owner evidence review (GET /api/evidence-intelligence/review).
// Sensitive values arrive already masked from the server; nothing here unmasks or re-derives them.

export type ReviewClaim = "legalName" | "gstin" | "pan" | "udyamNumber" | "bankAccount";
export type ReconciliationStatus = "MATCHED" | "CONFLICTED" | "INSUFFICIENT" | "UNREADABLE";
export type ExtractionStatus = "EXTRACTED" | "PARTIAL" | "NOT_RECOGNISED" | "UNREADABLE" | "UNSUPPORTED" | "REJECTED";
export type DocumentIssueState = "MISSING" | "EXPIRED" | "UNREADABLE" | "UNSUPPORTED" | "REJECTED_FILE" | "NOT_RECOGNISED" | "ESSENTIAL_FIELD_UNCLEAR";
export type CorrectableClaim = "legalName" | "gstin" | "pan" | "udyamNumber";
export type CorrectionSource = "DOCUMENT_TEXT" | "GSTIN_EMBEDDED_PAN" | "ACCOUNT_ORGANIZATION_NAME";

export interface ReviewField { field: string; status: "EXTRACTED" | "AMBIGUOUS" | "MALFORMED" | "NOT_FOUND"; displayValue: string | null; page: number | null; line: number | null; confidence: number; note: string | null }
export interface ReviewDocument { documentId: string; docType: string; originalName: string; revision: number; lifecycleState: string; extractionStatus: ExtractionStatus; extractionReason: string | null; pageCount: number; fields: ReviewField[] }
export interface ReviewComparison { documentId: string; docType: string; sourceField: string; outcome: "MATCH" | "NEAR_MATCH" | "DIFFERENT" | "NOT_FOUND" | "UNREADABLE"; similarity: string | null; extractedDisplay: string | null; page: number | null; line: number | null; confidence: number }
export interface ReviewReconciliation { claim: ReviewClaim; status: ReconciliationStatus; declaredDisplay: string | null; summary: string; crossDocumentConflict: boolean; comparisons: ReviewComparison[] }
export interface SubmitAction { id: string; type: "SUBMIT_DOCUMENT"; docType: string; reason: DocumentIssueState; resolves: string[]; resolution: "CONDITIONAL_ON_NEW_DOCUMENT_CONTENT"; requiresOwnerConfirmation: false }
export interface CorrectAction { id: string; type: "CORRECT_CLAIM"; claim: CorrectableClaim; sourceDocumentId: string | null; source: CorrectionSource; proposedDisplay: string | null; resolves: string[]; resolution: "VERIFIED_BY_RULES"; requiresOwnerConfirmation: true }
export type ReviewAction = SubmitAction | CorrectAction;
export interface UnresolvedItem { issueId: string; reason: "NEEDS_HUMAN_REVIEW" | "DOCUMENTS_DISAGREE" | "NOT_SUPPORTED_BY_DESIGN"; message: string }
export interface ReviewBenchmark { fullPackDocuments: number; outstandingOnlyDocuments: number; plannedDocuments: number; plannedOwnerActions: number; openIssues: number; issuesClosedByPlan: number; issuesAddressedByOutstandingOnly: number; issuesAddressedByFullPack: number }
export interface EvidenceReview {
  generatedAt: string;
  sourceVerificationPerformed: false;
  limitations: string[];
  documents: ReviewDocument[];
  reconciliations: ReviewReconciliation[];
  issues: Array<{ id: string; kind: string }>;
  plan: { actions: ReviewAction[]; unresolved: UnresolvedItem[]; benchmark: ReviewBenchmark; objective: string; searched: number };
}

export const CLAIM_LABEL: Record<ReviewClaim, string> = { legalName: "Legal business name", gstin: "GSTIN", pan: "PAN", udyamNumber: "Udyam number", bankAccount: "Bank account" };
export const DOC_LABEL: Record<string, string> = { GST_CERTIFICATE: "GST certificate", UDYAM_CERTIFICATE: "Udyam certificate", BANK_STATEMENT: "Bank statement" };
export const FIELD_LABEL: Record<string, string> = { legalName: "Legal name", gstin: "GSTIN", pan: "PAN", udyamNumber: "Udyam number", enterpriseName: "Enterprise name", accountHolderName: "Account holder", accountNumber: "Account number", ifsc: "IFSC" };

export type Tone = "positive" | "info" | "neutral" | "warning" | "negative";
export interface Descriptor { label: string; tone: Tone; description: string }

export const RECONCILIATION: Record<ReconciliationStatus, Descriptor> = {
  MATCHED: { label: "Matches", tone: "positive", description: "The text of your document agrees with what you declared. This is not government verification." },
  CONFLICTED: { label: "Conflict", tone: "negative", description: "A document and your declaration disagree, or your documents disagree with each other." },
  INSUFFICIENT: { label: "Not enough evidence", tone: "neutral", description: "There is nothing readable to compare this against." },
  UNREADABLE: { label: "Couldn't read", tone: "warning", description: "A relevant document could not be read well enough to compare." },
};

export const EXTRACTION: Record<ExtractionStatus, Descriptor> = {
  EXTRACTED: { label: "Read", tone: "positive", description: "All expected fields were read from the file's text." },
  PARTIAL: { label: "Partly read", tone: "warning", description: "Some fields could not be read clearly." },
  NOT_RECOGNISED: { label: "Not recognised", tone: "warning", description: "The file does not look like this type of document." },
  UNREADABLE: { label: "Couldn't read", tone: "warning", description: "No usable text was found. Scanned images cannot be read (there is no OCR)." },
  UNSUPPORTED: { label: "Unsupported file", tone: "neutral", description: "Only text-based, unencrypted PDFs can be read." },
  REJECTED: { label: "Rejected as unsafe", tone: "negative", description: "The file exceeded safe processing limits and was not read." },
};

/** Lower-case form for use inside a sentence. */
export const DOC_SENTENCE: Record<string, string> = { GST_CERTIFICATE: "GST certificate", UDYAM_CERTIFICATE: "Udyam certificate", BANK_STATEMENT: "bank statement" };

const DOC_REASON: Record<DocumentIssueState, string> = {
  MISSING: "not uploaded yet",
  EXPIRED: "past its expiry date",
  UNREADABLE: "unreadable (it may be a scan or an image)",
  UNSUPPORTED: "not a readable text PDF",
  REJECTED_FILE: "rejected as unsafe to process",
  NOT_RECOGNISED: "not recognised as this type of document",
  ESSENTIAL_FIELD_UNCLEAR: "unclear in a key field, or a key field appears more than once",
};

export function actionTitle(action: ReviewAction): string {
  if (action.type === "SUBMIT_DOCUMENT") return `${action.reason === "MISSING" ? "Upload" : "Replace"} the ${DOC_SENTENCE[action.docType] ?? action.docType}`;
  return `Correct your ${CLAIM_LABEL[action.claim]}`;
}

export function actionDetail(action: ReviewAction): string {
  if (action.type === "SUBMIT_DOCUMENT") {
    const noun = DOC_SENTENCE[action.docType] ?? action.docType;
    const next = action.reason === "MISSING" ? "After you upload it" : "After you upload a replacement";
    return `Your ${noun} is ${DOC_REASON[action.reason]}. ${next}, Pramaan checks it again. Uploading does not by itself clear any conflict.`;
  }
  const where = action.source === "DOCUMENT_TEXT" ? "the text of your uploaded document" : action.source === "GSTIN_EMBEDDED_PAN" ? "the PAN embedded in your declared GSTIN" : "the organisation name on your account";
  return `Replace your declared ${CLAIM_LABEL[action.claim]} with ${action.proposedDisplay ?? "the proposed value"}, taken from ${where}. Pramaan re-ran its trust rules with this change and it clears the listed issues. You must confirm it.`;
}

export function issueLabel(id: string): string {
  if (id.startsWith("DOC:")) return `${DOC_LABEL[id.slice(4)] ?? id.slice(4)} evidence`;
  if (id.startsWith("CONFLICT:")) return `${CLAIM_LABEL[id.slice(9) as ReviewClaim] ?? id.slice(9)} conflict`;
  if (id === "GAP:bankAccount") return "Structured bank-account claim";
  return id;
}

export function benchmarkSentence(b: ReviewBenchmark): string {
  const asks = (n: number) => `${n} document${n === 1 ? "" : "s"}`;
  return `Asking for the full pack would mean ${asks(b.fullPackDocuments)}. A checklist of only missing or expired items would ask for ${asks(b.outstandingOnlyDocuments)}. This plan asks for ${asks(b.plannedDocuments)} and ${b.plannedOwnerActions - b.plannedDocuments} confirmed correction${b.plannedOwnerActions - b.plannedDocuments === 1 ? "" : "s"}.`;
}

/** Documents referenced by an action, so the UI can show where a proposal came from. */
export function sourceDocumentName(review: EvidenceReview, id: string | null): string | null {
  if (!id) return null;
  const document = review.documents.find((item) => item.documentId === id);
  return document ? `${DOC_LABEL[document.docType] ?? document.docType} (${document.originalName})` : null;
}
