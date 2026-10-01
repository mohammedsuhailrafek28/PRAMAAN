// Central registry: backend AuditAction -> a readable sentence for the MSME.
//
// Keys are the actions the backend emits (canonical list in
// docs/FINALS_BUILD.md §14). Legacy names from pre-finals databases fall back
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
import { parseScope, scopeLabelPhrase, scopeSize } from "@/lib/disclosure";
import { describeEvidenceStatus, humanize } from "@/lib/trustVocabulary";
import { formatDateTime, formatDurationDays, possessive } from "@/lib/utils";
import type { AuditLogEntry } from "@/types";

export type AuditTone = "primary" | "positive" | "warning" | "danger" | "neutral";
export type AuditCategory = "consent" | "links" | "evidence" | "profile" | "prepare";

export const AUDIT_CATEGORIES: { value: AuditCategory | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "consent", label: "Consent" },
  { value: "links", label: "Secure links" },
  { value: "evidence", label: "Evidence" },
  { value: "profile", label: "Checks & profile" },
  { value: "prepare", label: "Readiness & reports" },
];

interface AuditEventDefinition {
  label: string;
  icon: LucideIcon;
  tone: AuditTone;
  category: AuditCategory;
  sentence: (entry: AuditLogEntry) => string;
  detail?: (entry: AuditLogEntry) => string | undefined;
}

type Meta = Record<string, unknown>;
const meta = (entry: AuditLogEntry): Meta => entry.metadata ?? {};
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);
const requester = (entry: AuditLogEntry) => entry.requester?.organization || entry.requester?.name || "A verifier";
const actorOrg = (entry: AuditLogEntry) => entry.actor?.organization || entry.actor?.name || "A verifier";
const scopeOf = (fields: unknown, evidence: unknown) => parseScope(fields, evidence).scope;
const docLabel = (entry: AuditLogEntry) => (text(meta(entry).documentType) ? documentTypeLabel(String(meta(entry).documentType)).toLowerCase() : "evidence");

const REGISTRY: Record<string, AuditEventDefinition> = {
  // Registered consent
  CONSENT_REQUESTED: {
    label: "Access requested", icon: Inbox, tone: "primary", category: "consent",
    sentence: (e) => {
      const purpose = text(meta(e).purpose);
      // Older/seeded rows may lack scope metadata; fall back to the related consent's requested scope.
      const fromMeta = scopeOf(meta(e).requestedFields, meta(e).requestedEvidenceTypes);
      const scope = scopeSize(fromMeta) ? fromMeta : e.requestScope;
      const what = scope && scopeSize(scope) ? ` ${scopeLabelPhrase(scope)}` : " access";
      return `${actorOrg(e)} requested${what}${purpose ? ` for ${purpose}` : ""}.`;
    },
  },
  CONSENT_APPROVED: {
    label: "Access approved", icon: CheckCircle2, tone: "positive", category: "consent",
    sentence: (e) => {
      const approved = scopeOf(meta(e).approvedFields, meta(e).approvedEvidenceTypes);
      const of = e.requestScope ? ` of ${scopeSize(e.requestScope)}` : "";
      const days = typeof meta(e).durationDays === "number" ? ` for ${formatDurationDays(meta(e).durationDays as number)}` : "";
      return `You approved ${scopeSize(approved)}${of} requested item${scopeSize(approved) === 1 ? "" : "s"} for ${requester(e)}${days}.`;
    },
    detail: (e) => {
      const approved = scopeOf(meta(e).approvedFields, meta(e).approvedEvidenceTypes);
      return `${scopeLabelPhrase(approved, 6)}${text(meta(e).expiresAt) ? ` · until ${formatDateTime(String(meta(e).expiresAt))}` : ""}`;
    },
  },
  CONSENT_REJECTED: { label: "Request declined", icon: XCircle, tone: "danger", category: "consent", sentence: (e) => `You declined ${possessive(requester(e))} request. Nothing was shared.` },
  CONSENT_REVOKED: { label: "Access revoked", icon: Ban, tone: "danger", category: "consent", sentence: (e) => `You revoked ${possessive(requester(e))} access.` },
  CONSENT_EXPIRED: { label: "Access expired", icon: Clock, tone: "warning", category: "consent", sentence: (e) => `${possessive(requester(e))} access expired.` },
  TRUST_VIEW_OPENED: {
    label: "Shared information viewed", icon: Eye, tone: "neutral", category: "consent",
    sentence: (e) => `${actorOrg(e)} viewed the information you shared.`,
    detail: (e) => scopeLabelPhrase(scopeOf(meta(e).fields, meta(e).evidenceTypes), 6),
  },

  // Secure links
  GUEST_LINK_CREATED: {
    label: "Secure link created", icon: Link2, tone: "primary", category: "links",
    sentence: (e) => `You created a secure link${text(meta(e).purpose) ? ` for ${String(meta(e).purpose).toLowerCase()}` : ""}.`,
    detail: (e) => { const scope = (meta(e).scope ?? {}) as Meta; return scopeLabelPhrase(scopeOf(scope.fields, scope.evidenceTypes), 6); },
  },
  GUEST_LINK_OPENED: {
    label: "Secure link opened", icon: Eye, tone: "neutral", category: "links",
    sentence: () => "Someone with your secure link opened it.",
    detail: (e) => scopeLabelPhrase(scopeOf(meta(e).fields, meta(e).evidenceTypes), 6),
  },
  GUEST_LINK_REVOKED: { label: "Secure link revoked", icon: Ban, tone: "danger", category: "links", sentence: () => "You revoked a secure link." },
  GUEST_LINK_EXPIRED: { label: "Secure link expired", icon: Clock, tone: "warning", category: "links", sentence: () => "A secure link expired." },

  // Evidence
  EVIDENCE_UPLOADED: { label: "Evidence uploaded", icon: FileUp, tone: "primary", category: "evidence", sentence: (e) => `You uploaded your ${docLabel(e)}${typeof meta(e).revision === "number" ? ` (version ${meta(e).revision})` : ""}.` },
  EVIDENCE_REPLACED: { label: "Evidence replaced", icon: FileUp, tone: "warning", category: "evidence", sentence: (e) => `You replaced your ${docLabel(e)}${typeof meta(e).revision === "number" ? ` with version ${meta(e).revision}` : ""}. The previous version is kept in history.` },

  // Checks and Trust Profile
  BUSINESS_PROFILE_CREATED: { label: "Business profile created", icon: Pencil, tone: "primary", category: "profile", sentence: () => "You created your business profile." },
  BUSINESS_PROFILE_UPDATED: { label: "Business details updated", icon: Pencil, tone: "neutral", category: "profile", sentence: () => "You updated your business details. The cross-check status resets until the next check." },
  BUSINESS_CROSS_CHECKED: {
    label: "Internal cross-check run", icon: ListChecks, tone: "primary", category: "profile",
    sentence: (e) => `Pramaan ran an internal cross-check${text(meta(e).trustStatus) ? `: ${describeEvidenceStatus(String(meta(e).trustStatus)).label.toLowerCase()}` : ""}.`,
    detail: (e) => {
      const m = meta(e);
      if (typeof m.gapCount !== "number" && typeof m.contradictionCount !== "number") return undefined;
      return `${m.gapCount ?? 0} gap${m.gapCount === 1 ? "" : "s"} · ${m.contradictionCount ?? 0} conflict${m.contradictionCount === 1 ? "" : "s"}`;
    },
  },
  EVIDENCE_GAP_FOUND: { label: "Evidence gap found", icon: TriangleAlert, tone: "warning", category: "profile", sentence: (e) => `Evidence gap: ${text(meta(e).field) ? backendFieldLabel(String(meta(e).field)).toLowerCase() : "a claim"}.`, detail: (e) => text(meta(e).message) },
  CONTRADICTION_FOUND: { label: "Conflict found", icon: TriangleAlert, tone: "danger", category: "profile", sentence: (e) => `Conflict found in ${text(meta(e).field) ? backendFieldLabel(String(meta(e).field)).toLowerCase() : "your claims"}.`, detail: (e) => text(meta(e).reason) },
  TRUST_PROFILE_GENERATED: { label: "Trust Profile generated", icon: BadgeCheck, tone: "primary", category: "profile", sentence: (e) => `You generated Trust Profile${typeof meta(e).version === "number" ? ` version ${meta(e).version}` : ""}.` },

  // Readiness and reports (private to the MSME)
  READINESS_PROFILE_EVALUATED: { label: "Readiness checked", icon: Gauge, tone: "neutral", category: "prepare", sentence: (e) => `You checked readiness${text(meta(e).profileId) ? ` for ${humanize(String(meta(e).profileId)).toLowerCase()}` : ""}${typeof meta(e).score === "number" ? `: ${meta(e).score}%` : ""}.` },
  READINESS_PROFILE_BLOCKED: { label: "Readiness blocked", icon: Gauge, tone: "warning", category: "prepare", sentence: () => "A readiness check found a blocking issue." },
  REPORT_GENERATED: { label: "Report generated", icon: FileText, tone: "neutral", category: "prepare", sentence: (e) => (text(meta(e).reportType) ? `You generated a ${humanize(String(meta(e).reportType)).toLowerCase()} report.` : "You generated a report.") },
  REPORT_REVOKED: { label: "Report revoked", icon: FileText, tone: "danger", category: "prepare", sentence: () => "You revoked a report." },
  REPORT_HTML_VIEWED: { label: "Report previewed", icon: FileText, tone: "neutral", category: "prepare", sentence: () => "You previewed a report." },
  REPORT_HTML_DOWNLOADED: { label: "Report downloaded", icon: FileText, tone: "neutral", category: "prepare", sentence: () => "You downloaded a report (HTML)." },
  REPORT_PDF_DOWNLOADED: { label: "Report downloaded", icon: FileText, tone: "neutral", category: "prepare", sentence: () => "You downloaded a report (PDF)." },
};

export interface RenderedAuditEvent {
  label: string;
  sentence: string;
  detail?: string;
  icon: LucideIcon;
  tone: AuditTone;
  category?: AuditCategory;
  known: boolean;
}

export function renderAuditEvent(entry: AuditLogEntry): RenderedAuditEvent {
  const definition = REGISTRY[entry.action];
  if (!definition) {
    return { label: humanize(entry.action), sentence: `${humanize(entry.action)}.`, icon: Circle, tone: "neutral", known: false };
  }
  return {
    label: definition.label,
    sentence: definition.sentence(entry),
    detail: definition.detail?.(entry),
    icon: definition.icon,
    tone: definition.tone,
    category: definition.category,
    known: true,
  };
}

export function auditCategory(entry: AuditLogEntry): AuditCategory | undefined {
  return REGISTRY[entry.action]?.category;
}

/** Group key for collapsing consecutive identical events (e.g. repeated views). */
export function auditGroupKey(entry: AuditLogEntry): string {
  return [entry.action, entry.actor?.name ?? "", entry.consentId ?? "", entry.accessGrantId ?? ""].join("|");
}
