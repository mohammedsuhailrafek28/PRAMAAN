import { useCallback, useEffect, useState } from "react";
import { AlertOctagon, ClipboardCheck, Info, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState, LoadingState } from "@/components/shared/AsyncState";
import { StatusPill } from "@/components/shared/StatusPill";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { evaluateReadiness, getApiError, getLatestReadiness, getReadinessProfiles } from "@/services/api";
import type { StatusDescriptor } from "@/lib/trustVocabulary";
import { cn, formatDateTime } from "@/lib/utils";
import type { ReadinessEvaluation, ReadinessLevel, ReadinessProfileSummary, RequirementStatus } from "@/types";

const LEVEL: Record<ReadinessLevel, StatusDescriptor> = {
  NOT_READY: { label: "Not ready", tone: "negative", description: "Most requirements for this purpose are not met yet." },
  EARLY_STAGE: { label: "Early stage", tone: "warning", description: "Some requirements are met; several are missing." },
  PARTIALLY_READY: { label: "Partially ready", tone: "warning", description: "About half of the requirements are met." },
  MOSTLY_READY: { label: "Mostly ready", tone: "info", description: "Most requirements are met; a few remain." },
  READY_FOR_REVIEW: { label: "Ready for review", tone: "positive", description: "Requirements are met well enough to approach this process. It is not an approval." },
  BLOCKED: { label: "Blocked", tone: "negative", icon: "alert", description: "A blocking issue must be resolved first, whatever the score." },
};

const REQUIREMENT: Record<RequirementStatus, StatusDescriptor & { order: number }> = {
  BLOCKED: { label: "Blocked", tone: "negative", icon: "alert", description: "", order: 0 },
  MISSING: { label: "Missing", tone: "negative", icon: "dot", description: "", order: 1 },
  PARTIALLY_SATISFIED: { label: "Partly met", tone: "warning", description: "", order: 2 },
  MANUAL_REVIEW: { label: "Needs manual review", tone: "info", icon: "clock", description: "", order: 3 },
  SATISFIED: { label: "Met", tone: "positive", description: "", order: 4 },
  NOT_APPLICABLE: { label: "Not applicable", tone: "neutral", description: "", order: 5 },
};

const PRIORITY_TONE = { CRITICAL: "negative", HIGH: "warning", MEDIUM: "info", LOW: "neutral" } as const;

export function ReadinessPage() {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<ReadinessProfileSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<ReadinessEvaluation | null | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getReadinessProfiles()
      .then((list) => { setProfiles(list); setSelected(list[0]?.id ?? null); })
      .catch((e) => setError(getApiError(e)));
  }, []);

  const loadLatest = useCallback(async (profileId: string) => {
    setEvaluation(undefined);
    try { setEvaluation(await getLatestReadiness(profileId)); }
    catch (e) { setError(getApiError(e)); }
  }, []);

  useEffect(() => { if (selected) void loadLatest(selected); }, [selected, loadLatest]);

  async function run() {
    if (!selected) return;
    setRunning(true);
    try {
      setEvaluation(await evaluateReadiness(selected));
      toast({ title: "Readiness checked", description: "Pramaan re-ran its internal checks against this purpose's requirements.", variant: "success" });
    } catch (e) {
      toast({ title: "Readiness check failed", description: getApiError(e), variant: "destructive" });
    } finally { setRunning(false); }
  }

  if (error) return <ErrorState message={error} />;
  if (!profiles) return <LoadingState label="Loading readiness profiles" />;

  const profile = profiles.find((p) => p.id === selected);
  const level = evaluation ? LEVEL[evaluation.result.level] : undefined;
  const requirements = evaluation ? [...evaluation.requirements].sort((a, b) => REQUIREMENT[a.status].order - REQUIREMENT[b.status].order) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Prepare"
        title="Readiness"
        description="See how prepared your evidence is for a specific process, and what to fix first. This is a private preparation aid: it is never shared and is not an approval or eligibility decision."
      />

      <div role="radiogroup" aria-label="Readiness purpose" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {profiles.map((p) => (
          <button
            key={p.id}
            role="radio"
            aria-checked={p.id === selected}
            onClick={() => setSelected(p.id)}
            className={cn(
              "rounded-lg border bg-white p-3 text-left shadow-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              p.id === selected ? "border-primary-300 ring-1 ring-primary-300" : "border-border hover:border-slate-300"
            )}
          >
            <p className="text-sm font-semibold text-slate-900">{p.name}</p>
            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{p.description}</p>
          </button>
        ))}
      </div>

      {evaluation === undefined ? (
        <div className="space-y-3" role="status" aria-label="Loading evaluation"><Skeleton className="h-32" /><Skeleton className="h-48" /></div>
      ) : evaluation === null ? (
        <EmptyState
          icon={ClipboardCheck}
          title={`No readiness check yet for ${profile?.name ?? "this purpose"}`}
          description="Running a check re-runs Pramaan's internal cross-check and compares the result with this purpose's requirements. It is recorded in your Activity."
          action={<Button onClick={() => void run()} disabled={running}><RefreshCw className={running ? "h-4 w-4 animate-spin" : "h-4 w-4"} />{running ? "Checking…" : "Run readiness check"}</Button>}
        />
      ) : (
        <>
          <Card className="p-5 sm:p-6">
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">{evaluation.profile.name}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <p className="text-4xl font-semibold tracking-tight text-slate-900 tabular-nums">{evaluation.result.score}%</p>
                  {level && <StatusPill label={level.label} tone={level.tone} description={level.description} icon={level.icon} />}
                </div>
                <p className="mt-1 max-w-xl text-sm text-slate-600">{level?.description}</p>
              </div>
              <div className="flex flex-col items-start gap-2 md:items-end">
                <dl className="flex gap-4 text-center">
                  <div><dt className="text-[11px] text-slate-500">Met</dt><dd className="text-lg font-semibold tabular-nums text-slate-900">{evaluation.result.satisfiedRequirements}</dd></div>
                  <div><dt className="text-[11px] text-slate-500">Partly met</dt><dd className="text-lg font-semibold tabular-nums text-slate-900">{evaluation.result.partialRequirements}</dd></div>
                  <div><dt className="text-[11px] text-slate-500">Missing</dt><dd className="text-lg font-semibold tabular-nums text-slate-900">{evaluation.result.missingRequirements}</dd></div>
                  <div><dt className="text-[11px] text-slate-500">Of</dt><dd className="text-lg font-semibold tabular-nums text-slate-900">{evaluation.result.totalApplicableRequirements}</dd></div>
                </dl>
                <Button variant="outline" size="sm" onClick={() => void run()} disabled={running}><RefreshCw className={running ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />{running ? "Checking…" : "Check again"}</Button>
                <p className="text-xs text-slate-500">Checked {formatDateTime(evaluation.evaluatedAt)}</p>
              </div>
            </div>
            {evaluation.blockingIssues.length > 0 && (
              <div className="mt-5 rounded-lg border border-negative-border bg-negative-bg p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-negative-foreground"><AlertOctagon className="h-4 w-4" aria-hidden />Blocking issues</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-6 text-sm text-negative-foreground">{evaluation.blockingIssues.map((issue) => <li key={issue.code + issue.message}>{issue.message}</li>)}</ul>
              </div>
            )}
          </Card>

          {evaluation.nextActions.length > 0 && (
            <SectionCard title="What to do next" description="Ordered by impact on this purpose.">
              <ol className="space-y-2">
                {evaluation.nextActions.map((action, index) => (
                  <li key={action.requirementId + index} className="flex gap-3 rounded-lg border border-slate-200 p-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-slate-900">{action.title}</p><StatusPill label={action.priority.toLowerCase()} tone={PRIORITY_TONE[action.priority]} icon="dot" /></div>
                      <p className="mt-0.5 text-sm text-slate-600">{action.description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </SectionCard>
          )}

          <SectionCard title="Requirements" description="Every requirement for this purpose, with the reason from Pramaan's checks." contentClassName="p-0 sm:p-0">
            <ul className="divide-y divide-slate-100 border-t border-slate-200">
              {requirements.map((requirement) => {
                const status = REQUIREMENT[requirement.status];
                return (
                  <li key={requirement.requirementId} className="flex flex-col gap-1.5 px-5 py-3 sm:flex-row sm:items-start sm:gap-4">
                    <div className="sm:w-40 sm:shrink-0"><StatusPill label={status.label} tone={status.tone} icon={status.icon} /></div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{requirement.label}</p>
                      <p className="text-xs leading-5 text-slate-600">{requirement.reason}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </SectionCard>

          <div className="flex gap-2.5 rounded-lg border border-border bg-white p-4 text-sm text-slate-600">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <div className="space-y-1.5">
              <p>{evaluation.profile.disclaimer}</p>
              {[...new Set(evaluation.limitations)].filter((item) => item !== evaluation.profile.disclaimer).map((item) => <p key={item} className="text-xs text-slate-500">{item}</p>)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
