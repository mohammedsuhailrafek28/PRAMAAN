// Requester identity assurance: how well Pramaan knows who is asking.
//
// Levels (shared with the backend contract):
//   UNVERIFIED    Self-registered; organisation and account authority not independently checked.
//   ORG_REVIEWED  Organisation identity reviewed; the account's authority is NOT necessarily established.
//   AUTHORIZED    Organisation and requester authority independently reviewed, subject to expiry and scope.
//   SUSPENDED     Requester privileges disabled.
//
// This module is framework-free so it can be unit-tested. It never decides
// access: the backend enforces. Everything here is explanation, and it fails
// conservatively: anything missing, malformed or expired reads as UNVERIFIED.
//
// Backend shape assumed (adapter below accepts it on `requesterIdentity`, or on
// `requester.requesterIdentity`; field names other than these are ignored):
//   { assurance: "UNVERIFIED"|"ORG_REVIEWED"|"AUTHORIZED"|"SUSPENDED",
//     claimedOrganizationName?: string,   // what the requester typed at registration
//     reviewedOrganizationName?: string,  // what a reviewer confirmed
//     reviewedAt?: ISO date, expiresAt?: ISO date, basis?: string }

import type { StatusTone } from "@/lib/trustVocabulary";
import type { DisclosureItem, DisclosureScope } from "@/lib/disclosure";
import { disclosureItem } from "@/lib/disclosure";
import { formatDate, parseDate } from "@/lib/utils";

export type AssuranceLevel = "UNVERIFIED" | "ORG_REVIEWED" | "AUTHORIZED" | "SUSPENDED";
const LEVELS: readonly AssuranceLevel[] = ["UNVERIFIED", "ORG_REVIEWED", "AUTHORIZED", "SUSPENDED"];

export interface RequesterIdentity {
  /** The level the backend reported (conservatively parsed). Use `effectiveAssurance` for what is in force now. */
  level: AssuranceLevel;
  claimedOrganization?: string;
  reviewedOrganization?: string;
  reviewedAt?: string;
  expiresAt?: string;
  basis?: string;
  /** The backend sent identity metadata that could not be understood; the requester is treated as UNVERIFIED. */
  malformed: boolean;
}

export const UNVERIFIED_IDENTITY: RequesterIdentity = { level: "UNVERIFIED", malformed: false };

const MAX_TEXT = 240;

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_TEXT) : undefined;
}

function cleanDate(value: unknown): { iso?: string; invalid: boolean } {
  if (value === undefined || value === null || value === "") return { invalid: false };
  const date = typeof value === "string" ? parseDate(value) : null;
  return date ? { iso: date.toISOString(), invalid: false } : { invalid: true };
}

/** Parses the backend's identity object. Never throws; unknown or broken input becomes UNVERIFIED. */
export function parseRequesterIdentity(raw: unknown, claimedFallback?: string): RequesterIdentity {
  const claimedDefault = cleanText(claimedFallback);
  if (raw === undefined || raw === null) return { ...UNVERIFIED_IDENTITY, claimedOrganization: claimedDefault };
  if (typeof raw !== "object" || Array.isArray(raw)) return { level: "UNVERIFIED", claimedOrganization: claimedDefault, malformed: true };

  const record = raw as Record<string, unknown>;
  const token = typeof record.assurance === "string" ? record.assurance.trim().toUpperCase() : "";
  const claimedOrganization = cleanText(record.claimedOrganizationName) ?? claimedDefault;
  if (!LEVELS.includes(token as AssuranceLevel)) return { level: "UNVERIFIED", claimedOrganization, malformed: true };

  const reviewedAt = cleanDate(record.reviewedAt);
  const expiresAt = cleanDate(record.expiresAt);
  const level = token as AssuranceLevel;
  // A review whose dates we cannot read cannot be shown as in force.
  if ((level === "ORG_REVIEWED" || level === "AUTHORIZED") && (reviewedAt.invalid || expiresAt.invalid)) {
    return { level: "UNVERIFIED", claimedOrganization, malformed: true };
  }
  return {
    level,
    claimedOrganization,
    reviewedOrganization: cleanText(record.reviewedOrganizationName),
    reviewedAt: reviewedAt.iso,
    expiresAt: expiresAt.iso,
    basis: cleanText(record.basis),
    malformed: false,
  };
}

/** Pulls the identity object out of a consent/user payload, wherever the backend nests it. */
export function identityFromPayload(raw: any, claimedFallback?: string): RequesterIdentity {
  return parseRequesterIdentity(raw?.requesterIdentity ?? raw?.requester?.requesterIdentity, claimedFallback);
}

export interface EffectiveAssurance {
  /** What is actually in force now. A lapsed review counts as UNVERIFIED. */
  level: AssuranceLevel;
  /** The reported review has expired and must not look active. */
  lapsed: boolean;
}

export function effectiveAssurance(identity: RequesterIdentity, now: number = Date.now()): EffectiveAssurance {
  if (identity.level === "SUSPENDED") return { level: "SUSPENDED", lapsed: false };
  if (identity.level === "UNVERIFIED") return { level: "UNVERIFIED", lapsed: false };
  const expiry = parseDate(identity.expiresAt)?.getTime();
  if (expiry !== undefined && expiry <= now) return { level: "UNVERIFIED", lapsed: true };
  return { level: identity.level, lapsed: false };
}

export interface AssuranceDescriptor {
  /** Short badge text. Always meaningful on its own (never colour-only). */
  label: string;
  tone: StatusTone;
  icon: "check" | "clock" | "alert" | "x" | "ban" | "minus" | "dot";
  /** One sentence for the card. */
  summary: string;
  proves: string[];
  doesNotProve: string[];
}

const NOT_ENDORSEMENT = "It is not an endorsement of the organisation, and not approval by any regulator or government body.";

export function describeAssurance(identity: RequesterIdentity, now: number = Date.now()): AssuranceDescriptor {
  const { level, lapsed } = effectiveAssurance(identity, now);

  if (level === "SUSPENDED") {
    return {
      label: "Requester suspended",
      tone: "negative",
      icon: "ban",
      summary: "This requester's privileges have been disabled. Do not share information with them.",
      proves: ["Pramaan has disabled this account's ability to request or open information."],
      doesNotProve: ["It does not say why the account was suspended."],
    };
  }

  if (lapsed) {
    const was = identity.level === "AUTHORIZED" ? "authorization review" : "organization review";
    return {
      label: "Review expired · Not currently checked",
      tone: "warning",
      icon: "clock",
      summary: `This requester's ${was}${identity.expiresAt ? ` ended on ${formatDate(identity.expiresAt)}` : " has ended"}. Treat them as not independently checked.`,
      proves: ["The account was reviewed in the past."],
      doesNotProve: ["Nothing about this requester is currently confirmed by Pramaan, including who they are or whether they may act for the organisation."],
    };
  }

  if (level === "AUTHORIZED") {
    return {
      label: `Requester authorization reviewed${identity.expiresAt ? ` · Expires ${formatDate(identity.expiresAt)}` : ""}`,
      tone: "positive",
      icon: "check",
      summary: "Pramaan reviewed both the organization and this requester's authority to act for it. This applies only until the review expires.",
      proves: ["The organization named below was reviewed.", "This requester's authority to act for it was reviewed."],
      doesNotProve: [NOT_ENDORSEMENT, "It does not mean this particular request is appropriate. That is still your decision."],
    };
  }

  if (level === "ORG_REVIEWED") {
    return {
      label: "Organization reviewed · Authority not established",
      tone: "info",
      icon: "minus",
      summary: "Pramaan reviewed the organization's identity, but has not established that this account may act for it.",
      proves: ["The organization named below was reviewed."],
      doesNotProve: ["It does not show that the person using this account is authorised to represent the organization.", NOT_ENDORSEMENT],
    };
  }

  return {
    label: "Self-registered · Not independently checked",
    tone: "warning",
    icon: "alert",
    summary: identity.malformed
      ? "Pramaan could not read this requester's review details, so they are treated as not checked."
      : "Anyone can register with any organization name. Pramaan has not checked this organization or this person's authority.",
    proves: ["Someone created an account and typed this name."],
    doesNotProve: ["It does not show the organization exists, or that this person works for it."],
  };
}

/** True when the requester should be treated with caution before anything is shared. */
export function needsCaution(identity: RequesterIdentity, now: number = Date.now()): boolean {
  const { level } = effectiveAssurance(identity, now);
  return level === "UNVERIFIED" || level === "SUSPENDED";
}

const norm = (value?: string) => (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export interface OrganizationNames {
  /** The name to show first. Reviewed name only while a review is in force. */
  primary: string;
  primaryIsReviewed: boolean;
  /** What the requester typed, shown separately when it differs from (or is not backed by) a review. */
  claimed?: string;
  /** A reviewed name from a review that is no longer in force; never shown as current. */
  previouslyReviewed?: string;
  claimedDiffersFromReviewed: boolean;
}

export function organizationNames(identity: RequesterIdentity, fallbackName: string, now: number = Date.now()): OrganizationNames {
  const { level } = effectiveAssurance(identity, now);
  const claimed = identity.claimedOrganization ?? cleanText(fallbackName);
  const reviewedInForce = (level === "ORG_REVIEWED" || level === "AUTHORIZED") ? identity.reviewedOrganization : undefined;
  if (reviewedInForce) {
    const differs = Boolean(claimed) && norm(claimed) !== norm(reviewedInForce);
    return { primary: reviewedInForce, primaryIsReviewed: true, claimed: differs ? claimed : undefined, claimedDiffersFromReviewed: differs };
  }
  return {
    primary: claimed ?? "Unnamed requester",
    primaryIsReviewed: false,
    claimed: undefined,
    previouslyReviewed: identity.reviewedOrganization && identity.level !== "UNVERIFIED" ? identity.reviewedOrganization : undefined,
    claimedDiffersFromReviewed: false,
  };
}

/** Plain phrase for the requester's status when it needs flagging, e.g. "self-registered, not checked". Empty when a review is in force. */
export function identityNote(identity: RequesterIdentity, now: number = Date.now()): string {
  const { level, lapsed } = effectiveAssurance(identity, now);
  if (level === "SUSPENDED") return "suspended";
  if (lapsed) return "review expired";
  if (level === "UNVERIFIED") return "self-registered, not checked";
  return "";
}

/** Suffix for sentences, e.g. "Acme Retail (self-registered, not checked)". */
export function identityQualifier(identity: RequesterIdentity, now: number = Date.now()): string {
  const note = identityNote(identity, now);
  return note ? ` (${note})` : "";
}

// ---- Restricted disclosure (explanatory only; the backend is the boundary) ----

/**
 * Assumption pending the final backend rule: HIGH-sensitivity items need an
 * in-force AUTHORIZED review; a suspended requester can request nothing.
 * Change this one function if the backend policy differs.
 */
export function isRestrictedFor(item: DisclosureItem | undefined, identity: RequesterIdentity, now: number = Date.now()): boolean {
  const { level } = effectiveAssurance(identity, now);
  if (level === "SUSPENDED") return true;
  return item?.sensitivity === "HIGH" && level !== "AUTHORIZED";
}

export function restrictedItems(scope: DisclosureScope, identity: RequesterIdentity, now: number = Date.now()): DisclosureItem[] {
  return [...scope.fields, ...scope.evidence]
    .map((key) => disclosureItem(key))
    .filter((item): item is DisclosureItem => Boolean(item) && isRestrictedFor(item, identity, now));
}

export function restrictionMessage(identity: RequesterIdentity, items: DisclosureItem[], now: number = Date.now()): string | undefined {
  if (items.length === 0) return undefined;
  const { level, lapsed } = effectiveAssurance(identity, now);
  const names = items.map((item) => item.label).join(", ");
  if (level === "SUSPENDED") return "Your account is suspended, so requests will be refused.";
  const why = lapsed ? "Your review has expired" : level === "ORG_REVIEWED" ? "Your organization has been reviewed, but your authority to act for it has not" : "Your organization is self-registered and not independently checked";
  return `${why}. Pramaan may refuse requests for higher-sensitivity items (${names}) until your authorization is reviewed. Businesses also see this status.`;
}

// ---- Approval gate (explanatory friction, not a security control) ----

export function approvalNeedsAcknowledgement(identity: RequesterIdentity, now: number = Date.now()): boolean {
  return effectiveAssurance(identity, now).level === "UNVERIFIED";
}

export interface ApprovalGate {
  canApprove: boolean;
  /** Why the button is disabled, in words. */
  reason?: string;
}

export function approvalGate(input: { identity: RequesterIdentity; selectedCount: number; acknowledged: boolean; submitting: boolean; now?: number }): ApprovalGate {
  const now = input.now ?? Date.now();
  const { level } = effectiveAssurance(input.identity, now);
  if (input.submitting) return { canApprove: false };
  if (level === "SUSPENDED") return { canApprove: false, reason: "This requester is suspended. You can decline the request." };
  if (input.selectedCount === 0) return { canApprove: false, reason: "Select at least one item to share." };
  if (approvalNeedsAcknowledgement(input.identity, now) && !input.acknowledged) return { canApprove: false, reason: "Confirm that you understand this requester has not been independently checked." };
  return { canApprove: true };
}
