import { Clock } from "lucide-react";

import { auditGroupKey, renderAuditEvent, type AuditTone } from "@/lib/auditEvents";
import { formatDateTime } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";
import type { AuditLogEntry } from "@/types";

const TONE_CLASSES: Record<AuditTone, string> = {
  primary: "bg-primary-50 text-primary-700",
  positive: "bg-verified-bg text-verified-foreground",
  warning: "bg-warning-bg text-warning-foreground",
  danger: "bg-destructive/10 text-destructive",
  neutral: "bg-secondary text-slate-600",
};

interface AuditGroup {
  entries: AuditLogEntry[];
}

/** Collapse runs of identical consecutive events (e.g. repeated views, gap lists). */
function groupConsecutive(logs: AuditLogEntry[]): AuditGroup[] {
  const groups: AuditGroup[] = [];
  for (const log of logs) {
    const last = groups[groups.length - 1];
    if (last && auditGroupKey(last.entries[0]) === auditGroupKey(log)) last.entries.push(log);
    else groups.push({ entries: [log] });
  }
  return groups;
}

interface AuditTimelineProps {
  logs: AuditLogEntry[];
  /** Maximum number of grouped rows to render. */
  limit?: number;
}

/** Reverse-chronological record of verification, evidence, and consent events. */
export function AuditTimeline({ logs, limit }: AuditTimelineProps) {
  if (logs.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title="No activity yet"
        description="Evidence uploads, cross-checks, and every access request, approval, view, and revocation will be recorded here."
      />
    );
  }

  const groups = groupConsecutive(logs);
  const visible = limit ? groups.slice(0, limit) : groups;

  return (
    <ol className="relative space-y-6 pl-2">
      <div className="absolute bottom-4 left-[19px] top-4 w-px bg-border" aria-hidden />
      {visible.map(({ entries }) => {
        const newest = entries[0];
        const oldest = entries[entries.length - 1];
        const event = renderAuditEvent(newest);
        const Icon = event.icon;
        const details = [...new Set(entries.map((entry) => renderAuditEvent(entry).description).filter(Boolean))] as string[];
        const shown = details.slice(0, 3);
        return (
          <li key={newest.id} className="relative flex gap-4">
            <div className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TONE_CLASSES[event.tone]}`}>
              <Icon className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 pb-1 pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-medium text-slate-900">
                  {event.label}
                  {entries.length > 1 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">× {entries.length}</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {entries.length > 1 ? `${formatDateTime(oldest.timestamp)} – ${formatDateTime(newest.timestamp)}` : formatDateTime(newest.timestamp)}
                </p>
              </div>
              {event.actor && <p className="text-sm text-muted-foreground">{event.actor}</p>}
              {shown.map((detail) => (
                <p key={detail} className="mt-0.5 break-words text-xs text-slate-500">{detail}</p>
              ))}
              {details.length > shown.length && <p className="mt-0.5 text-xs text-slate-400">+{details.length - shown.length} more</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
