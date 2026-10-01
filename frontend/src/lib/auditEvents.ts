// Central registry: backend AuditAction -> how the event reads in the UI.
//
// Keys cover every value of the Prisma `AuditAction` enum as of 8b9c2e7,
// including legacy names the backend still writes (REJECTED, EXPIRED, ...),
// plus the normalized names Codex is expected to emit (CONSENT_REJECTED,
// CONSENT_EXPIRED). Unknown actions fall back to a humanized label so new
// backend events are never silently dropped.

import {
  Ban,
  BadgeCheck,
  CheckCircle2,
  Circle,
  Clock,
  Eye,
  FileText,
  FileUp,
  Gauge,
  Inbox,
  Link2,
  ListChecks,
  Pencil,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { backendFieldLabel, documentTypeLabel } from "@/lib/fieldLabels";
import { describeEvidenceStatus, humanize } from "@/lib/trustVocabulary";
import { formatDateTime, formatDurationDays } from "@/lib/utils";
import type { AuditActor, AuditLogEntry } from "@/types";

export type AuditTone = "primary" | "positive" | "warning" | "danger" | "neutral";

interface AuditEventDefinition {
  label: string;
  icon: LucideIcon;
  tone: AuditTone;
  /** Who should be credited; defaults to the recorded actor. */
  actor?: (entry: AuditLogEntry) => string | undefined;
  describe?: (entry: AuditLogEntry) => string | undefined;
}

type Meta = Record<string, unknown>;

function list(value: unknown, mapper: (item: string) => string = backendFieldLabel): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.map((item) => mapper(String(item))).join(", ");
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function join(...parts: (string | undefined)[]): string | undefined {
  const present = parts.filter(Boolean);
  return present.length ? present.join(" · ") : undefined;
}

function meta(entry: AuditLogEntry): Meta {
  return entry.metadata ?? {};
}

export function formatActor(actor?: AuditActor): string | undefined {
  if (!actor) return undefined;
  const role = actor.role === "bank" ? "Bank / NBFC" : actor.role === "buyer" ? "Buyer" : actor.role === "msme" ? "MSME" : undefined;
  const who = actor.name && actor.organization && actor.name !== actor.organization ? `${actor.name}, ${actor.organization}` : actor.name || actor.organization;
  return join(who, role);
}

const requesterSuffix = (entry: AuditLogEntry) => {
  const requester = entry.requester?.organization || entry.requester?.name;
  return requester ? `Requester: ${requester}` : undefined;
};

const consentRequested: AuditEventDefinition = {
  label: "Access requested",
  icon: Inbox,
  tone: "primary",
  describe: (e) => join(text(meta(e).purpose) && `Purpose: ${meta(e).purpose}`, list(meta(e).requestedFields) && `Fields: ${list(meta(e).requestedFields)}`),
};

const consentApproved: AuditEventDefinition = {
  label: "Access approved for selected fields",
  icon: CheckCircle2,
  tone: "positive",
  describe: (e) => {
    const m = meta(e);
    return join(
      requesterSuffix(e),
      list(m.approvedFields) && `Fields: ${list(m.approvedFields)}`,
      typeof m.durationDays === "number" ? `For ${formatDurationDays(m.durationDays)}` : undefined,
      text(m.expiresAt) && `Until ${formatDateTime(String(m.expiresAt))}`
    );
  },
};

const consentRejected: AuditEventDefinition = { label: "Access request declined", icon: XCircle, tone: "danger", describe: requesterSuffix };
const consentRevoked: AuditEventDefinition = { label: "Access revoked", icon: Ban, tone: "danger", describe: requesterSuffix };

const consentExpired: AuditEventDefinition = {
  label: "Access expired",
  icon: Clock,
  tone: "warning",
  // Expiry is a time-based system event, even if the backend records the
  // verifier whose request detected it.
  actor: () => "Pramaan (automatic)",
  describe: requesterSuffix,
};

const trustProfileViewed: AuditEventDefinition = {
  label: "Trust Profile viewed under consent",
  icon: Eye,
  tone: "neutral",
  describe: (e) => list(meta(e).fields) && `Fields seen: ${list(meta(e).fields)}`,
};

const trustProfileGenerated: AuditEventDefinition = {
  label: "Trust Profile generated",
  icon: BadgeCheck,
  tone: "primary",
  describe: (e) => (typeof meta(e).version === "number" ? `Version ${meta(e).version}` : undefined),
};

const crossChecked: AuditEventDefinition = {
  label: "Internal cross-check run",
  icon: ListChecks,
  tone: "primary",
  describe: (e) => {
    const m = meta(e);
    return join(
      text(m.trustStatus) && `Result: ${describeEvidenceStatus(String(m.trustStatus)).label}`,
      typeof m.gapCount === "number" ? `${m.gapCount} gap${m.gapCount === 1 ? "" : "s"}` : undefined,
      typeof m.contradictionCount === "number" ? `${m.contradictionCount} conflict${m.contradictionCount === 1 ? "" : "s"}` : undefined
    );
  },
};

const REGISTRY: Record<string, AuditEventDefinition> = {
  // Consent lifecycle (canonical + legacy aliases)
  CONSENT_REQUESTED: consentRequested,
  REQUESTED: consentRequested,
  CONSENT_APPROVED: consentApproved,
  APPROVED: consentApproved,
  CONSENT_REJECTED: consentRejected,
  REJECTED: consentRejected,
  CONSENT_REVOKED: consentRevoked,
  REVOKED: consentRevoked,
  CONSENT_EXPIRED: consentExpired,
  EXPIRED: consentExpired,
  TRUST_PROFILE_VIEWED: trustProfileViewed,
  VIEWED: trustProfileViewed,

  // Business profile and evidence
  BUSINESS_PROFILE_CREATED: { label: "Business profile created", icon: Pencil, tone: "primary" },
  BUSINESS_PROFILE_UPDATED: { label: "Business details updated", icon: Pencil, tone: "neutral", describe: () => "Claims changed; cross-check status reset until the next check" },
  DOCUMENT_SUBMITTED: {
    label: "Evidence uploaded",
    icon: FileUp,
    tone: "primary",
    describe: (e) => {
      const m = meta(e);
      const type = text(m.documentType) ? documentTypeLabel(String(m.documentType)) : undefined;
      const version = typeof m.revision === "number" ? `version ${m.revision}` : undefined;
      return join(type && version ? `${type}, ${version}` : type, m.replacedDocumentId ? "Replaced the previous version" : undefined);
    },
  },
  BUSINESS_CROSS_CHECKED: crossChecked,
  BUSINESS_VERIFIED: crossChecked,
  EVIDENCE_GAP_FOUND: {
    label: "Evidence gap found",
    icon: TriangleAlert,
    tone: "warning",
    describe: (e) => join(text(meta(e).field) && backendFieldLabel(String(meta(e).field)), text(meta(e).message)),
  },
  CONTRADICTION_FOUND: {
    label: "Conflict found",
    icon: TriangleAlert,
    tone: "danger",
    describe: (e) => join(text(meta(e).field) && backendFieldLabel(String(meta(e).field)), text(meta(e).reason)),
  },
  TRUST_PROFILE_GENERATED: trustProfileGenerated,
  PASSPORT_GENERATED: trustProfileGenerated,

  // Readiness and reports (private to the MSME)
  READINESS_PROFILE_EVALUATED: { label: "Readiness evaluated", icon: Gauge, tone: "neutral" },
  READINESS_PROFILE_BLOCKED: { label: "Readiness blocked", icon: Gauge, tone: "warning" },
  READINESS_PROFILE_SHARED: { label: "Readiness summary shared", icon: Gauge, tone: "primary" },
  REPORT_GENERATED: { label: "Report generated", icon: FileText, tone: "neutral" },
  REPORT_REVOKED: { label: "Report revoked", icon: FileText, tone: "danger" },
  REPORT_HTML_VIEWED: { label: "Report previewed", icon: FileText, tone: "neutral" },
  REPORT_HTML_DOWNLOADED: { label: "Report downloaded (HTML)", icon: FileText, tone: "neutral" },
  REPORT_PDF_DOWNLOADED: { label: "Report downloaded (PDF)", icon: FileText, tone: "neutral" },

  // Secure guest links
  ACCESS_GRANT_CREATED: {
    label: "Secure link created",
    icon: Link2,
    tone: "primary",
    describe: (e) => {
      const m = meta(e);
      const scope = (m.scope ?? {}) as Meta;
      return join(
        text(m.purpose) && `Purpose: ${m.purpose}`,
        list(scope.fields) && `Fields: ${list(scope.fields)}`,
        list(scope.evidenceTypes, documentTypeLabel) && `Evidence: ${list(scope.evidenceTypes, documentTypeLabel)}`
      );
    },
  },
  ACCESS_GRANT_VIEWED: {
    label: "Secure link opened",
    icon: Eye,
    tone: "neutral",
    // Guests have no account; the backend records the link owner as actor.
    actor: () => "Link recipient (no Pramaan account)",
    describe: (e) => join(list(meta(e).fields) && `Fields seen: ${list(meta(e).fields)}`, list(meta(e).evidenceTypes, documentTypeLabel) && `Evidence seen: ${list(meta(e).evidenceTypes, documentTypeLabel)}`),
  },
  ACCESS_GRANT_REVOKED: { label: "Secure link revoked", icon: Ban, tone: "danger" },
  ACCESS_GRANT_EXPIRED: { label: "Secure link expired", icon: Clock, tone: "warning", actor: () => "Pramaan (automatic)" },
};

export interface RenderedAuditEvent {
  label: string;
  icon: LucideIcon;
  tone: AuditTone;
  actor?: string;
  description?: string;
  known: boolean;
}

export function renderAuditEvent(entry: AuditLogEntry): RenderedAuditEvent {
  const definition = REGISTRY[entry.action];
  if (!definition) {
    return { label: humanize(entry.action), icon: Circle, tone: "neutral", actor: formatActor(entry.actor), known: false };
  }
  return {
    label: definition.label,
    icon: definition.icon,
    tone: definition.tone,
    actor: definition.actor?.(entry) ?? formatActor(entry.actor),
    description: definition.describe?.(entry),
    known: true,
  };
}

/** Group key for collapsing consecutive identical events (e.g. repeated views). */
export function auditGroupKey(entry: AuditLogEntry): string {
  return [entry.action, entry.actor?.name ?? "", entry.consentId ?? "", entry.accessGrantId ?? ""].join("|");
}
