import { useRef } from "react";
import { Info } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EvidenceStatusBadge } from "@/components/shared/EvidenceStatusBadge";
import { StatusPill } from "@/components/shared/StatusPill";
import { CATEGORY_PRESENTATION, type CheckLine, type ClaimExplanation, type EvidenceLine, type RecordedDate } from "@/lib/claimExplanation";
import type { StatusTone } from "@/lib/trustVocabulary";
import { formatDate, formatDateTime } from "@/lib/utils";

const CHECK_TONE: Record<CheckLine["tone"], StatusTone> = { pass: "positive", fail: "negative", warn: "warning", neutral: "neutral" };
const CHECK_ICON = { pass: "check", fail: "x", warn: "alert", neutral: "minus" } as const;

const UNAVAILABLE_TEXT = "Not captured in this historical version";

/** A recorded date, or an honest statement of why none can be shown. */
function dateText(value: RecordedDate, none: string, withTime = false): string {
  if (value.kind === "RECORDED") return withTime ? formatDateTime(value.iso) : formatDate(value.iso);
  return value.kind === "NONE_RECORDED" ? none : UNAVAILABLE_TEXT;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function EvidenceCard({ line }: { line: EvidenceLine }) {
  return (
    <li className="rounded-lg border border-slate-200 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{line.docTypeLabel}</p>
        {line.status && <EvidenceStatusBadge status={line.status} />}
      </div>
      {!line.found ? (
        <p className="mt-2 text-xs leading-5 text-slate-600">This evidence record is not present in this version's snapshot, so no details can be shown.</p>
      ) : (
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs min-[420px]:grid-cols-2">
          <div><dt className="text-slate-500">Revision</dt><dd className="text-slate-800">{line.revision !== null ? line.revision : line.basis === "LEGACY_SNAPSHOT" ? UNAVAILABLE_TEXT : "Not recorded"}</dd></div>
          <div><dt className="text-slate-500">Source</dt><dd className="[overflow-wrap:anywhere] text-slate-800">{line.source.kind === "RECORDED" ? line.source.text : line.source.kind === "NONE_RECORDED" ? "Not recorded" : UNAVAILABLE_TEXT}</dd></div>
          <div><dt className="text-slate-500">Issued</dt><dd className="text-slate-800">{dateText(line.issuedAt, "Not recorded")}</dd></div>
          <div><dt className="text-slate-500">Expires</dt><dd className="text-slate-800">{dateText(line.expiresAt, "No expiry date recorded")}{line.expiredWhenAssessed ? " (expired when assessed)" : ""}</dd></div>
          <div><dt className="text-slate-500">Uploaded</dt><dd className="text-slate-800">{dateText(line.uploadedAt, "Not recorded")}</dd></div>
          <div><dt className="text-slate-500">Assessed</dt><dd className="text-slate-800">{dateText(line.checkedAt, "Not recorded", true)}</dd></div>
        </dl>
      )}
      {line.checks.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-2.5">
          {line.checks.map((check, index) => (
            <li key={`${check.type}-${index}`} className="text-xs leading-5 text-slate-600"><span className="font-medium text-slate-800">{check.label}:</span> {check.outcomeLabel}{check.reason ? ` — ${check.reason}` : ""}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The explanation itself. Pure presentation of a ClaimExplanation; reads nothing else. */
export function TrustExplanationContent({ explanation }: { explanation: ClaimExplanation }) {
  const category = CATEGORY_PRESENTATION[explanation.category];
  return (
    <div className="space-y-5">
      <Section title="Claim assessment">
        <div className="rounded-lg bg-slate-50 p-3.5">
          <p className="text-xs text-slate-500">{explanation.label}</p>
          <p className="mt-1 [overflow-wrap:anywhere] text-[15px] font-medium text-slate-900">{explanation.valueText}</p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <StatusPill label={category.label} tone={category.tone} icon={category.icon} className="whitespace-normal" />
            <EvidenceStatusBadge status={explanation.recordedStatus} />
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-700">{explanation.summary}</p>
          {explanation.notes.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-600">
              {explanation.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500">Recorded in Trust Profile version {explanation.version}{explanation.assessedAt ? `, assessed ${formatDateTime(explanation.assessedAt)}` : ""}.</p>
        </div>
      </Section>

      <Section title="How Pramaan assessed it">
        {explanation.checks.length === 0 ? (
          <p className="text-sm text-slate-600">No individual checks were recorded for this claim in this version.</p>
        ) : (
          <ol className="space-y-2">
            {explanation.checks.map((check, index) => (
              <li key={`${check.type}-${index}`} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">{index + 1}. {check.label}</p>
                  <StatusPill label={check.outcomeLabel} tone={CHECK_TONE[check.tone]} icon={CHECK_ICON[check.tone]} />
                </div>
                {check.reason && <p className="mt-1.5 [overflow-wrap:anywhere] text-xs leading-5 text-slate-600">{check.reason}</p>}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Supporting evidence">
        {explanation.evidence.length === 0 ? (
          <p className="text-sm text-slate-600">No evidence document is linked to this claim in this version.</p>
        ) : (
          <ul className="space-y-2.5">{explanation.evidence.map((line) => <EvidenceCard key={line.documentId} line={line} />)}</ul>
        )}
      </Section>

      {(explanation.contradictions.length > 0 || explanation.gaps.length > 0) && (
        <Section title="Conflicts and gaps">
          <ul className="space-y-2.5">
            {explanation.contradictions.map((item, index) => (
              <li key={`c-${index}`} className="rounded-lg border border-negative-border bg-negative-bg p-3.5 text-sm text-negative-foreground">
                <p className="font-semibold">Conflict ({item.severity.toLowerCase()})</p>
                <p className="mt-1 [overflow-wrap:anywhere] leading-6">{item.reason}</p>
                {(item.claimedValue || item.evidenceValues.length > 0) && (
                  <div className="mt-2 text-xs">
                    <dl className="space-y-1">
                      <div><dt className="font-medium">Your submitted value</dt><dd className="break-all font-mono">{item.claimedValue ?? "Not recorded"}</dd></div>
                      <div><dt className="font-medium">Compared against</dt><dd className="break-all font-mono">{item.evidenceValues.length ? item.evidenceValues.join(", ") : "Not recorded"}</dd></div>
                    </dl>
                    <p className="pt-1.5 text-[11px] opacity-80">Shown only to you. Verifiers never see these values.</p>
                  </div>
                )}
              </li>
            ))}
            {explanation.gaps.map((item, index) => (
              <li key={`g-${index}`} className="rounded-lg border border-slate-200 p-3.5 text-sm text-slate-700">
                <p><span className="font-semibold text-slate-900">Gap</span> <span className="text-xs text-slate-500">({item.severity.toLowerCase()} priority)</span></p>
                <p className="mt-1 [overflow-wrap:anywhere] leading-6">{item.message}</p>
                {item.requiredEvidenceLabels.length > 0 && <p className="mt-1 text-xs text-slate-600">Evidence needed: {item.requiredEvidenceLabels.join(", ")}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="What this does not mean">
        <div className="flex gap-2.5 rounded-lg bg-slate-50 p-3.5 text-xs leading-5 text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <div className="space-y-1.5">
            <p className="font-medium text-slate-800">{explanation.sourceVerificationText}</p>
            <p>{explanation.limitation}</p>
          </div>
        </div>
      </Section>
    </div>
  );
}

interface TrustExplanationDialogProps {
  explanation: ClaimExplanation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Owner-only dialog; a bottom sheet on narrow screens. */
export function TrustExplanationDialog({ explanation, open, onOpenChange }: TrustExplanationDialogProps) {
  // The dialog is controlled and has no Radix trigger, so remember the "Why?" button ourselves and give focus back on close.
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={open && explanation !== null} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus(); opener.current = null; }}
        className="max-h-[90vh] max-w-xl overflow-x-hidden max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:w-full max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:p-4"
      >
        {explanation && (
          <>
            <DialogHeader>
              <DialogTitle>Why: {explanation.label}</DialogTitle>
              <DialogDescription>How this claim was assessed in Trust Profile version {explanation.version}.</DialogDescription>
            </DialogHeader>
            <TrustExplanationContent explanation={explanation} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
