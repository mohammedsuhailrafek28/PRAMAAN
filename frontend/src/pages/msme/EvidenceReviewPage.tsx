import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, FileSearch, RefreshCw, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { ErrorState, LoadingState } from "@/components/shared/AsyncState";
import { StatusPill } from "@/components/shared/StatusPill";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ROUTES } from "@/components/layout/navigation";
import { useToast } from "@/components/ui/use-toast";
import { cancelEvidenceReviewJob, confirmEvidenceCorrection, getApiError, getApiErrorCode, getEvidenceReviewJob, startEvidenceReviewJob } from "@/services/api";
import { NOT_EXTERNALLY_VERIFIED } from "@/lib/trustVocabulary";
import {
  CLAIM_LABEL, DOC_LABEL, EXTRACTION, FIELD_LABEL, METHOD_LABEL, RECONCILIATION, reviewReasonText, actionDetail, actionTitle, benchmarkSentence, issueLabel, sourceDocumentName,
  isJobActive, jobErrorText, jobProgressPercent, jobProgressText,
  type CorrectAction, type EvidenceReview, type ReviewDocument, type ReviewJob, type ReviewReconciliation,
} from "@/lib/evidenceReview";
import { formatDateTime } from "@/lib/utils";

const POLL_MS = 1500;
const MAX_POLL_FAILURES = 4;
const pause = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });

/** Progress of a running review: what is being read now, how far along, and a way to stop. */
function JobProgress({ job, onCancel, cancelling }: { job: ReviewJob; onCancel: () => void; cancelling: boolean }) {
  const percent = jobProgressPercent(job);
  return (
    <div role="status" aria-live="polite" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-900">{jobProgressText(job)}</p>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={cancelling}>{cancelling ? "Cancelling…" : "Cancel"}</Button>
      </div>
      <div role="progressbar" aria-label="Documents read" aria-valuemin={0} aria-valuemax={job.docsTotal} aria-valuenow={Math.min(job.docsDone, job.docsTotal)} className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-primary-600 transition-all" style={{ width: `${job.status === "QUEUED" ? 4 : Math.max(percent, 6)}%` }} />
      </div>
      <p className="text-xs text-slate-500">Scanned pages can take a minute or more each. You can leave this page open or come back later; reading continues on the server and nothing leaves it.</p>
    </div>
  );
}

function DocumentCard({ document }: { document: ReviewDocument }) {
  const status = EXTRACTION[document.extractionStatus];
  return (
    <li className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">{DOC_LABEL[document.docType] ?? document.docType}</p>
          <p className="truncate text-xs text-slate-500">{document.originalName} · revision {document.revision}</p>
        </div>
        <StatusPill label={status.label} tone={status.tone} description={status.description} />
      </div>
      {(document.ocrPages > 0 || document.engine === "LEGACY") && (
        <p className="mt-2 text-xs text-slate-500">
          {document.engine === "LEGACY"
            ? "Read with the basic text reader because scan reading was unavailable; scanned pages cannot be read in this mode."
            : `${document.ocrPages} of ${document.pageCount} page${document.pageCount === 1 ? "" : "s"} read from a scan on this server (nothing leaves it). Scans can be misread, so check the values marked below.`}
        </p>
      )}
      {document.fields.length > 0 ? (
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {document.fields.map((field) => (
            <div key={field.field} className="min-w-0">
              <dt className="text-xs text-slate-500">{FIELD_LABEL[field.field] ?? field.field}</dt>
              <dd className="break-words text-sm text-slate-900">
                {field.status === "EXTRACTED" ? field.displayValue : <span className="text-slate-500">{field.status === "AMBIGUOUS" ? "Unclear — more than one value found" : field.status === "MALFORMED" ? "Unclear — not in the expected format" : "Not found"}</span>}
                {field.status === "EXTRACTED" && field.page !== null && <span className="ml-2 text-xs text-slate-500">page {field.page}{field.line !== null ? `, line ${field.line}` : ""}</span>}
              </dd>
              {field.status === "EXTRACTED" && field.method !== "LEGACY_PDF_PARSER" && <p className="text-xs text-slate-500">{METHOD_LABEL[field.method]}</p>}
              {field.needsReview && (
                <p className="text-xs text-warning" role="note"><strong className="font-medium">Check this value.</strong> {field.reviewReasons.map(reviewReasonText).filter((line, index, all) => all.indexOf(line) === index).join(" ")}</p>
              )}
              {field.note && <p className="text-xs text-warning">{field.note}</p>}
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-slate-600">{status.description}</p>
      )}
      {document.table && document.table.rowCount > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-700">
            Transactions: {document.table.rowCount} row{document.table.rowCount === 1 ? "" : "s"} read, {document.table.balanceConsistent} of {document.table.balanceChecked} agree with the running balance.
            {!document.table.reliable && " The table could not be confirmed reliably, so it is not relied on."}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-xs text-slate-700">
              <caption className="sr-only">First transactions read from the statement</caption>
              <thead><tr className="text-slate-500"><th scope="col" className="py-1 pr-3 font-medium">Date</th><th scope="col" className="py-1 pr-3 font-medium">Description</th><th scope="col" className="py-1 pr-3 text-right font-medium">Debit</th><th scope="col" className="py-1 pr-3 text-right font-medium">Credit</th><th scope="col" className="py-1 text-right font-medium">Balance</th></tr></thead>
              <tbody>
                {document.table.preview.map((row, index) => (
                  <tr key={index} className="border-t border-slate-100">
                    <td className="py-1 pr-3">{row.date ?? "—"}</td><td className="max-w-[16rem] truncate py-1 pr-3">{row.description}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{row.debit ?? ""}</td><td className="py-1 pr-3 text-right tabular-nums">{row.credit ?? ""}</td><td className="py-1 text-right tabular-nums">{row.balance ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </li>
  );
}

function ReconciliationRow({ item }: { item: ReviewReconciliation }) {
  const status = RECONCILIATION[item.status];
  return (
    <li className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-900">{CLAIM_LABEL[item.claim]}</p>
        <StatusPill label={status.label} tone={status.tone} description={status.description} />
      </div>
      <p className="mt-1 text-sm text-slate-600">{item.summary}</p>
      {item.declaredDisplay && <p className="mt-2 text-sm"><span className="text-slate-500">You declared: </span><span className="break-words text-slate-900">{item.declaredDisplay}</span></p>}
      {item.comparisons.filter((c) => c.extractedDisplay).map((comparison) => (
        <p key={`${comparison.documentId}-${comparison.sourceField}`} className="text-sm">
          <span className="text-slate-500">{DOC_LABEL[comparison.docType] ?? comparison.docType} says: </span>
          <span className="break-words text-slate-900">{comparison.extractedDisplay}</span>
          {comparison.outcome === "NEAR_MATCH" && <span className="ml-2 text-xs text-warning">close, but not the same</span>}
          {comparison.outcome === "UNCERTAIN" && <span className="ml-2 text-xs text-warning">read with low certainty — please check the document</span>}
        </p>
      ))}
    </li>
  );
}

export function EvidenceReviewPage() {
  const { toast } = useToast();
  const [review, setReview] = useState<EvidenceReview | null>(null);
  const [job, setJob] = useState<ReviewJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pending, setPending] = useState<CorrectAction | null>(null);
  const runToken = useRef(0);

  /** Starts (or joins) a review job and follows it until it finishes. Superseded by any later run, cancel, or unmount. */
  const run = useCallback(async () => {
    const token = ++runToken.current;
    const current = () => token === runToken.current;
    setBusy(true);
    setError(null);
    try {
      for (let rereads = 0; ; rereads += 1) {
        const started = await startEvidenceReviewJob();
        if (!current()) return;
        setJob(started.job);
        let polled = await getEvidenceReviewJob(started.job.id);
        let failures = 0;
        for (;;) {
          if (!current()) return;
          setJob(polled.job);
          if (!isJobActive(polled.job)) break;
          await pause(POLL_MS);
          if (!current()) return;
          try {
            polled = await getEvidenceReviewJob(started.job.id);
            failures = 0;
          } catch (e) {
            failures += 1;
            if (failures >= MAX_POLL_FAILURES) throw e;
          }
        }
        if (polled.job.status === "SUCCEEDED" && polled.resultState === "READY" && polled.review) { setReview(polled.review); return; }
        // The documents changed after reading, or the server no longer holds the results: read again (a couple of times at most).
        if (polled.job.status === "SUCCEEDED" && rereads < 2) continue;
        setError(polled.job.status === "SUCCEEDED" ? "Your documents changed while they were being read. Please run the review again." : jobErrorText(polled.job.errorCode));
        return;
      }
    } catch (e) {
      if (current()) setError(getApiError(e));
    } finally {
      if (current()) setBusy(false);
    }
  }, []);
  useEffect(() => { void run(); return () => { runToken.current += 1; }; }, [run]);

  async function cancel() {
    if (!job) return;
    setCancelling(true);
    runToken.current += 1; // stop following; the job is being cancelled
    try { setJob((await cancelEvidenceReviewJob(job.id)).job); setError(jobErrorText("CANCELLED_BY_OWNER")); }
    catch (e) { setError(getApiError(e)); }
    finally { setBusy(false); setCancelling(false); }
  }

  async function applyCorrection(action: CorrectAction) {
    try {
      setReview(await confirmEvidenceCorrection({ claim: action.claim, sourceDocumentId: action.sourceDocumentId, source: action.source }));
      toast({ title: "Declaration updated", description: "Your declared value was changed and the review was re-run. Your existing Trust Profile versions and sharing consents are unchanged.", variant: "success" });
    } catch (e) {
      const expired = getApiErrorCode(e) === "REVIEW_EXPIRED";
      toast({ title: "Couldn't apply the correction", description: expired ? "The review results expired, so Pramaan is reading your documents again. Confirm the correction once it finishes." : getApiError(e), variant: "destructive" });
      void run();
      throw e;
    }
  }

  if (!review && error) return <ErrorState message={error} onRetry={() => void run()} />;
  if (!review) {
    return job ? (
      <div className="space-y-6">
        <PageHeader eyebrow="Trust" title="Evidence review" description="Pramaan is reading your uploaded documents. This page updates by itself." />
        <JobProgress job={job} onCancel={() => void cancel()} cancelling={cancelling} />
      </div>
    ) : <LoadingState label="Starting your review" />;
  }

  const { plan } = review;
  const nothingToDo = plan.actions.length === 0 && plan.unresolved.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Trust"
        title="Evidence review"
        description="Pramaan reads the text of your uploaded documents, compares it with what you declared, and works out the fewest things you need to do next."
        actions={<Button variant="outline" onClick={() => void run()} disabled={busy}><RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden />Re-run review</Button>}
      />

      {busy && job && isJobActive(job) && <JobProgress job={job} onCancel={() => void cancel()} cancelling={cancelling} />}
      {error && <div role="alert" className="rounded-lg border border-warning-border bg-warning-bg p-3 text-sm text-slate-800">{error} The results below are from your last completed review.</div>}

      <div role="note" className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
        <div className="space-y-1">
          <p>{NOT_EXTERNALLY_VERIFIED}</p>
          <p>Reading a document is not authenticating it. Values on this page are visible only to you; nothing is shared with a requester unless you approve it separately. Last run {formatDateTime(review.generatedAt)}.</p>
        </div>
      </div>

      <SectionCard title="What to do next" description="The smallest set of actions found by checking every combination against Pramaan's trust rules.">
        {nothingToDo && <p className="text-sm text-slate-600">Nothing is outstanding.</p>}
        {plan.actions.length > 0 && (
          <ol className="space-y-3">
            {plan.actions.map((action) => (
              <li key={action.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{actionTitle(action)}</p>
                    <p className="mt-1 text-sm text-slate-600">{actionDetail(action)}</p>
                    {action.type === "CORRECT_CLAIM" && sourceDocumentName(review, action.sourceDocumentId) && <p className="mt-1 text-xs text-slate-500">Proposed from {sourceDocumentName(review, action.sourceDocumentId)}.</p>}
                    <p className="mt-2 text-xs text-slate-500">Would address: {action.resolves.map(issueLabel).join(", ")}</p>
                  </div>
                  {action.type === "CORRECT_CLAIM"
                    ? <Button onClick={() => setPending(action)}>Review and confirm</Button>
                    : <Button asChild variant="outline"><Link to={ROUTES.evidence}>Go to Evidence</Link></Button>}
                </div>
                {action.type === "SUBMIT_DOCUMENT" && <p className="mt-2 text-xs text-slate-500">Conditional: Pramaan cannot know what the new document says until it is uploaded and read.</p>}
              </li>
            ))}
          </ol>
        )}
        <p className="mt-4 text-sm text-slate-600">{benchmarkSentence(plan.benchmark)}</p>
      </SectionCard>

      {plan.unresolved.length > 0 && (
        <SectionCard title="Still unresolved" description="These are shown honestly rather than counted as fixed.">
          <ul className="space-y-3">
            {plan.unresolved.map((item) => (
              <li key={item.issueId} className="flex gap-3 rounded-lg border border-warning-border bg-warning-bg p-4">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                <div>
                  <p className="text-sm font-medium text-slate-900">{issueLabel(item.issueId)} <span className="font-normal text-slate-600">· {item.reason === "NOT_SUPPORTED_BY_DESIGN" ? "not supported yet" : item.reason === "READING_UNCERTAIN" ? "please check the document" : item.reason === "DOCUMENTS_DISAGREE" ? "your documents disagree" : "needs human review"}</span></p>
                  <p className="mt-1 text-sm text-slate-700">{item.message}</p>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <SectionCard title="Declared vs. documents" description="Each claim you declared, compared with what your documents say.">
        <ul className="grid gap-3 lg:grid-cols-2">{review.reconciliations.map((item) => <ReconciliationRow key={item.claim} item={item} />)}</ul>
      </SectionCard>

      <SectionCard title="What was read from each document" description="Text read from the file, with where it was found. Sensitive numbers are masked.">
        {review.documents.length === 0
          ? <div className="flex items-center gap-3 text-sm text-slate-600"><FileSearch className="h-4 w-4" aria-hidden />No documents uploaded yet. <Link className="text-primary-700 underline" to={ROUTES.evidence}>Upload evidence</Link></div>
          : <ul className="space-y-3">{review.documents.map((document) => <DocumentCard key={document.documentId} document={document} />)}</ul>}
      </SectionCard>

      <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">{review.limitations.map((line) => <li key={line}>{line}</li>)}</ul>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => { if (!open) setPending(null); }}
        title={pending ? `Change your ${CLAIM_LABEL[pending.claim]}?` : "Confirm"}
        confirmLabel="Yes, change my declaration"
        description={pending ? (
          <>
            <p>{actionDetail(pending)}</p>
            <p>Your existing Trust Profile versions and any sharing you approved stay exactly as they are. Run the cross-check afterwards to include this change in a new version.</p>
          </>
        ) : null}
        onConfirm={async () => { if (pending) await applyCorrection(pending); }}
      />
    </div>
  );
}
