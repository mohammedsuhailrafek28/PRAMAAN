// Evidence Decision Firewall. Pure and deterministic: no clock, no I/O, no database, no module state.
// Specification: docs/EVIDENCE_DECISION_FIREWALL.md. Precedence (first match wins):
//   NOT_DISCLOSABLE > unsuitable snapshot > CONTRADICTED (visible) > visible insufficiency > withheld hidden conflict > SUPPORTED

import { DEFAULT_FIREWALL_POLICY, FIREWALL_LIMITATION } from "./firewall-policy.js";
import { isAuthorized, requiredItems } from "./firewall-authorization.js";
import { KNOWN_RESULTS, readSnapshot, type CheckView, type EvidenceView, type FieldView, type SnapshotView } from "./firewall-snapshot-reader.js";
import type { FirewallDecision, FirewallInput, FirewallPolicy, ReasonCode, Verdict } from "./firewall.types.js";

const decision = (verdict: Verdict, reasonCode: ReasonCode, snapshotVersion: number | null): FirewallDecision => ({
  verdict, reasonCode, basis: "SNAPSHOT_SCHEMA_2", snapshotVersion, scopeLimited: true, limitations: [FIREWALL_LIMITATION]
});

const NOT_DISCLOSABLE = (): FirewallDecision => decision("NOT_DISCLOSABLE", "NOT_DISCLOSABLE", null);
const UNAVAILABLE = (version: number | null): FirewallDecision => decision("INSUFFICIENT_EVIDENCE", "CONFIRMATION_UNAVAILABLE", version);
const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const resultOf = (checks: readonly CheckView[], type: string) => checks.filter((check) => check.type === type).map((check) => check.result);
const knownResult = (result: string) => (KNOWN_RESULTS as readonly string[]).includes(result);

type Currency = { valid: number; expired: number; other: number };

/** An evidence record supports a conclusion only if unexpired at assessment AND at `now`, and not rejected. */
function currency(records: readonly EvidenceView[], nowMs: number): Currency {
  const tally: Currency = { valid: 0, expired: 0, other: 0 };
  for (const record of records) {
    const expiredAtAssessment = record.evidenceStatus === "EXPIRED"
      || resultOf(record.checks, "EXPIRY").includes("FAILED")
      || (record.expiresAtMs !== null && record.expiresAtMs <= record.checkedAtMs);
    const expiredNow = record.expiresAtMs !== null && record.expiresAtMs <= nowMs;
    if (record.evidenceStatus === "REJECTED") tally.other += 1;
    else if (expiredAtAssessment || expiredNow) tally.expired += 1;
    else tally.valid += 1;
  }
  return tally;
}

function evidenceGap(tally: Currency, version: number): FirewallDecision | null {
  if (tally.valid > 0) return null;
  return decision("INSUFFICIENT_EVIDENCE", tally.expired > 0 ? "EVIDENCE_EXPIRED" : "EVIDENCE_MISSING", version);
}

/** Classifies every recorded contradiction against one field request. */
function classifyContradictions(view: SnapshotView, field: string | null, approvedFields: ReadonlySet<string>, approvedEvidence: ReadonlySet<string>, policy: FirewallPolicy) {
  let visible = false;
  let hidden = false;
  for (const contradiction of view.contradictions) {
    if (!has(policy.contradictionInvolves, contradiction.field)) { hidden = true; continue; } // unclassifiable: fail closed
    const involved = policy.contradictionInvolves[contradiction.field];
    if (field === null || !involved.some((item) => item.kind === "FIELD" && item.key === field)) continue; // not about this claim
    const allVisible = involved.every((item) => (item.kind === "FIELD" && approvedFields.has(item.key)) || (item.kind === "EVIDENCE" && approvedEvidence.has(item.key)));
    if (allVisible) visible = true; else hidden = true;
  }
  return { visible, hidden };
}

function checksAreConclusive(checks: readonly CheckView[], ignore: readonly string[] = []) {
  return checks.every((check) => knownResult(check.result) && (check.result !== "FAILED" || ignore.includes(check.type)));
}

function evaluateField(input: FirewallInput, view: SnapshotView, policy: FirewallPolicy, field: string, requireEvidence: boolean): FirewallDecision {
  const { authorization } = input;
  const approvedFields = new Set(authorization.approvedFields);
  const approvedEvidence = new Set(authorization.approvedEvidenceTypes);
  const version = view.version;
  const entry: FieldView | undefined = view.fields.get(field);

  const conflicts = classifyContradictions(view, field, approvedFields, approvedEvidence, policy);
  if (conflicts.visible) return decision("CONTRADICTED", "RECORDED_CONFLICT", version);

  if (!entry || !entry.present || resultOf(entry.checks, "CLAIM_PRESENT").includes("FAILED")) return decision("INSUFFICIENT_EVIDENCE", "CLAIM_NOT_PROVIDED", version);
  if (entry.checks.some((check) => !knownResult(check.result))) return UNAVAILABLE(version);

  // The field's own recorded consistency failure is a conflict with an unidentified counterparty: hidden.
  const ownConflict = resultOf(entry.checks, "INTERNAL_CONSISTENCY").includes("FAILED");

  if (requireEvidence) {
    if (!has(policy.fieldEvidence, field)) return decision("INSUFFICIENT_EVIDENCE", "NO_EVIDENCE_MAPPING", version);
    const accepted = policy.fieldEvidence[field];
    const records: EvidenceView[] = [];
    for (const id of entry.evidenceIds) {
      const record = view.evidence.get(id);
      if (!record || !accepted.includes(record.docType)) return UNAVAILABLE(version); // dangling or wrong-type reference = tampering
      records.push(record);
    }
    if (records.length === 0) return decision("INSUFFICIENT_EVIDENCE", "EVIDENCE_MISSING", version);
    const gap = evidenceGap(currency(records, Date.parse(input.now)), version);
    if (gap) return gap;
    // Only the field's recorded checks that this engine can classify may stand behind a positive verdict.
    if (!resultOf(entry.checks, "SUPPORTING_DOCUMENT").includes("PASSED") || resultOf(entry.checks, "SUPPORTING_DOCUMENT").includes("FAILED")) return UNAVAILABLE(version);
    if (!checksAreConclusive(entry.checks, ["INTERNAL_CONSISTENCY"])) return UNAVAILABLE(version);
    if (entry.status !== "CROSS_CHECKED" && entry.status !== "DOCUMENT_SUBMITTED") return UNAVAILABLE(version);
  } else if (!checksAreConclusive(entry.checks, ["INTERNAL_CONSISTENCY", "FORMAT", "SUPPORTING_DOCUMENT"])) {
    return UNAVAILABLE(version);
  }

  if (conflicts.hidden || ownConflict) return UNAVAILABLE(version); // D1: conservative withholding, no detail
  return requireEvidence ? decision("SUPPORTED", "SUPPORTED_INTERNALLY", version) : decision("SUPPORTED", "NO_RECORDED_CONFLICT", version);
}

function evaluateEvidenceCurrent(input: FirewallInput, view: SnapshotView, policy: FirewallPolicy, docType: string): FirewallDecision {
  const version = view.version;
  const records = [...view.evidence.values()].filter((record) => record.docType === docType);
  const tally = currency(records, Date.parse(input.now));
  if (records.length === 0) return decision("INSUFFICIENT_EVIDENCE", "EVIDENCE_MISSING", version);
  const gap = evidenceGap(tally, version);
  if (gap) return gap;
  if (records.some((record) => record.checks.some((check) => !knownResult(check.result)))) return UNAVAILABLE(version);
  // An unclassifiable recorded contradiction could involve any item: withhold rather than affirm.
  const conflicts = classifyContradictions(view, null, new Set(input.authorization.approvedFields), new Set(input.authorization.approvedEvidenceTypes), policy);
  if (conflicts.hidden) return UNAVAILABLE(version);
  return decision("SUPPORTED", "EVIDENCE_UNEXPIRED", version);
}

/** Evaluates one requested conclusion. Never throws; every malformed input resolves to a closed verdict. */
export function evaluateConclusion(input: FirewallInput, policy: FirewallPolicy = DEFAULT_FIREWALL_POLICY): FirewallDecision {
  let authorized = false;
  try {
    const required = requiredItems(input?.request, policy);
    authorized = isAuthorized(input?.authorization, input?.snapshotPassportId, required, input?.now);
    if (!authorized) return NOT_DISCLOSABLE();
    const view = readSnapshot(input.snapshot, input.snapshotPassportId);
    if (!view) return UNAVAILABLE(null);
    const { request } = input;
    if (request.kind === "EVIDENCE_CURRENT") return evaluateEvidenceCurrent(input, view, policy, request.docType);
    return evaluateField(input, view, policy, request.field, request.kind === "FIELD_SUPPORTED_BY_EVIDENCE");
  } catch {
    return authorized ? UNAVAILABLE(null) : NOT_DISCLOSABLE();
  }
}
