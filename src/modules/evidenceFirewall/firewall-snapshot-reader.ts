// Reads a pinned Passport snapshot into a validated, minimal view. Pure; the snapshot is untrusted input.
// Only schema 2 is accepted: the marker must be a present property equal to 2. Absent, null, non-numeric and
// other versions are never treated as legacy, and documents[] is never consulted.
//
// Provenance Pramaan cannot have is rejected outright. There is no authoritative-source integration, so a
// SOURCE_VERIFIED status, a SOURCE_VERIFICATION check that is anything but NOT_APPLICABLE, or a cross-check method
// other than the internal metadata check can only come from a forged or corrupted snapshot. Any of them makes the
// whole snapshot unsuitable, so it can never support a positive conclusion.
import { isoInstant } from "./firewall-time.js";
import { INTERNAL_CROSS_CHECK_METHOD } from "./firewall-policy.js";

export type CheckView = { type: string; result: string };
export type FieldView = { present: boolean; status: string; evidenceIds: string[]; checks: CheckView[] };
export type EvidenceView = { documentId: string; docType: string; evidenceStatus: string; checkedAtMs: number; expiresAtMs: number | null; checks: CheckView[] };
export type ContradictionView = { field: string };
export type SnapshotView = {
  version: number;
  fields: Map<string, FieldView>;
  evidence: Map<string, EvidenceView>;
  contradictions: ContradictionView[];
};

export const KNOWN_RESULTS = ["PASSED", "FAILED", "WARNING", "NOT_APPLICABLE"] as const;
const EVIDENCE_STATUSES = ["SELF_DECLARED", "DOCUMENT_SUBMITTED", "CROSS_CHECKED", "SOURCE_VERIFIED", "REJECTED", "EXPIRED"];

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const own = (object: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const iso = isoInstant;

function readChecks(value: unknown): CheckView[] | null {
  if (!Array.isArray(value)) return null;
  const checks: CheckView[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.type !== "string" || typeof item.result !== "string") return null;
    if (item.type === "SOURCE_VERIFICATION" && item.result !== "NOT_APPLICABLE") return null; // impossible provenance
    checks.push({ type: item.type, result: item.result });
  }
  return checks;
}

/** null = unsuitable (fail closed). */
export function readSnapshot(snapshot: unknown, expectedPassportId: string): SnapshotView | null {
  if (!isRecord(snapshot)) return null;
  if (!own(snapshot, "snapshotSchema") || snapshot.snapshotSchema !== 2) return null;
  if (snapshot.profileId !== expectedPassportId) return null;
  if (!Number.isInteger(snapshot.version) || (snapshot.version as number) < 1) return null;
  if (iso(snapshot.lastCalculatedAt) === null) return null;
  if (snapshot.sourceVerificationPerformed !== false) return null;
  if (!Array.isArray(snapshot.evidence) || !Array.isArray(snapshot.fieldConfidence) || !Array.isArray(snapshot.contradictions)) return null;

  const evidence = new Map<string, EvidenceView>();
  for (const record of snapshot.evidence) {
    if (!isRecord(record)) return null;
    const checks = readChecks(record.checks);
    const checkedAtMs = iso(record.checkedAt);
    const expiresAtMs = record.expiresAt === null ? null : iso(record.expiresAt);
    if (
      typeof record.documentId !== "string" || !record.documentId || typeof record.docType !== "string" || !record.docType
      || typeof record.evidenceStatus !== "string" || !EVIDENCE_STATUSES.includes(record.evidenceStatus) || record.evidenceStatus === "SOURCE_VERIFIED"
      || record.crossCheckMethod !== INTERNAL_CROSS_CHECK_METHOD
      || !checks || checkedAtMs === null || iso(record.uploadedAt) === null
      || (record.expiresAt !== null && expiresAtMs === null)
      || (record.issuedAt !== null && iso(record.issuedAt) === null)
      || !Number.isInteger(record.revision) || typeof record.confidence !== "number" || !Number.isFinite(record.confidence)
      || evidence.has(record.documentId)
    ) return null;
    evidence.set(record.documentId, { documentId: record.documentId, docType: record.docType, evidenceStatus: record.evidenceStatus, checkedAtMs, expiresAtMs, checks });
  }

  const fields = new Map<string, FieldView>();
  for (const entry of snapshot.fieldConfidence) {
    if (!isRecord(entry) || typeof entry.field !== "string" || !entry.field || fields.has(entry.field)) return null;
    const checks = readChecks(entry.checks);
    if (!checks || typeof entry.status !== "string" || !EVIDENCE_STATUSES.includes(entry.status) || entry.status === "SOURCE_VERIFIED") return null;
    if (!Array.isArray(entry.evidenceIds) || !entry.evidenceIds.every((id) => typeof id === "string" && id)) return null;
    const value = entry.value;
    const present = (typeof value === "string" || typeof value === "number") && String(value).trim().length > 0;
    fields.set(entry.field, { present, status: entry.status, evidenceIds: [...new Set(entry.evidenceIds as string[])], checks });
  }

  const contradictions: ContradictionView[] = [];
  for (const entry of snapshot.contradictions) {
    if (!isRecord(entry) || typeof entry.field !== "string" || !entry.field) return null;
    contradictions.push({ field: entry.field });
  }

  return { version: snapshot.version as number, fields, evidence, contradictions };
}
