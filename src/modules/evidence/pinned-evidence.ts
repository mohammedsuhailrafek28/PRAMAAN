// Evidence shown through a pinned share (registered Trust View or guest link).
//
// The ONLY source is the immutable Passport snapshot the share is pinned to.
// Nothing here reads Document rows, so later uploads, replacements, cross-checks
// or expiries cannot change what was disclosed. The lifecycle returned is the
// historical one: it is evaluated as of the snapshot's assessment time, never "now".
//
// Schema-2 snapshots embed evidence records. Legacy snapshots only carry the
// per-document assessment (status, confidence, checks): for those, dates and
// source are reported as null rather than being filled in from live rows.

import { deriveEvidenceLifecycle } from "./evidence-lifecycle.service.js";

export type PinnedEvidenceBasis = "SNAPSHOT" | "LEGACY_SNAPSHOT";

export type PinnedEvidence = {
  docType: string;
  evidenceStatus: string;
  confidence: number;
  crossCheckMethod: string | null;
  source: string | null;
  issuedAt: string | null;
  checkedAt: string | null;
  expiresAt: string | null;
  uploadedAt: string | null;
  lifecycle: ReturnType<typeof deriveEvidenceLifecycle> | { state: string; freshnessState: string; conflict: boolean; needsAttention: boolean };
};

type Check = { type?: unknown; result?: unknown };
type Candidate = Omit<PinnedEvidence, "lifecycle"> & { revision: number | null; documentId: string; checks: Check[] };

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" && value ? value : null);
const isoOrNull = (value: unknown) => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null);
const checksOf = (value: unknown): Check[] => (Array.isArray(value) ? value.filter(isRecord) : []);

function fromEvidenceRecord(record: Record<string, unknown>): Candidate | undefined {
  const docType = text(record.docType);
  const evidenceStatus = text(record.evidenceStatus);
  if (!docType || !evidenceStatus || typeof record.confidence !== "number") return undefined;
  return {
    documentId: text(record.documentId) ?? "",
    docType,
    revision: Number.isInteger(record.revision) ? (record.revision as number) : null,
    evidenceStatus,
    confidence: record.confidence,
    crossCheckMethod: text(record.crossCheckMethod),
    source: text(record.source),
    issuedAt: isoOrNull(record.issuedAt),
    checkedAt: isoOrNull(record.checkedAt),
    expiresAt: isoOrNull(record.expiresAt),
    uploadedAt: isoOrNull(record.uploadedAt),
    checks: checksOf(record.checks)
  };
}

function fromLegacyAssessment(assessment: Record<string, unknown>, checkedAt: string | null): Candidate | undefined {
  const docType = text(assessment.documentType);
  const evidenceStatus = text(assessment.status);
  if (!docType || !evidenceStatus || typeof assessment.confidence !== "number") return undefined;
  return {
    documentId: text(assessment.documentId) ?? "",
    docType,
    revision: null,
    evidenceStatus,
    confidence: assessment.confidence,
    crossCheckMethod: "INTERNAL_METADATA_CHECK",
    source: null,
    issuedAt: null,
    checkedAt,
    expiresAt: null,
    uploadedAt: null,
    checks: checksOf(assessment.checks)
  };
}

/** Lifecycle as of the assessment, from snapshot data only. */
function historicalLifecycle(candidate: Candidate, asOf: Date | null) {
  const expiryFailed = candidate.checks.some((check) => check.type === "EXPIRY" && check.result === "FAILED");
  if (candidate.expiresAt && asOf) {
    return deriveEvidenceLifecycle({ expiresAt: new Date(candidate.expiresAt), isCurrent: true, evidenceStatus: candidate.evidenceStatus as never, contradictionDetails: candidate.checks as never }, asOf);
  }
  // No expiry date in the snapshot (legacy): the recorded EXPIRY check is the only evidence about freshness.
  if (expiryFailed) return { state: "EXPIRED", freshnessState: "EXPIRED", conflict: true, needsAttention: true };
  return deriveEvidenceLifecycle({ expiresAt: null, isCurrent: true, evidenceStatus: candidate.evidenceStatus as never, contradictionDetails: candidate.checks as never }, asOf ?? new Date(0));
}

/** One candidate per document type: the highest revision, else the latest document id. */
function pickLatest(candidates: Candidate[]) {
  return [...candidates].sort((a, b) => (b.revision ?? -1) - (a.revision ?? -1) || b.documentId.localeCompare(a.documentId))[0];
}

export function readPinnedEvidence(snapshot: unknown, approvedEvidenceTypes: readonly string[]): { evidence: PinnedEvidence[]; basis: PinnedEvidenceBasis } {
  if (!isRecord(snapshot) || approvedEvidenceTypes.length === 0) return { evidence: [], basis: isRecord(snapshot) && snapshot.snapshotSchema === 2 ? "SNAPSHOT" : "LEGACY_SNAPSHOT" };

  const asOf = isoOrNull(snapshot.lastCalculatedAt) ?? isoOrNull(snapshot.generatedAt);
  const schema2 = snapshot.snapshotSchema === 2 && Array.isArray(snapshot.evidence);
  const candidates = schema2
    ? (snapshot.evidence as unknown[]).filter(isRecord).map(fromEvidenceRecord)
    : (Array.isArray(snapshot.documentConfidence) ? snapshot.documentConfidence : []).filter(isRecord).map((assessment) => fromLegacyAssessment(assessment, asOf));
  const usable = candidates.filter((candidate): candidate is Candidate => Boolean(candidate));

  const evidence = [...new Set(approvedEvidenceTypes)].flatMap((docType) => {
    const chosen = pickLatest(usable.filter((candidate) => candidate.docType === docType));
    if (!chosen) return [];
    const { revision: _revision, documentId: _documentId, checks: _checks, ...visible } = chosen;
    return [{ ...visible, lifecycle: historicalLifecycle(chosen, asOf ? new Date(asOf) : null) } as PinnedEvidence];
  });
  return { evidence, basis: schema2 ? "SNAPSHOT" : "LEGACY_SNAPSHOT" };
}
