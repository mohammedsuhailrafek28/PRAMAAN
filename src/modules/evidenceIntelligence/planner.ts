// Minimal Evidence Challenge planner.
//
// Given the owner's declared claims, the current documents and what could be read from them, it finds the smallest set
// of owner actions that closes the open issues, and checks each candidate plan against the real internal trust rules
// (`runInternalCrossCheck`) and the reconciliation rules rather than trusting the plan's own arithmetic.
//
// Pure and deterministic: no clock beyond the supplied `now`, no randomness, no I/O, stable ordering and tie-breaks.
//
// Honesty rules enforced here:
//  * Submitting a document is never assumed to resolve a content conflict. It can only resolve "the document is
//    missing / expired / unreadable", and is flagged CONDITIONAL because the new document's content is unknown.
//  * Correcting a claim requires the owner's explicit confirmation and is verified by re-running the real rules.
//  * Issues no available action can close are reported as unresolved, never dropped.

import type { Business, Document, DocumentType, User } from "@prisma/client";
import { runInternalCrossCheck } from "../trustEngine/cross-check-engine.js";
import { deriveEvidenceLifecycle } from "../evidence/evidence-lifecycle.service.js";
import { requiredDocumentTypes } from "../trustEngine/rules/document.rules.js";
import { panFromGstin } from "../trustEngine/rules/identity.rules.js";
import type { DocumentExtraction, ExtractedFieldName } from "./field-extractors.js";
import { reconcileClaims, type ClaimReconciliation, type DeclaredClaims } from "./reconciliation.js";

export type CorrectableClaim = "legalName" | "gstin" | "pan" | "udyamNumber";
export const CORRECTABLE_CLAIMS: readonly CorrectableClaim[] = ["legalName", "gstin", "pan", "udyamNumber"];

export type DocumentIssueState = "MISSING" | "EXPIRED" | "UNREADABLE" | "UNSUPPORTED" | "REJECTED_FILE" | "NOT_RECOGNISED" | "ESSENTIAL_FIELD_UNCLEAR";

export type Issue =
  | { id: string; kind: "DOCUMENT"; docType: DocumentType; state: DocumentIssueState }
  | { id: string; kind: "CLAIM_CONFLICT"; claim: CorrectableClaim; engineContradiction: boolean }
  | { id: string; kind: "UNCERTAIN_READING"; claim: CorrectableClaim }
  | { id: string; kind: "BANK_ACCOUNT_CLAIM_UNSUPPORTED" };

export type PlanAction =
  | { id: string; type: "SUBMIT_DOCUMENT"; docType: DocumentType; reason: DocumentIssueState; resolves: string[]; resolution: "CONDITIONAL_ON_NEW_DOCUMENT_CONTENT"; requiresOwnerConfirmation: false }
  | { id: string; type: "CORRECT_CLAIM"; claim: CorrectableClaim; sourceDocumentId: string | null; source: "DOCUMENT_TEXT" | "GSTIN_EMBEDDED_PAN" | "ACCOUNT_ORGANIZATION_NAME"; proposedValue: string; resolves: string[]; resolution: "VERIFIED_BY_RULES"; requiresOwnerConfirmation: true };

export type UnresolvedReason = "READING_UNCERTAIN" | "NEEDS_HUMAN_REVIEW" | "DOCUMENTS_DISAGREE" | "NOT_SUPPORTED_BY_DESIGN";
export type UnresolvedItem = { issueId: string; reason: UnresolvedReason; message: string };

export type Benchmark = {
  /** Every document in the onboarding pack, requested regardless of state. */
  fullPackDocuments: number;
  /** Documents a "request only what is missing or expired" checklist asks for. */
  outstandingOnlyDocuments: number;
  plannedDocuments: number;
  plannedOwnerActions: number;
  openIssues: number;
  issuesClosedByPlan: number;
  /** Issues an outstanding-only checklist would address (missing/expired documents only). */
  issuesAddressedByOutstandingOnly: number;
  issuesAddressedByFullPack: number;
};

export type EvidencePlan = {
  actions: PlanAction[];
  unresolved: UnresolvedItem[];
  benchmark: Benchmark;
  objective: string;
  searched: number;
};

export type PlannerInput = {
  business: Business;
  organizationName: string | null;
  /** Current (isCurrent) documents only. */
  documents: Document[];
  extractions: DocumentExtraction[];
  now: Date;
};

type Context = { business: Business & { user: User; documents: Document[] }; extractions: DocumentExtraction[]; now: Date };

const ESSENTIAL: Record<string, ExtractedFieldName[]> = {
  GST_CERTIFICATE: ["gstin", "legalName"],
  UDYAM_CERTIFICATE: ["udyamNumber"],
  BANK_STATEMENT: ["accountNumber"]
};

const claimsOf = (business: Pick<Business, "legalName" | "gstin" | "pan" | "udyamNumber">): DeclaredClaims => ({
  legalName: business.legalName, gstin: business.gstin, pan: business.pan, udyamNumber: business.udyamNumber
});

const ENGINE_FIELD_TO_CLAIM: Record<string, CorrectableClaim> = { pan: "pan", businessName: "legalName" };

function documentState(docType: DocumentType, ctx: Context): DocumentIssueState | null {
  const document = ctx.business.documents.find((item) => item.docType === docType && item.isCurrent);
  if (!document) return "MISSING";
  if (deriveEvidenceLifecycle(document, ctx.now).freshnessState === "EXPIRED") return "EXPIRED";
  const extraction = ctx.extractions.find((item) => item.documentId === document.id);
  if (!extraction) return null; // not read in this evaluation; no claim is made about readability
  if (extraction.status === "UNREADABLE") return "UNREADABLE";
  if (extraction.status === "UNSUPPORTED") return "UNSUPPORTED";
  if (extraction.status === "REJECTED") return "REJECTED_FILE";
  if (extraction.status === "NOT_RECOGNISED") return "NOT_RECOGNISED";
  const unclear = (ESSENTIAL[docType] ?? []).some((name) => extraction.fields.find((field) => field.field === name)?.status !== "EXTRACTED");
  return unclear ? "ESSENTIAL_FIELD_UNCLEAR" : null;
}

type State = { issues: Issue[]; reconciliations: ClaimReconciliation[] };

/** Opens issues from the real engine (contradictions, gaps) plus reconciliation, for a possibly hypothetical context. */
function openIssues(ctx: Context): State {
  const reconciliations = reconcileClaims(claimsOf(ctx.business), ctx.extractions);
  const profile = runInternalCrossCheck(ctx.business, ctx.now);
  const conflicts = new Map<CorrectableClaim, boolean>();
  for (const item of reconciliations) {
    if (item.status === "CONFLICTED" && (CORRECTABLE_CLAIMS as readonly string[]).includes(item.claim)) conflicts.set(item.claim as CorrectableClaim, false);
  }
  for (const contradiction of profile.contradictions) {
    const claim = ENGINE_FIELD_TO_CLAIM[contradiction.field];
    if (claim) conflicts.set(claim, true);
  }
  const issues: Issue[] = [];
  // A value that differs from the declaration but was read uncertainly (OCR, failed check) is never a conflict and never a
  // correction source: the owner is asked to look at it instead.
  for (const item of reconciliations) {
    if (item.needsOwnerReview && !conflicts.has(item.claim as CorrectableClaim) && (CORRECTABLE_CLAIMS as readonly string[]).includes(item.claim)) {
      issues.push({ id: `REVIEW:${item.claim}`, kind: "UNCERTAIN_READING", claim: item.claim as CorrectableClaim });
    }
  }
  for (const docType of requiredDocumentTypes) {
    const state = documentState(docType, ctx);
    if (state) issues.push({ id: `DOC:${docType}`, kind: "DOCUMENT", docType, state });
  }
  for (const claim of CORRECTABLE_CLAIMS) {
    if (conflicts.has(claim)) issues.push({ id: `CONFLICT:${claim}`, kind: "CLAIM_CONFLICT", claim, engineContradiction: conflicts.get(claim) as boolean });
  }
  // The engine's bankAccount gap needs a structured bank-account claim that Pramaan has no field to hold.
  if (profile.gaps.some((gap) => gap.field === "bankAccount" && gap.message.includes("structured bank-account"))) {
    issues.push({ id: "GAP:bankAccount", kind: "BANK_ACCOUNT_CLAIM_UNSUPPORTED" });
  }
  return { issues, reconciliations };
}

function withClaims(ctx: Context, changes: Partial<Record<CorrectableClaim, string>>): Context {
  const map: Record<CorrectableClaim, keyof Business> = { legalName: "legalName", gstin: "gstin", pan: "pan", udyamNumber: "udyamNumber" };
  const business = { ...ctx.business } as Business & { user: User; documents: Document[] };
  for (const [claim, value] of Object.entries(changes) as Array<[CorrectableClaim, string]>) (business as unknown as Record<string, unknown>)[map[claim]] = value;
  return { ...ctx, business };
}

type Candidate = { claim: CorrectableClaim; value: string; sourceDocumentId: string | null; source: "DOCUMENT_TEXT" | "GSTIN_EMBEDDED_PAN" | "ACCOUNT_ORGANIZATION_NAME" };

function correctionCandidates(claim: CorrectableClaim, ctx: Context, reconciliation: ClaimReconciliation | undefined): Candidate[] {
  const declared = (ctx.business as unknown as Record<string, string | null>)[claim];
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const add = (candidate: Candidate) => {
    const key = candidate.value.trim().toUpperCase();
    if (!candidate.value || key === (declared ?? "").trim().toUpperCase() || seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  };
  for (const comparison of reconciliation?.comparisons ?? []) {
    if (comparison.extractedValue && !comparison.needsReview) add({ claim, value: comparison.extractedValue, sourceDocumentId: comparison.documentId, source: "DOCUMENT_TEXT" });
  }
  if (claim === "pan") {
    const embedded = panFromGstin(ctx.business.gstin);
    if (embedded) add({ claim, value: embedded, sourceDocumentId: null, source: "GSTIN_EMBEDDED_PAN" });
  }
  if (claim === "legalName" && ctx.business.user.organizationName) add({ claim, value: ctx.business.user.organizationName, sourceDocumentId: null, source: "ACCOUNT_ORGANIZATION_NAME" });
  return out.slice(0, 4);
}

function cloneForResubmission(docType: DocumentType, ctx: Context): Context {
  const template = ctx.business.documents.find((item) => item.docType === docType) ?? ctx.business.documents[0];
  const hypothetical = {
    ...(template ?? {}), id: `hypothetical:${docType}`, businessId: ctx.business.id, docType, filePath: "hypothetical", originalName: "hypothetical.pdf", mimeType: "application/pdf",
    evidenceStatus: "DOCUMENT_SUBMITTED", expiresAt: null, issuedAt: null, isCurrent: true, uploadedAt: ctx.now, contradictionDetails: null
  } as unknown as Document;
  const documents = [...ctx.business.documents.filter((item) => item.docType !== docType), hypothetical];
  // Old extractions are deliberately retained: the new document's content is unknown, so conflicts the old one showed
  // are not assumed to disappear.
  return { ...ctx, business: { ...ctx.business, documents } as Context["business"] };
}

type Combo = { submits: DocumentType[]; corrections: Candidate[] };

function evaluate(base: Context, combo: Combo): { open: Set<string>; ctx: Context } {
  let ctx = withClaims(base, Object.fromEntries(combo.corrections.map((item) => [item.claim, item.value])));
  for (const docType of combo.submits) ctx = cloneForResubmission(docType, ctx);
  const state = openIssues(ctx);
  return { open: new Set(state.issues.map((issue) => issue.id)), ctx };
}

export function planEvidenceChallenge(input: PlannerInput): { issues: Issue[]; reconciliations: ClaimReconciliation[]; plan: EvidencePlan } {
  const { business } = input;
  const base: Context = {
    business: { ...business, user: { organizationName: input.organizationName } as User, documents: input.documents } as Context["business"],
    extractions: input.extractions,
    now: input.now
  };
  const initial = openIssues(base);
  const issueIds = initial.issues.map((issue) => issue.id);

  const docIssues = initial.issues.filter((issue): issue is Extract<Issue, { kind: "DOCUMENT" }> => issue.kind === "DOCUMENT");
  const conflictIssues = initial.issues.filter((issue): issue is Extract<Issue, { kind: "CLAIM_CONFLICT" }> => issue.kind === "CLAIM_CONFLICT");
  const candidates = new Map<CorrectableClaim, Candidate[]>();
  for (const issue of conflictIssues) candidates.set(issue.claim, correctionCandidates(issue.claim, base, initial.reconciliations.find((item) => item.claim === issue.claim)));

  // Exhaustive search over: each document issue submitted or not × each conflicted claim corrected with one candidate or not.
  const submitOptions = docIssues.map((issue) => issue.docType);
  const choices = conflictIssues.map((issue) => [null, ...(candidates.get(issue.claim) ?? [])] as Array<Candidate | null>);
  let best: { combo: Combo; open: Set<string>; cost: [number, number, number, number, string] } | null = null;
  let searched = 0;
  const submitMasks = 1 << submitOptions.length;
  const walk = (index: number, picked: Candidate[]) => {
    if (index < choices.length) {
      for (const option of choices[index]) walk(index + 1, option ? [...picked, option] : picked);
      return;
    }
    for (let mask = 0; mask < submitMasks; mask += 1) {
      if (searched >= 20_000) return;
      searched += 1;
      const submits = submitOptions.filter((_, bit) => (mask & (1 << bit)) !== 0);
      const combo: Combo = { submits, corrections: picked };
      const { open } = evaluate(base, combo);
      const actionCount = submits.length + picked.length;
      const cost: [number, number, number, number, string] = [open.size, actionCount, submits.length, picked.length, `${submits.join(",")}|${picked.map((item) => `${item.claim}=${item.value}`).join(",")}`];
      if (!best || compareCost(cost, best.cost) < 0) best = { combo, open, cost };
    }
  };
  walk(0, []);
  const chosen = best as unknown as { combo: Combo; open: Set<string>; cost: [number, number, number, number, string] };

  // Drop any chosen action that did not actually close an issue (minimality guard).
  const actions: PlanAction[] = [];
  const closed = (extra: Combo) => issueIds.filter((id) => !evaluate(base, extra).open.has(id));
  const closedByAll = new Set(closed(chosen.combo));
  for (const docType of chosen.combo.submits) {
    const without = { submits: chosen.combo.submits.filter((item) => item !== docType), corrections: chosen.combo.corrections };
    const lost = [...closedByAll].filter((id) => !new Set(closed(without)).has(id));
    if (lost.length === 0) continue;
    const issue = docIssues.find((item) => item.docType === docType) as Extract<Issue, { kind: "DOCUMENT" }>;
    actions.push({ id: `SUBMIT:${docType}`, type: "SUBMIT_DOCUMENT", docType, reason: issue.state, resolves: lost, resolution: "CONDITIONAL_ON_NEW_DOCUMENT_CONTENT", requiresOwnerConfirmation: false });
  }
  for (const correction of chosen.combo.corrections) {
    const without = { submits: chosen.combo.submits, corrections: chosen.combo.corrections.filter((item) => item !== correction) };
    const lost = [...closedByAll].filter((id) => !new Set(closed(without)).has(id));
    if (lost.length === 0) continue;
    actions.push({ id: `CORRECT:${correction.claim}`, type: "CORRECT_CLAIM", claim: correction.claim, sourceDocumentId: correction.sourceDocumentId, source: correction.source, proposedValue: correction.value, resolves: lost, resolution: "VERIFIED_BY_RULES", requiresOwnerConfirmation: true });
  }
  actions.sort((a, b) => (a.type === b.type ? a.id.localeCompare(b.id) : a.type === "SUBMIT_DOCUMENT" ? -1 : 1));

  const finalOpen = chosen.open;
  const unresolved: UnresolvedItem[] = [];
  for (const id of [...finalOpen].sort()) {
    const issue = initial.issues.find((item) => item.id === id);
    if (id === "GAP:bankAccount") unresolved.push({ issueId: id, reason: "NOT_SUPPORTED_BY_DESIGN", message: "Pramaan holds no structured bank-account claim, so no document upload can clear this gap. It is shown honestly rather than counted as resolved." });
    else if (issue?.kind === "CLAIM_CONFLICT") {
      const disagree = initial.reconciliations.find((item) => item.claim === issue.claim)?.crossDocumentConflict;
      unresolved.push({ issueId: id, reason: disagree ? "DOCUMENTS_DISAGREE" : "NEEDS_HUMAN_REVIEW", message: disagree ? "Your submitted documents disagree with each other, so no single correction to your declaration reconciles them. Upload a corrected document or request human review." : "No single correction to your declaration removes this conflict under the trust rules. Request human review or upload a corrected document." });
    } else if (issue?.kind === "UNCERTAIN_READING") {
      unresolved.push({ issueId: id, reason: "READING_UNCERTAIN", message: "A value in your document was read with low certainty and may not match what you declared. Check the document yourself; nothing is changed automatically. Uploading a clearer copy may help." });
    } else if (issue?.kind === "DOCUMENT") unresolved.push({ issueId: id, reason: "NEEDS_HUMAN_REVIEW", message: "This document issue is not closed by the planned actions." });
    else if (!issue) unresolved.push({ issueId: id, reason: "NEEDS_HUMAN_REVIEW", message: "Applying the planned corrections would introduce a new conflict that needs review." });
  }

  const resolvedCount = issueIds.filter((id) => !finalOpen.has(id)).length;
  const outstandingOnly = requiredDocumentTypes.filter((docType) => {
    const state = documentState(docType, base);
    return state === "MISSING" || state === "EXPIRED";
  });
  const plannedDocuments = actions.filter((item) => item.type === "SUBMIT_DOCUMENT").length;
  const benchmark: Benchmark = {
    fullPackDocuments: requiredDocumentTypes.length,
    outstandingOnlyDocuments: outstandingOnly.length,
    plannedDocuments,
    plannedOwnerActions: actions.length,
    openIssues: issueIds.length,
    issuesClosedByPlan: resolvedCount,
    issuesAddressedByOutstandingOnly: issueIds.filter((id) => outstandingOnly.some((docType) => id === `DOC:${docType}`)).length,
    issuesAddressedByFullPack: issueIds.filter((id) => id.startsWith("DOC:")).length
  };
  return {
    issues: initial.issues,
    reconciliations: initial.reconciliations,
    plan: { actions, unresolved, benchmark, objective: "fewest unresolved issues, then fewest owner actions, then fewest new documents, then fewest identity-claim edits", searched }
  };
}

function compareCost(a: [number, number, number, number, string], b: [number, number, number, number, string]): number {
  for (let index = 0; index < 4; index += 1) if (a[index] !== (b[index] as number)) return (a[index] as number) - (b[index] as number);
  return a[4] < b[4] ? -1 : a[4] > b[4] ? 1 : 0;
}

