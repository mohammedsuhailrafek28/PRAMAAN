import assert from "node:assert/strict";
import { test } from "node:test";

import { RECONCILIATION, EXTRACTION, METHOD_LABEL, reviewReasonText, actionDetail, actionTitle, benchmarkSentence, issueLabel, isJobActive, jobErrorText, jobProgressPercent, jobProgressText, type ReviewJob, type CorrectAction, type EvidenceReview, type SubmitAction } from "../src/lib/evidenceReview.ts";

const submit: SubmitAction = { id: "SUBMIT:UDYAM_CERTIFICATE", type: "SUBMIT_DOCUMENT", docType: "UDYAM_CERTIFICATE", reason: "EXPIRED", resolves: ["DOC:UDYAM_CERTIFICATE"], resolution: "CONDITIONAL_ON_NEW_DOCUMENT_CONTENT", requiresOwnerConfirmation: false };
const correct: CorrectAction = { id: "CORRECT:pan", type: "CORRECT_CLAIM", claim: "pan", sourceDocumentId: "d1", source: "DOCUMENT_TEXT", proposedDisplay: "AB******4F", resolves: ["CONFLICT:pan"], resolution: "VERIFIED_BY_RULES", requiresOwnerConfirmation: true };

test("a document action says replacing never clears a conflict by itself", () => {
  assert.equal(actionTitle(submit), "Replace the Udyam certificate");
  assert.match(actionDetail(submit), /does not by itself clear any conflict/);
  assert.match(actionDetail(submit), /Your Udyam certificate is past its expiry date. After you upload a replacement/);
  assert.equal(actionTitle({ ...submit, docType: "BANK_STATEMENT", reason: "MISSING" }), "Upload the bank statement");
  assert.match(actionDetail({ ...submit, docType: "BANK_STATEMENT", reason: "UNREADABLE" }), /Your bank statement is unreadable/);
});

test("a correction action names its source, shows only the masked value and requires confirmation", () => {
  assert.equal(actionTitle(correct), "Correct your PAN");
  assert.match(actionDetail(correct), /AB\*{6}4F/);
  assert.match(actionDetail(correct), /You must confirm it/);
  assert.equal(correct.requiresOwnerConfirmation, true);
});

test("status vocabulary never claims verification", () => {
  for (const descriptor of [...Object.values(RECONCILIATION), ...Object.values(EXTRACTION)]) assert.doesNotMatch(descriptor.label + descriptor.description, /\bverified\b(?! )/i);
  assert.match(RECONCILIATION.MATCHED.description, /not government verification/);
});

test("issue labels are human readable", () => {
  assert.equal(issueLabel("DOC:BANK_STATEMENT"), "Bank statement evidence");
  assert.equal(issueLabel("CONFLICT:gstin"), "GSTIN conflict");
  assert.equal(issueLabel("GAP:bankAccount"), "Structured bank-account claim");
});

test("uncertain readings get plain-language labels and never read as conflicts", () => {
  assert.equal(issueLabel("REVIEW:gstin"), "GSTIN reading");
  assert.match(reviewReasonText("OCR_REPAIRED"), /adjusted to fit/);
  assert.match(reviewReasonText("SOMETHING_NEW"), /check this value/i);
  assert.equal(METHOD_LABEL.OCR, "Read from a scan (OCR)");
  assert.doesNotMatch(EXTRACTION.UNREADABLE.description, /no OCR/i);
});

test("benchmark sentence reports all three counts honestly", () => {
  const b: EvidenceReview["plan"]["benchmark"] = { fullPackDocuments: 3, outstandingOnlyDocuments: 0, plannedDocuments: 0, plannedOwnerActions: 1, openIssues: 3, issuesClosedByPlan: 2, issuesAddressedByOutstandingOnly: 0, issuesAddressedByFullPack: 0 };
  assert.equal(benchmarkSentence(b), "Asking for the full pack would mean 3 documents. A checklist of only missing or expired items would ask for 0 documents. This plan asks for 0 documents and 1 confirmed correction.");
});

const job = (overrides: Partial<ReviewJob> = {}): ReviewJob => ({ id: "j1", status: "RUNNING", docsTotal: 3, docsDone: 1, currentStep: "READING:BANK_STATEMENT", errorCode: null, degraded: false, isolation: "CONTAINER", createdAt: "2026-10-20T10:00:00Z", startedAt: "2026-10-20T10:00:01Z", finishedAt: null, ...overrides });

test("job progress is stated in plain language and never exceeds the document count", () => {
  assert.equal(jobProgressText(job()), "Reading document 2 of 3: Bank statement");
  assert.equal(jobProgressText(job({ docsDone: 3 })), "Reading document 3 of 3: Bank statement");
  assert.match(jobProgressText(job({ status: "QUEUED", currentStep: null, docsDone: 0 })), /Waiting for a free document reader/);
  assert.equal(jobProgressPercent(job()), 33);
  assert.equal(jobProgressPercent(job({ docsTotal: 0, docsDone: 0 })), 0);
});

test("only queued and running jobs are polled", () => {
  assert.equal(isJobActive(job({ status: "QUEUED" })), true);
  assert.equal(isJobActive(job({ status: "RUNNING" })), true);
  for (const status of ["SUCCEEDED", "FAILED", "CANCELLED"] as const) assert.equal(isJobActive(job({ status })), false);
});

test("job failures are explained without technical codes and reassure that nothing changed", () => {
  for (const code of ["SERVER_RESTARTED", "JOB_INTERRUPTED", "JOB_TIMEOUT", "EXTRACTION_FAILED"]) {
    const text = jobErrorText(code);
    assert.doesNotMatch(text, /[A-Z]{4,}_[A-Z]+/);
    assert.match(text, /Nothing was changed/);
  }
  assert.match(jobErrorText(null), /Nothing was changed/);
  assert.match(jobErrorText("CANCELLED_BY_OWNER"), /cancelled/);
});
