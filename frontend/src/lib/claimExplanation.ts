// Owner-side claim explanations, derived ONLY from one Trust Profile snapshot.
//
// This is a presentation layer, not a verification engine. Every statement is
// built from checks, findings and evidence records already recorded in the
// displayed snapshot; nothing is recomputed, no clock is read, and live
// document rows are never consulted. The six categories below are frontend
// presentation labels and are not backend status values.
//
// Primary-category precedence (first match wins):
//   1. NOT_PROVIDED          no value was submitted
//   2. CONTRADICTED          a contradiction or failed consistency check exists
//   3. EXPIRED               supporting evidence had expired when assessed
//   4. MISSING_EVIDENCE      a supporting document is required but none exists
//   5. SUPPORTED_INTERNALLY  a document is consistent and nothing failed
//   6. NOT_ASSESSED          nothing above applies (no evidence type applies,
//                            or a recorded check did not pass for another reason)
// Precedence only picks the headline. Every other applicable condition is kept
// in `secondary` and `notes`, and every recorded check is listed, so a lower
// ranked problem is never hidden behind a higher ranked state.

import { disclosureItem } from "@/lib/disclosure";
import { documentTypeLabel } from "@/lib/fieldLabels";
import { fieldValueText } from "@/lib/trustProfileView";
import { humanize, NOT_EXTERNALLY_VERIFIED, type StatusDescriptor } from "@/lib/trustVocabulary";
import type { Contradiction, EvidenceGap, FieldCheck, SnapshotEvidenceRecord, TrustCheck, TrustProfile } from "@/types";

export type ExplanationCategory =
  | "NOT_PROVIDED"
  | "SUPPORTED_INTERNALLY"
  | "CONTRADICTED"
  | "MISSING_EVIDENCE"
  | "EXPIRED"
  | "NOT_ASSESSED";

/** Precedence order for the primary category. */
export const CATEGORY_PRECEDENCE: readonly ExplanationCategory[] = [
  "NOT_PROVIDED",
  "CONTRADICTED",
  "EXPIRED",
  "MISSING_EVIDENCE",
  "SUPPORTED_INTERNALLY",
  "NOT_ASSESSED",
];

export const CATEGORY_PRESENTATION: Record<ExplanationCategory, StatusDescriptor> = {
  NOT_PROVIDED: { label: "Not provided", tone: "negative", icon: "dot", description: "No value was submitted for this claim." },
  CONTRADICTED: { label: "Conflict found", tone: "negative", icon: "alert", description: "Pramaan's internal checks found a conflict with another submitted value." },
  EXPIRED: { label: "Evidence expired", tone: "warning", description: "The supporting evidence had passed its expiry date when this version was assessed." },
  MISSING_EVIDENCE: { label: "Evidence missing", tone: "negative", icon: "dot", description: "A supporting document is expected for this claim but none was submitted." },
  SUPPORTED_INTERNALLY: { label: "Supported by internal checks", tone: "positive", description: "Submitted evidence is consistent with this claim. Not externally verified." },
  NOT_ASSESSED: { label: "Not assessed against evidence", tone: "neutral", description: "No supporting-evidence assessment applies to this claim in this version." },
};

/** A date as recorded in the snapshot, or an honest reason it cannot be shown. */
export type RecordedDate =
  | { kind: "RECORDED"; iso: string }
  /** The version records that this attribute was empty (for example, no expiry entered). */
  | { kind: "NONE_RECORDED" }
  /** This version never captured the attribute (legacy snapshot). */
  | { kind: "UNAVAILABLE" };

export interface CheckLine {
  type: string;
  label: string;
  outcome: string;
  outcomeLabel: string;
  tone: "pass" | "fail" | "warn" | "neutral";
  reason: string;
}

export interface EvidenceLine {
  documentId: string;
  /** False when the id is not present anywhere in this snapshot. */
  found: boolean;
  basis: "SNAPSHOT" | "LEGACY_SNAPSHOT" | "NOT_IN_SNAPSHOT";
  docType: string | null;
  docTypeLabel: string;
  revision: number | null;
  status: string | null;
  source: { kind: "RECORDED"; text: string } | { kind: "NONE_RECORDED" } | { kind: "UNAVAILABLE" };
  issuedAt: RecordedDate;
  expiresAt: RecordedDate;
  uploadedAt: RecordedDate;
  checkedAt: RecordedDate;
  expiredWhenAssessed: boolean;
  checks: CheckLine[];
}

export interface ContradictionLine {
  severity: string;
  reason: string;
  claimedValue: string | null;
  evidenceValues: string[];
}

export interface GapLine {
  severity: string;
  message: string;
  requiredEvidenceLabels: string[];
}

export interface ClaimExplanation {
  field: string;
  label: string;
  valueText: string;
  recordedStatus: string;
  version: number;
  /** Assessment time recorded in the snapshot (never "now"). */
  assessedAt: string | null;
  category: ExplanationCategory;
  /** Other applicable conditions, in precedence order, excluding the primary. */
  secondary: ExplanationCategory[];
  summary: string;
  notes: string[];
  checks: CheckLine[];
  evidence: EvidenceLine[];
  contradictions: ContradictionLine[];
  gaps: GapLine[];
  /** True only if the snapshot itself records a passed source verification. */
  sourceVerificationRecorded: boolean;
  sourceVerificationText: string;
  limitation: string;
  evidenceBasis: "SNAPSHOT" | "LEGACY_SNAPSHOT";
}

const CHECK_LABELS: Record<string, string> = {
  CLAIM_PRESENT: "Claim submitted",
  FORMAT: "Format check",
  SUPPORTING_DOCUMENT: "Supporting document",
  INTERNAL_CONSISTENCY: "Consistency with other submitted values",
  EXPIRED_EVIDENCE: "Evidence expiry",
  SOURCE_VERIFICATION: "External source check",
  FILE_EXISTS: "File recorded",
  FILE_TYPE: "File type",
  REQUIRED_METADATA: "Upload details",
  DUPLICATE_EVIDENCE: "Duplicate evidence",
  EXPIRY: "Expiry date",
};

const OUTCOME_LABELS: Record<string, { label: string; tone: CheckLine["tone"] }> = {
  PASSED: { label: "Passed", tone: "pass" },
  FAILED: { label: "Did not pass", tone: "fail" },
  WARNING: { label: "Warning", tone: "warn" },
  NOT_APPLICABLE: { label: "Not applicable", tone: "neutral" },
};

/** Backend contradictions name the legal name `businessName`; claims name it `legalBusinessName`. */
const canonicalField = (field: string) => (field === "businessName" ? "legalBusinessName" : field);

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function toCheckLines(checks: unknown): CheckLine[] {
  if (!Array.isArray(checks)) return [];
  return checks.filter(isRecord).map((check: Record<string, unknown>) => {
    const type = typeof check.type === "string" && check.type ? check.type : "UNKNOWN";
    const outcome = typeof check.result === "string" && check.result ? check.result : "UNKNOWN";
    const known = OUTCOME_LABELS[outcome];
    return {
      type,
      label: CHECK_LABELS[type] ?? humanize(type),
      outcome,
      outcomeLabel: known?.label ?? humanize(outcome),
      // An outcome this client does not recognise is shown as recorded and never treated as a failure.
      tone: known?.tone ?? "neutral",
      reason: typeof check.reason === "string" ? check.reason : "",
    };
  });
}

const findCheck = (checks: readonly TrustCheck[], type: string) => checks.find((check) => check.type === type);
const stringOrNull = (value: unknown) => (typeof value === "string" && value ? value : null);

function recordedDate(value: unknown, snapshotRecord: boolean): RecordedDate {
  const iso = stringOrNull(value);
  if (iso) return { kind: "RECORDED", iso };
  return snapshotRecord ? { kind: "NONE_RECORDED" } : { kind: "UNAVAILABLE" };
}

/** Attributes that a schema-2 record always carries; if absent they are unavailable, not "none". */
function requiredDate(value: unknown): RecordedDate {
  const iso = stringOrNull(value);
  return iso ? { kind: "RECORDED", iso } : { kind: "UNAVAILABLE" };
}

function lineFromRecord(record: SnapshotEvidenceRecord): EvidenceLine {
  const checks = toCheckLines(record.checks);
  return {
    documentId: record.documentId,
    found: true,
    basis: "SNAPSHOT",
    docType: record.docType,
    docTypeLabel: documentTypeLabel(record.docType),
    revision: Number.isInteger(record.revision) ? record.revision : null,
    status: record.evidenceStatus,
    source: stringOrNull(record.source) ? { kind: "RECORDED", text: sourceText(record.source as string) } : { kind: "NONE_RECORDED" },
    issuedAt: recordedDate(record.issuedAt, true),
    expiresAt: recordedDate(record.expiresAt, true),
    uploadedAt: requiredDate(record.uploadedAt),
    checkedAt: requiredDate(record.checkedAt),
    expiredWhenAssessed: checks.some((check) => check.type === "EXPIRY" && check.outcome === "FAILED"),
    checks,
  };
}

/** Legacy snapshots recorded the assessment (status, checks) but not dates, revision or source. */
function lineFromLegacyAssessment(document: TrustProfile["documents"][number]): EvidenceLine {
  const checks = toCheckLines(document.checks);
  return {
    documentId: document.documentId,
    found: true,
    basis: "LEGACY_SNAPSHOT",
    docType: document.documentType,
    docTypeLabel: documentTypeLabel(document.documentType),
    revision: null,
    status: document.status,
    source: { kind: "UNAVAILABLE" },
    issuedAt: { kind: "UNAVAILABLE" },
    expiresAt: { kind: "UNAVAILABLE" },
    uploadedAt: { kind: "UNAVAILABLE" },
    checkedAt: { kind: "UNAVAILABLE" },
    expiredWhenAssessed: checks.some((check) => check.type === "EXPIRY" && check.outcome === "FAILED"),
    checks,
  };
}

function sourceText(source: string): string {
  return source === "MSME_SUBMITTED" ? "Submitted by the business" : source;
}

/**
 * Evidence is resolved by the snapshot's own schema marker, never by whether evidence[] happens to be empty:
 *  - schema 2: only the embedded evidence[] records; an id that is not there is NOT_IN_SNAPSHOT;
 *  - no marker (a genuine legacy snapshot): the per-document assessments, with metadata unavailable;
 *  - any other marker: unknown format, so nothing is resolved.
 */
function resolveEvidence(profile: TrustProfile, ids: readonly string[]): EvidenceLine[] {
  const schema = profile.snapshotSchema;
  return [...new Set(ids)].map((id) => {
    if (schema === 2) {
      const record = profile.evidence.find((item) => item.documentId === id);
      if (record) return lineFromRecord(record);
    } else if (schema === undefined) {
      const assessment = profile.documents.find((item) => item.documentId === id);
      if (assessment) return lineFromLegacyAssessment(assessment);
    }
    return {
      documentId: id, found: false, basis: "NOT_IN_SNAPSHOT", docType: null, docTypeLabel: "Evidence record", revision: null, status: null,
      source: { kind: "UNAVAILABLE" }, issuedAt: { kind: "UNAVAILABLE" }, expiresAt: { kind: "UNAVAILABLE" }, uploadedAt: { kind: "UNAVAILABLE" }, checkedAt: { kind: "UNAVAILABLE" },
      expiredWhenAssessed: false, checks: [],
    } satisfies EvidenceLine;
  });
}

function contradictionLines(contradictions: readonly Contradiction[], field: string): ContradictionLine[] {
  return contradictions
    .filter((item) => canonicalField(item.field) === canonicalField(field))
    .map((item) => ({
      severity: item.severity,
      reason: item.reason,
      claimedValue: item.claimedValue ?? null,
      evidenceValues: Array.isArray(item.evidenceValues) ? item.evidenceValues.filter((value) => typeof value === "string" && value) : [],
    }));
}

function gapLines(gaps: readonly EvidenceGap[], field: string): GapLine[] {
  return gaps
    .filter((item) => canonicalField(item.field) === canonicalField(field))
    .map((item) => ({
      severity: item.severity,
      message: item.message,
      requiredEvidenceLabels: (item.requiredEvidenceTypes ?? []).map(documentTypeLabel),
    }));
}

const SUMMARIES: Record<ExplanationCategory, string> = {
  NOT_PROVIDED: "No value was submitted for this claim.",
  CONTRADICTED: "Pramaan's internal checks found that this claim conflicts with another value you submitted.",
  EXPIRED: "The supporting evidence had passed its expiry date when this version was assessed.",
  MISSING_EVIDENCE: "No supporting document has been submitted for this claim.",
  SUPPORTED_INTERNALLY: "A submitted document is consistent with this claim in Pramaan's internal checks. This is not external verification.",
  NOT_ASSESSED: "No supporting-evidence assessment applies to this claim, so it is recorded as submitted by the business.",
};

const SECONDARY_NOTES: Record<ExplanationCategory, string> = {
  NOT_PROVIDED: "No value was submitted.",
  CONTRADICTED: "A conflict with another submitted value was also recorded.",
  EXPIRED: "Supporting evidence had also passed its expiry date.",
  MISSING_EVIDENCE: "No supporting document has been submitted.",
  SUPPORTED_INTERNALLY: "A submitted document is consistent with this claim.",
  NOT_ASSESSED: "",
};

/** Checks whose failure is already expressed by one of the six categories. */
const CATEGORY_CHECK_TYPES = new Set(["CLAIM_PRESENT", "SUPPORTING_DOCUMENT", "INTERNAL_CONSISTENCY", "EXPIRED_EVIDENCE", "SOURCE_VERIFICATION"]);

export function explainClaim(profile: TrustProfile, claim: FieldCheck, definition?: { label?: string; mask?: boolean }): ClaimExplanation {
  const checks = claim.checks ?? [];
  const evidenceIds = Array.isArray(claim.evidenceIds) ? claim.evidenceIds : [];
  const empty = claim.value === null || claim.value === undefined || claim.value === "";
  const contradictions = contradictionLines(profile.contradictions ?? [], claim.field);
  const gaps = gapLines(profile.gaps ?? [], claim.field);
  const evidence = resolveEvidence(profile, evidenceIds);

  const claimCheck = findCheck(checks, "CLAIM_PRESENT");
  const supporting = findCheck(checks, "SUPPORTING_DOCUMENT");
  const expiryCheck = findCheck(checks, "EXPIRED_EVIDENCE");
  const sourceCheck = findCheck(checks, "SOURCE_VERIFICATION");

  const notProvided = empty || claimCheck?.result === "FAILED";
  const contradicted = contradictions.length > 0 || findCheck(checks, "INTERNAL_CONSISTENCY")?.result === "FAILED";
  const expired = Boolean(expiryCheck && (expiryCheck.result === "WARNING" || expiryCheck.result === "FAILED")) || evidence.some((line) => line.expiredWhenAssessed);
  // A failed supporting-document check with linked evidence is explained by expiry; only an
  // empty reference list means no document exists. Anything else is left to the raw check.
  const missingEvidence = !expired && evidenceIds.length === 0 && supporting?.result === "FAILED";
  const otherFailures = checks.filter((check) => check.result === "FAILED" && !CATEGORY_CHECK_TYPES.has(check.type));
  const supported = !notProvided && !contradicted && !expired && supporting?.result === "PASSED" && otherFailures.length === 0;

  const applicable: Record<ExplanationCategory, boolean> = {
    NOT_PROVIDED: notProvided,
    CONTRADICTED: contradicted,
    EXPIRED: expired,
    MISSING_EVIDENCE: missingEvidence,
    SUPPORTED_INTERNALLY: supported,
    NOT_ASSESSED: false,
  };
  const matched = CATEGORY_PRECEDENCE.filter((category) => applicable[category]);
  const category: ExplanationCategory = matched[0] ?? "NOT_ASSESSED";
  const secondary = matched.slice(1);

  const notes = secondary.map((item) => SECONDARY_NOTES[item]).filter(Boolean);
  if (category === "NOT_ASSESSED" && otherFailures.length > 0) {
    notes.push(`A recorded check did not pass: ${otherFailures.map((check) => CHECK_LABELS[check.type] ?? humanize(check.type)).join(", ")}. See the checks below.`);
  }
  if (evidence.some((line) => !line.found)) notes.push("A referenced evidence record is not present in this version's snapshot.");
  if (evidence.some((line) => line.basis === "LEGACY_SNAPSHOT")) notes.push("This is a historical version recorded before evidence details were captured, so dates and revision are unavailable.");
  if (supporting?.result === "FAILED" && !missingEvidence && !expired) notes.push("The supporting-document check did not pass; see the check reason below.");

  const sourceVerificationRecorded = claim.status === "SOURCE_VERIFIED" || sourceCheck?.result === "PASSED";

  return {
    field: claim.field,
    label: definition?.label ?? disclosureItem(claim.field)?.label ?? humanize(claim.field),
    valueText: fieldValueText(claim.value, definition?.mask),
    recordedStatus: claim.status,
    version: profile.version,
    assessedAt: profile.lastCalculatedAt ?? profile.generatedAt ?? null,
    category,
    secondary,
    summary: category === "NOT_ASSESSED" && otherFailures.length > 0 ? "A recorded check did not pass, and no supporting-evidence assessment applies to this claim in this version." : SUMMARIES[category],
    notes,
    checks: toCheckLines(checks),
    evidence,
    contradictions,
    gaps,
    sourceVerificationRecorded,
    sourceVerificationText: sourceVerificationRecorded
      ? "This version records source verification for this claim."
      : "No external source was consulted for this claim.",
    limitation: NOT_EXTERNALLY_VERIFIED,
    evidenceBasis: profile.evidenceBasis,
  };
}
