// Types and plain-language mapping for the owner evidence review. Reading documents is slow, so the review is produced by a
// background JOB (POST /api/evidence-intelligence/jobs, then poll GET /jobs/:id); the review arrives with the finished job.
// Sensitive values arrive already masked from the server; nothing here unmasks or re-derives them.

export type ReviewClaim = "legalName" | "gstin" | "pan" | "udyamNumber" | "bankAccount";
export type ReconciliationStatus = "MATCHED" | "CONFLICTED" | "INSUFFICIENT" | "UNREADABLE";
export type ExtractionStatus = "EXTRACTED" | "PARTIAL" | "NOT_RECOGNISED" | "UNREADABLE" | "UNSUPPORTED" | "REJECTED";
export type DocumentIssueState = "MISSING" | "EXPIRED" | "UNREADABLE" | "UNSUPPORTED" | "REJECTED_FILE" | "NOT_RECOGNISED" | "ESSENTIAL_FIELD_UNCLEAR";
export type CorrectableClaim = "legalName" | "gstin" | "pan" | "udyamNumber";
export type CorrectionSource = "DOCUMENT_TEXT" | "GSTIN_EMBEDDED_PAN" | "ACCOUNT_ORGANIZATION_NAME";

export type ReadMethod = "EMBEDDED_TEXT" | "OCR" | "MIXED" | "LEGACY_PDF_PARSER";
export interface ReviewField { field: string; status: "EXTRACTED" | "AMBIGUOUS" | "MALFORMED" | "NOT_FOUND"; displayValue: string | null; page: number | null; line: number | null; confidence: number; note: string | null; method: ReadMethod; region: [number, number, number, number] | null; needsReview: boolean; reviewReasons: string[] }
export interface ReviewTablePreviewRow { page: number; date: string | null; description: string; debit: number | null; credit: number | null; balance: number | null; balanceCheck: "PASSED" | "FAILED" | "NOT_APPLICABLE"; confidence: number }
export interface ReviewTable { rowCount: number; balanceChecked: number; balanceConsistent: number; reliable: boolean; preview: ReviewTablePreviewRow[] }
export interface ReviewDocument { documentId: string; docType: string; originalName: string; revision: number; lifecycleState: string; extractionStatus: ExtractionStatus; extractionReason: string | null; pageCount: number; engine: "HYBRID" | "LEGACY"; ocrPages: number; needsReview: boolean; pages: Array<{ page: number; method: string; ocrConfidence: number | null; rotationDegrees: number | null }>; table: ReviewTable | null; fields: ReviewField[] }
export interface ReviewComparison { documentId: string; docType: string; sourceField: string; outcome: "MATCH" | "NEAR_MATCH" | "DIFFERENT" | "NOT_FOUND" | "UNREADABLE" | "UNCERTAIN"; similarity: string | null; extractedDisplay: string | null; page: number | null; line: number | null; confidence: number; method: ReadMethod; needsReview: boolean }
export interface ReviewReconciliation { claim: ReviewClaim; status: ReconciliationStatus; declaredDisplay: string | null; summary: string; crossDocumentConflict: boolean; needsOwnerReview: boolean; comparisons: ReviewComparison[] }
export interface SubmitAction { id: string; type: "SUBMIT_DOCUMENT"; docType: string; reason: DocumentIssueState; resolves: string[]; resolution: "CONDITIONAL_ON_NEW_DOCUMENT_CONTENT"; requiresOwnerConfirmation: false }
export interface CorrectAction { id: string; type: "CORRECT_CLAIM"; claim: CorrectableClaim; sourceDocumentId: string | null; source: CorrectionSource; proposedDisplay: string | null; resolves: string[]; resolution: "VERIFIED_BY_RULES"; requiresOwnerConfirmation: true }
export type ReviewAction = SubmitAction | CorrectAction;
export interface UnresolvedItem { issueId: string; reason: "READING_UNCERTAIN" | "NEEDS_HUMAN_REVIEW" | "DOCUMENTS_DISAGREE" | "NOT_SUPPORTED_BY_DESIGN"; message: string }
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
export const FIELD_LABEL: Record<string, string> = { legalName: "Legal name", gstin: "GSTIN", pan: "PAN", udyamNumber: "Udyam number", enterpriseName: "Enterprise name", accountHolderName: "Account holder", accountNumber: "Account number", ifsc: "IFSC", tradeName: "Trade name", registrationDate: "Registration date", enterpriseType: "Enterprise type", bankName: "Bank", statementPeriod: "Statement period" };

export const METHOD_LABEL: Record<ReadMethod, string> = { EMBEDDED_TEXT: "Read from the file's text", OCR: "Read from a scan (OCR)", MIXED: "Read from text and scan", LEGACY_PDF_PARSER: "Read with the basic text reader" };

/** Plain-language reasons a value needs the owner's eyes. Unknown codes fall back to a generic line. */
export const REVIEW_REASON: Record<string, string> = {
  OCR_IDENTIFIER: "Read from a scan; check every character of this number.",
  OCR_LOW_CONFIDENCE: "The scan was hard to read here.",
  OCR_REPAIRED: "One or more characters looked unclear and were adjusted to fit the number's format. Please check it.",
  LOW_CONFIDENCE: "Pramaan is not confident about this reading.",
  NO_LABEL: "Found without its usual label.",
  MULTIPLE_CANDIDATES: "More than one different value was found.",
  FAILED_VALIDATION: "Does not match the expected format.",
  CHECKSUM_FAILED: "The number's built-in check did not pass.",
  INCONSISTENT_WITH_GSTIN: "Does not agree with the PAN inside the GSTIN.",
};
export const reviewReasonText = (code: string) => REVIEW_REASON[code] ?? "Please check this value against your document.";

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
  UNREADABLE: { label: "Couldn't read", tone: "warning", description: "No usable text could be read, even from a scan. Try a clearer, upright copy." },
  UNSUPPORTED: { label: "Unsupported file", tone: "neutral", description: "Only unencrypted PDFs (text or scanned) can be read." },
  REJECTED: { label: "Rejected as unsafe", tone: "negative", description: "The file exceeded safe processing limits and was not read." },
};

/** Lower-case form for use inside a sentence. */
export const DOC_SENTENCE: Record<string, string> = { GST_CERTIFICATE: "GST certificate", UDYAM_CERTIFICATE: "Udyam certificate", BANK_STATEMENT: "bank statement" };

const DOC_REASON: Record<DocumentIssueState, string> = {
  MISSING: "not uploaded yet",
  EXPIRED: "past its expiry date",
  UNREADABLE: "unreadable (try a clearer, upright copy)",
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
  if (id.startsWith("REVIEW:")) return `${CLAIM_LABEL[id.slice(7) as ReviewClaim] ?? id.slice(7)} reading`;
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

// ---- Review jobs ----
export type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export interface ReviewJob {
  id: string; status: JobStatus; docsTotal: number; docsDone: number; currentStep: string | null; errorCode: string | null; degraded: boolean;
  isolation: "CONTAINER" | "LOCAL_PROCESS" | null; createdAt: string; startedAt: string | null; finishedAt: string | null;
}
/** READY: the review belongs to the current documents. STALE: a document changed since. EXPIRED: the server no longer holds the results. */
export type ResultState = "READY" | "STALE" | "EXPIRED";
export interface ReviewJobResponse { job: ReviewJob; resultState?: ResultState; review?: EvidenceReview }

export const isJobActive = (job: Pick<ReviewJob, "status">) => job.status === "QUEUED" || job.status === "RUNNING";

/** What the owner sees while a job is waiting or running. */
export function jobProgressText(job: ReviewJob): string {
  if (job.status === "QUEUED") return "Waiting for a free document reader. This starts automatically.";
  if (job.docsTotal === 0) return "Preparing your review";
  const step = job.currentStep?.startsWith("READING:") ? job.currentStep.slice("READING:".length) : null;
  const position = Math.min(job.docsDone + 1, job.docsTotal);
  return `Reading document ${position} of ${job.docsTotal}${step ? `: ${DOC_LABEL[step] ?? "document"}` : ""}`;
}
export const jobProgressPercent = (job: ReviewJob) => (job.docsTotal > 0 ? Math.round((Math.min(job.docsDone, job.docsTotal) / job.docsTotal) * 100) : 0);

const JOB_ERROR: Record<string, string> = {
  SERVER_RESTARTED: "The service restarted while your documents were being read. Nothing was changed. Please start the review again.",
  JOB_INTERRUPTED: "Reading your documents was interrupted. Nothing was changed. Please start the review again.",
  JOB_TIMEOUT: "Reading your documents took too long and was stopped. Nothing was changed. Try again, or upload clearer copies.",
  EXTRACTION_FAILED: "Pramaan could not finish reading your documents. Nothing was changed. Please try again.",
  DOCUMENTS_CHANGED: "Your documents changed while the review was waiting, so it was stopped. Start it again to read the latest files.",
  SUPERSEDED: "A newer review replaced this one.",
  CANCELLED_BY_OWNER: "The review was cancelled.",
  QUEUE_FULL: "Document reading is busy right now. Please try again in a few minutes.",
};
export const jobErrorText = (code: string | null) => (code && JOB_ERROR[code]) || "The review could not be completed. Nothing was changed. Please try again.";
