import { Clock } from "lucide-react";

import { auditGroupKey, renderAuditEvent, type AuditTone } from "@/lib/auditEvents";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn, formatDateTime, parseDate } from "@/lib/utils";
import type { AuditLogEntry } from "@/types";

const TONE_CLASSES: Record<AuditTone, string> = {
  primary: "bg-info-bg text-info",
  positive: "bg-positive-bg text-positive",
  warning: "bg-warning-bg text-warning",
  danger: "bg-negative-bg text-negative",
  neutral: "bg-slate-100 text-slate-600",
};

interface Group { entries: AuditLogEntry[] }

/** Collapse runs of identical consecutive events (e.g. repeated views, gap lists). */
function groupConsecutive(logs: AuditLogEntry[]): Group[] {
  const groups: Group[] = [];
  for (const log of logs) {
    const last = groups[groups.length - 1];
    if (last && auditGroupKey(last.entries[0]) === auditGroupKey(log)) last.entries.push(log);
    else groups.push({ entries: [log] });
  }
  return groups;
}

function dayLabel(iso: string): string {
  const date = parseDate(iso);
  if (!date) return "Unknown date";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(date); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - that.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return date.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

function timeOf(iso: string): string {
  const date = parseDate(iso);
  return date ? date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
}

function Row({ entries, compact }: { entries: AuditLogEntry[]; compact: boolean }) {
  const newest = entries[0];
  const event = renderAuditEvent(newest);
  const Icon = event.icon;
  const details = [...new Set(entries.map((entry) => renderAuditEvent(entry).detail).filter(Boolean))] as string[];
  const shown = details.slice(0, 3);
  return (
    <li className="relative flex gap-3.5">
      <div className={cn("relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white", TONE_CLASSES[event.tone])}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 pb-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-sm text-slate-900">
            {event.sentence}
            {entries.length > 1 && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{entries.length}×</span>}
          </p>
          <time dateTime={newest.timestamp} title={formatDateTime(newest.timestamp)} className="shrink-0 text-xs tabular-nums text-slate-500">
            {compact ? formatDateTime(newest.timestamp) : timeOf(newest.timestamp)}
          </time>
        </div>
        {shown.map((detail) => <p key={detail} className="mt-0.5 break-words text-xs text-slate-500">{detail}</p>)}
        {details.length > shown.length && <p className="mt-0.5 text-xs text-slate-500">+{details.length - shown.length} more</p>}
      </div>
    </li>
  );
}

interface AuditTimelineProps {
  logs: AuditLogEntry[];
  /** Maximum number of grouped rows to render (compact mode, no day headings). */
  limit?: number;
}

/** Reverse-chronological, plain-language record of evidence, checks and access decisions. */
export function AuditTimeline({ logs, limit }: AuditTimelineProps) {
  if (logs.length === 0) {
    return <EmptyState compact icon={Clock} title="No activity yet" description="Evidence uploads, cross-checks and every access request, approval, view and revocation will be recorded here." />;
  }

  const groups = groupConsecutive(logs);

  if (limit) {
    return (
      <ol className="relative space-y-4">
        <div className="absolute bottom-3 left-[15px] top-3 w-px bg-slate-200" aria-hidden />
        {groups.slice(0, limit).map(({ entries }) => <Row key={entries[0].id} entries={entries} compact />)}
      </ol>
    );
  }

  const days: { label: string; groups: Group[] }[] = [];
  for (const group of groups) {
    const label = dayLabel(group.entries[0].timestamp);
    const last = days[days.length - 1];
    if (last && last.label === label) last.groups.push(group);
    else days.push({ label, groups: [group] });
  }

  return (
    <div className="space-y-6">
      {days.map((day) => (
        <section key={day.label} aria-label={day.label}>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">{day.label}</h3>
          <ol className="relative space-y-4">
            <div className="absolute bottom-3 left-[15px] top-3 w-px bg-slate-200" aria-hidden />
            {day.groups.map(({ entries }) => <Row key={entries[0].id} entries={entries} compact={false} />)}
          </ol>
        </section>
      ))}
    </div>
  );
}
