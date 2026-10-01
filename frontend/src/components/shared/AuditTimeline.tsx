import {
  ShieldCheck,
  FileUp,
  BadgeCheck,
  Inbox,
  CheckCircle2,
  XCircle,
  Eye,
  Ban,
  Clock,
  type LucideIcon,
} from "lucide-react";

import { AUDIT_ACTION_LABELS, type AuditAction, type AuditLogEntry } from "@/types";
import { formatDateTime } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";

const ACTION_ICON: Record<AuditAction, LucideIcon> = {
  business_verified: ShieldCheck,
  evidence_uploaded: FileUp,
  evidence_replaced: FileUp,
  trust_profile_generated: BadgeCheck,
  consent_requested: Inbox,
  consent_approved: CheckCircle2,
  consent_rejected: XCircle,
  consent_viewed: Eye,
  consent_revoked: Ban,
  consent_expired: Clock,
};

const ACTION_TONE: Record<AuditAction, string> = {
  business_verified: "bg-verified-bg text-verified-foreground",
  evidence_uploaded: "bg-primary-50 text-primary-700",
  evidence_replaced: "bg-warning-bg text-warning-foreground",
  trust_profile_generated: "bg-primary-50 text-primary-700",
  consent_requested: "bg-primary-50 text-primary-700",
  consent_approved: "bg-verified-bg text-verified-foreground",
  consent_rejected: "bg-destructive/10 text-destructive",
  consent_viewed: "bg-secondary text-slate-600",
  consent_revoked: "bg-destructive/10 text-destructive",
  consent_expired: "bg-warning-bg text-warning-foreground",
};

interface AuditTimelineProps {
  logs: AuditLogEntry[];
}

/** Vertical, reverse-chronological timeline of every consent-related event. */
export function AuditTimeline({ logs }: AuditTimelineProps) {
  if (logs.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title="No activity yet"
        description="Your audit trail will appear here as your business is verified and stakeholders request access."
      />
    );
  }

  return (
    <ol className="relative space-y-6 pl-2">
      <div className="absolute bottom-4 left-[19px] top-4 w-px bg-border" aria-hidden />
      {logs.map((log) => {
        const Icon = ACTION_ICON[log.action];
        return (
          <li key={log.id} className="relative flex gap-4">
            <div
              className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${ACTION_TONE[log.action]}`}
            >
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1 pb-1 pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-medium text-slate-900">{AUDIT_ACTION_LABELS[log.action]}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(log.timestamp)}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                {log.actor}
                {log.consentId && <span className="ml-2 font-mono text-xs text-slate-400">{log.consentId}</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
