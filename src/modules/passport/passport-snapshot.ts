// Builds and validates the immutable Passport snapshot BEFORE it is persisted.
//
// snapshotJson is the historical truth for every consent and guest link pinned to
// a Passport. It is never edited after creation. Schema 2 additionally embeds the
// evidence records (statuses, confidence, dates) exactly as assessed at
// generation time, so pinned disclosures never have to read mutable Document rows.

import type { Document, DocumentType, EvidenceStatus } from "@prisma/client";
import type { BusinessTrustProfile, TrustCheck } from "../trustEngine/trust-engine.types.js";
import { CROSS_CHECK_METHOD } from "../trustEngine/trust-engine.service.js";

export const SNAPSHOT_SCHEMA_VERSION = 2;

export type SnapshotEvidenceRecord = {
  documentId: string;
  docType: DocumentType;
  revision: number;
  evidenceStatus: EvidenceStatus;
  confidence: number;
  crossCheckMethod: string;
  source: string | null;
  issuedAt: string | null;
  checkedAt: string;
  expiresAt: string | null;
  uploadedAt: string;
  checks: TrustCheck[];
};

export class SnapshotConstructionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotConstructionError";
  }
}

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

/**
 * Evidence records for exactly the documents the engine assessed. Status,
 * confidence, checks and the check time come from the assessment; dates and
 * source are the upload-time attributes of those same rows.
 */
export function buildEvidenceRecords(documents: Document[], profile: BusinessTrustProfile): SnapshotEvidenceRecord[] {
  const byId = new Map(documents.map((document) => [document.id, document]));
  return profile.documentConfidence.map((assessment) => {
    const document = byId.get(assessment.documentId);
    if (!document) throw new SnapshotConstructionError(`Assessed document ${assessment.documentId} was not among the loaded documents.`);
    return {
      documentId: document.id,
      docType: document.docType,
      revision: document.revision,
      evidenceStatus: assessment.status,
      confidence: assessment.confidence,
      crossCheckMethod: CROSS_CHECK_METHOD,
      source: document.source ?? null,
      issuedAt: iso(document.issuedAt),
      checkedAt: profile.lastCalculatedAt,
      expiresAt: iso(document.expiresAt),
      uploadedAt: document.uploadedAt.toISOString(),
      checks: assessment.checks
    };
  });
}

function jsonSafe(value: unknown, path: string, problems: string[]) {
  if (value === undefined) problems.push(`${path} is undefined`);
  else if (typeof value === "number" && !Number.isFinite(value)) problems.push(`${path} is not a finite number`);
  else if (typeof value === "function" || typeof value === "bigint" || typeof value === "symbol") problems.push(`${path} is not JSON-serialisable`);
  else if (value instanceof Date) problems.push(`${path} is a Date object`);
  else if (Array.isArray(value)) value.forEach((item, index) => jsonSafe(item, `${path}[${index}]`, problems));
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) jsonSafe(item, `${path}.${key}`, problems);
}

const isIso = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value));

/** Throws SnapshotConstructionError unless the snapshot is complete and self-consistent. */
export function validateSnapshot(snapshot: unknown, expected: { profileId: string; businessId: string; version: number }): void {
  const problems: string[] = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new SnapshotConstructionError("Snapshot is not an object.");
  const s = snapshot as Record<string, any>;
  jsonSafe(s, "snapshot", problems);

  if (Object.keys(s).length === 0) problems.push("snapshot is empty");
  if (s.profileId !== expected.profileId) problems.push("profileId does not match the passport id");
  if (s.businessId !== expected.businessId) problems.push("businessId does not match the business");
  if (s.version !== expected.version || !Number.isInteger(s.version)) problems.push("version does not match the passport version");
  if (!isIso(s.generatedAt)) problems.push("generatedAt is not a valid timestamp");
  if (!isIso(s.lastCalculatedAt)) problems.push("lastCalculatedAt is not a valid timestamp");
  const summary = s.summary;
  for (const metric of ["trustReadiness", "profileCompleteness", "evidenceStrength", "consistency", "freshness"]) {
    if (!summary || typeof summary[metric] !== "number") problems.push(`summary.${metric} is missing`);
  }
  if (!Array.isArray(s.fieldConfidence) || s.fieldConfidence.length === 0) problems.push("fieldConfidence is missing or empty");
  for (const key of ["documentConfidence", "gaps", "contradictions", "limitations"]) if (!Array.isArray(s[key])) problems.push(`${key} is not an array`);
  if (s.sourceVerificationPerformed !== false) problems.push("sourceVerificationPerformed must be false");

  if (s.snapshotSchema !== SNAPSHOT_SCHEMA_VERSION) problems.push("snapshotSchema is missing or unsupported");
  if (!Array.isArray(s.evidence)) problems.push("evidence is not an array");
  else if (Array.isArray(s.documentConfidence)) {
    if (s.evidence.length !== s.documentConfidence.length) problems.push("evidence and documentConfidence differ in length");
    for (const assessment of s.documentConfidence) {
      const matches = s.evidence.filter((record: any) => record?.documentId === assessment?.documentId);
      const record = matches[0];
      if (matches.length !== 1) problems.push(`document ${assessment?.documentId} must have exactly one evidence record`);
      else if (record.docType !== assessment.documentType || record.evidenceStatus !== assessment.status || record.confidence !== assessment.confidence) problems.push(`evidence record for ${assessment.documentId} disagrees with its assessment`);
    }
    for (const record of s.evidence) {
      if (!isIso(record?.checkedAt) || !isIso(record?.uploadedAt)) problems.push(`evidence ${record?.documentId} has an invalid checkedAt/uploadedAt`);
      for (const key of ["issuedAt", "expiresAt"]) if (record?.[key] !== null && !isIso(record?.[key])) problems.push(`evidence ${record?.documentId} has an invalid ${key}`);
      if (!Number.isInteger(record?.revision)) problems.push(`evidence ${record?.documentId} has no revision`);
    }
  }

  if (problems.length) throw new SnapshotConstructionError(`Incomplete Trust Profile snapshot: ${problems.slice(0, 8).join("; ")}`);
}
