// Evidence Decision Firewall: public types. Plain data only; see docs/EVIDENCE_DECISION_FIREWALL.md.

export type ConclusionRequest =
  | { kind: "FIELD_SUPPORTED_BY_EVIDENCE"; field: string }
  | { kind: "FIELD_NOT_CONTRADICTED"; field: string }
  | { kind: "EVIDENCE_CURRENT"; docType: string };

export type AuthorizationChannel = "CONSENT" | "GUEST_LINK";

/** Everything the engine needs to know about the grant, as data. An adapter (not part of this module) builds it. */
export type AuthorizationContext = {
  channel: AuthorizationChannel;
  /** CONSENT: the ConsentStatus ("APPROVED" is the only live one). GUEST_LINK: "ACTIVE" is the only live one. */
  status: string;
  expiresAt: string | null;
  revokedAt: string | null;
  pinnedPassportId: string | null;
  approvedFields: readonly string[];
  approvedEvidenceTypes: readonly string[];
  /** The linked requester's assurance record, or null when there is none (an unregistered guest). */
  requester: null | {
    assuranceStatus: string;
    authorizationExpiresAt: string | null;
    authorizationScope: unknown;
  };
};

export type FirewallInput = {
  snapshot: unknown;
  snapshotPassportId: string;
  authorization: AuthorizationContext;
  request: ConclusionRequest;
  /** ISO instant. The engine never reads a clock. */
  now: string;
};

export type Verdict = "SUPPORTED" | "CONTRADICTED" | "INSUFFICIENT_EVIDENCE" | "NOT_DISCLOSABLE";

export type ReasonCode =
  | "SUPPORTED_INTERNALLY"
  | "NO_RECORDED_CONFLICT"
  | "EVIDENCE_UNEXPIRED"
  | "RECORDED_CONFLICT"
  | "CLAIM_NOT_PROVIDED"
  | "NO_EVIDENCE_MAPPING"
  | "EVIDENCE_MISSING"
  | "EVIDENCE_EXPIRED"
  | "CONFIRMATION_UNAVAILABLE"
  | "NOT_DISCLOSABLE";

export type FirewallDecision = {
  verdict: Verdict;
  reasonCode: ReasonCode;
  basis: "SNAPSHOT_SCHEMA_2";
  snapshotVersion: number | null;
  /** Constant: a verdict only covers what the requester is authorised to see. */
  scopeLimited: true;
  limitations: readonly string[];
};

export type InvolvedItem =
  | { kind: "FIELD"; key: string }
  | { kind: "EVIDENCE"; key: string }
  | { kind: "UNDISCLOSABLE"; key: string };

export type FirewallPolicy = {
  /** Evidence types that can support a field. A field with no entry cannot be supported by evidence. */
  fieldEvidence: Readonly<Record<string, readonly string[]>>;
  /** What each recorded contradiction involves. An unknown contradiction field fails closed. */
  contradictionInvolves: Readonly<Record<string, readonly InvolvedItem[]>>;
};
