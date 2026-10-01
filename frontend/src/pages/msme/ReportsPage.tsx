import { useCallback, useEffect, useState } from "react";
import { Download, Eye, FileText, Info, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState, LoadingState } from "@/components/shared/AsyncState";
import { StatusPill } from "@/components/shared/StatusPill";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/ui/use-toast";
import { generateReport, getApiError, getReportFile, getReports, getReportTypes, revokeReport } from "@/services/api";
import { formatDateTime } from "@/lib/utils";
import type { ReportSummary, ReportType } from "@/types";

const SELECT_CLASS = "flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function ReportsPage() {
  const { toast } = useToast();
  const [types, setTypes] = useState<ReportType[] | null>(null);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ReportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, r] = await Promise.all([getReportTypes(), getReports()]);
      setTypes(t); setReports(r); setChoice((current) => current || t[0]?.reportType || "");
    } catch (e) { setError(getApiError(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const typeName = (type: string) => types?.find((t) => t.reportType === type)?.displayName ?? type;
  const selectedType = types?.find((t) => t.reportType === choice);

  async function generate() {
    setBusy("generate");
    try {
      await generateReport(choice);
      await load();
      toast({ title: "Report generated", description: "A fixed snapshot was saved. Preview or download it below.", variant: "success" });
    } catch (e) { toast({ title: "Report generation failed", description: getApiError(e), variant: "destructive" }); }
    finally { setBusy(null); }
  }

  async function preview(report: ReportSummary) {
    // Open the tab synchronously so popup blockers allow it, then fill it.
    const tab = window.open("", "_blank");
    setBusy(`preview-${report.reportId}`);
    try {
      const blob = await getReportFile(report.reportId, "preview");
      const url = URL.createObjectURL(new Blob([blob], { type: "text/html" }));
      if (tab) tab.location.href = url; else window.location.assign(url);
    } catch (e) {
      tab?.close();
      toast({ title: "Preview unavailable", description: getApiError(e), variant: "destructive" });
    } finally { setBusy(null); }
  }

  async function download(report: ReportSummary) {
    setBusy(`pdf-${report.reportId}`);
    try {
      saveBlob(await getReportFile(report.reportId, "pdf"), `pramaan-${report.reportType.toLowerCase().replace(/_/g, "-")}-${report.reportId.slice(-6)}.pdf`);
    } catch (e) { toast({ title: "Download failed", description: getApiError(e), variant: "destructive" }); }
    finally { setBusy(null); }
  }

  if (error) return <ErrorState message={error} onRetry={() => { setError(null); void load(); }} />;
  if (!types) return <LoadingState label="Loading reports" />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Prepare"
        title="Reports"
        description="Generate a fixed, dated snapshot of your Trust Profile or readiness to keep for your records or attach to an application. Reports are private to you."
      />

      <SectionCard title="Generate a report">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="report-type">Report type</Label>
            <select id="report-type" className={SELECT_CLASS} value={choice} onChange={(e) => setChoice(e.target.value)}>
              {types.map((t) => <option key={t.reportType} value={t.reportType}>{t.displayName}</option>)}
            </select>
          </div>
          <Button onClick={() => void generate()} disabled={!choice || busy === "generate"}><Plus className="h-4 w-4" />{busy === "generate" ? "Generating…" : "Generate report"}</Button>
        </div>
        {selectedType && (
          <div className="mt-4 space-y-1.5 rounded-lg bg-slate-50 p-4 text-sm">
            <p className="text-slate-700">{selectedType.description}</p>
            <p className="flex gap-2 text-xs text-slate-500"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{selectedType.disclaimer}</p>
          </div>
        )}
      </SectionCard>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-slate-900">Your reports</h2>
        {reports.length === 0 ? (
          <EmptyState icon={FileText} title="No reports yet" description="Generated reports appear here. Each one is a fixed snapshot and does not change when your profile does." />
        ) : (
          reports.map((report) => (
            <Card key={report.reportId} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><FileText className="h-5 w-5" aria-hidden /></div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">{typeName(report.reportType)}</p>
                    {report.revokedAt ? <StatusPill label="Revoked" tone="negative" icon="ban" /> : <StatusPill label="Snapshot" tone="neutral" icon="dot" />}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Generated {formatDateTime(report.generatedAt)} · format v{report.reportVersion}
                    {report.headlineStatus ? ` · ${report.headlineStatus}` : ""}
                    {typeof report.score === "number" ? ` · ${report.score}%` : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void preview(report)} disabled={busy === `preview-${report.reportId}`}><Eye className="h-3.5 w-3.5" />Preview</Button>
                <Button variant="outline" size="sm" onClick={() => void download(report)} disabled={busy === `pdf-${report.reportId}`}><Download className="h-3.5 w-3.5" />{busy === `pdf-${report.reportId}` ? "Preparing PDF…" : "PDF"}</Button>
                {!report.revokedAt && <Button variant="ghost" size="sm" className="text-negative-foreground hover:bg-negative-bg" onClick={() => setRevoking(report)}>Revoke</Button>}
              </div>
            </Card>
          ))
        )}
      </section>

      <p className="flex gap-2 text-xs leading-5 text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Reports describe what Pramaan's internal checks found at a point in time. They are not certificates, government verification, credit assessments or approvals.
      </p>

      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(open) => !open && setRevoking(null)}
        destructive
        title="Revoke this report?"
        confirmLabel="Revoke report"
        description={<p>It stays in your history marked as revoked, so copies you already shared can be identified as withdrawn.</p>}
        onConfirm={async () => {
          if (!revoking) return;
          try { await revokeReport(revoking.reportId); await load(); toast({ title: "Report revoked", variant: "warning" }); }
          catch (e) { toast({ title: "Revocation failed", description: getApiError(e), variant: "destructive" }); throw e; }
        }}
      />
    </div>
  );
}
