// Central registry: backend AuditAction -> how the event reads in the UI.
//
// Keys are the canonical actions the backend emits as of a834f0c (see
// src/modules/**/*.service.ts). Legacy names written by pre-finals databases
// (REJECTED, EXPIRED, DOCUMENT_SUBMITTED, ACCESS_GRANT_*, ...) are not mapped:
// `npm run demo:reset` no longer produces them, and any that remain fall back
// to a humanized label rather than being dropped.

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

function requesterSuffix(entry: AuditLogEntry) {
  const requester = entry.requester?.organization || entry.requester?.name;
  return requester ? `Requester: ${requester}` : undefined;
}

function scopeText(fields: unknown, evidence: unknown): string | undefined {
  return join(list(fields) && `Fields: ${list(fields)}`, list(evidence) && `Evidence: ${list(evidence)}`);
}

const SYSTEM = "Pramaan (automatic)";

const REGISTRY: Record<string, AuditEventDefinition> = {
  // Registered consent
  CONSENT_REQUESTED: {
    label: "Access requested",
    icon: Inbox,
    tone: "primary",
    describe: (e) => join(text(meta(e).purpose) && `Purpose: ${meta(e).purpose}`, scopeText(meta(e).requestedFields, meta(e).requestedEvidenceTypes)),
  },
  CONSENT_APPROVED: {
    label: "Access approved",
    icon: CheckCircle2,
    tone: "positive",
    describe: (e) => {
      const m = meta(e);
      return join(
        requesterSuffix(e),
        scopeText(m.approvedFields, m.approvedEvidenceTypes),
        typeof m.durationDays === "number" ? `For ${formatDurationDays(m.durationDays)}` : undefined,
        text(m.expiresAt) && `Until ${formatDateTime(String(m.expiresAt))}`
      );
    },
  },
  CONSENT_REJECTED: { label: "Access request declined", icon: XCircle, tone: "danger", describe: requesterSuffix },
  CONSENT_REVOKED: { label: "Access revoked", icon: Ban, tone: "danger", describe: requesterSuffix },
  // Expiry is time-based; the backend records the business owner as actor.
  CONSENT_EXPIRED: { label: "Access expired", icon: Clock, tone: "warning", actor: () => SYSTEM, describe: requesterSuffix },
  TRUST_VIEW_OPENED: {
    label: "Shared information viewed",
    icon: Eye,
    tone: "neutral",
    describe: (e) => scopeText(meta(e).fields, meta(e).evidenceTypes),
  },

  // Business profile and evidence
  BUSINESS_PROFILE_CREATED: { label: "Business profile created", icon: Pencil, tone: "primary" },
  BUSINESS_PROFILE_UPDATED: { label: "Business details updated", icon: Pencil, tone: "neutral", describe: () => "Claims changed; cross-check status reset until the next check" },
  EVIDENCE_UPLOADED: { label: "Evidence uploaded", icon: FileUp, tone: "primary", describe: (e) => evidenceText(e) },
  EVIDENCE_REPLACED: { label: "Evidence replaced", icon: FileUp, tone: "warning", describe: (e) => join(evidenceText(e), "Previous version kept in history") },
  BUSINESS_CROSS_CHECKED: {
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
  },
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
  TRUST_PROFILE_GENERATED: {
    label: "Trust Profile generated",
    icon: BadgeCheck,
    tone: "primary",
    describe: (e) => (typeof meta(e).version === "number" ? `Version ${meta(e).version}` : undefined),
  },

  // Readiness and reports (private to the MSME)
  READINESS_PROFILE_EVALUATED: { label: "Readiness evaluated", icon: Gauge, tone: "neutral" },
  READINESS_PROFILE_BLOCKED: { label: "Readiness blocked", icon: Gauge, tone: "warning" },
  REPORT_GENERATED: { label: "Report generated", icon: FileText, tone: "neutral" },
  REPORT_REVOKED: { label: "Report revoked", icon: FileText, tone: "danger" },
  REPORT_HTML_VIEWED: { label: "Report previewed", icon: FileText, tone: "neutral" },
  REPORT_HTML_DOWNLOADED: { label: "Report downloaded (HTML)", icon: FileText, tone: "neutral" },
  REPORT_PDF_DOWNLOADED: { label: "Report downloaded (PDF)", icon: FileText, tone: "neutral" },

  // Secure guest links
  GUEST_LINK_CREATED: {
    label: "Secure link created",
    icon: Link2,
    tone: "primary",
    describe: (e) => {
      const m = meta(e);
      const scope = (m.scope ?? {}) as Meta;
      return join(text(m.purpose) && `Purpose: ${m.purpose}`, scopeText(scope.fields, scope.evidenceTypes));
    },
  },
  GUEST_LINK_OPENED: {
    label: "Secure link opened",
    icon: Eye,
    tone: "neutral",
    // Guests have no account; the backend records the link owner as actor.
    actor: () => "Link recipient (no Pramaan account)",
    describe: (e) => scopeText(meta(e).fields, meta(e).evidenceTypes),
  },
  GUEST_LINK_REVOKED: { label: "Secure link revoked", icon: Ban, tone: "danger" },
  GUEST_LINK_EXPIRED: { label: "Secure link expired", icon: Clock, tone: "warning", actor: () => SYSTEM },
};

function evidenceText(e: AuditLogEntry): string | undefined {
  const m = meta(e);
  const type = text(m.documentType) ? documentTypeLabel(String(m.documentType)) : undefined;
  const version = typeof m.revision === "number" ? `version ${m.revision}` : undefined;
  return type && version ? `${type}, ${version}` : type;
}

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
