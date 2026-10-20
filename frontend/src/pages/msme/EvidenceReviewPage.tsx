import { useCallback, useEffect, useState } from "react";
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
import { confirmEvidenceCorrection, getApiError, getEvidenceReview } from "@/services/api";
import { NOT_EXTERNALLY_VERIFIED } from "@/lib/trustVocabulary";
import {
  CLAIM_LABEL, DOC_LABEL, EXTRACTION, FIELD_LABEL, RECONCILIATION, actionDetail, actionTitle, benchmarkSentence, issueLabel, sourceDocumentName,
  type CorrectAction, type EvidenceReview, type ReviewDocument, type ReviewReconciliation,
} from "@/lib/evidenceReview";
import { formatDateTime } from "@/lib/utils";

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
      {document.fields.length > 0 ? (
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {document.fields.map((field) => (
            <div key={field.field} className="min-w-0">
              <dt className="text-xs text-slate-500">{FIELD_LABEL[field.field] ?? field.field}</dt>
              <dd className="break-words text-sm text-slate-900">
                {field.status === "EXTRACTED" ? field.displayValue : <span className="text-slate-500">{field.status === "AMBIGUOUS" ? "Unclear — more than one value found" : field.status === "MALFORMED" ? "Unclear — not in the expected format" : "Not found"}</span>}
                {field.status === "EXTRACTED" && field.page !== null && <span className="ml-2 text-xs text-slate-500">page {field.page}, line {field.line}</span>}
              </dd>
              {field.note && <p className="text-xs text-warning">{field.note}</p>}
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-slate-600">{status.description}</p>
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
        </p>
      ))}
    </li>
  );
}

export function EvidenceReviewPage() {
  const { toast } = useToast();
  const [review, setReview] = useState<EvidenceReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<CorrectAction | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try { setReview(await getEvidenceReview()); setError(null); }
    catch (e) { setError(getApiError(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function applyCorrection(action: CorrectAction) {
    try {
      setReview(await confirmEvidenceCorrection({ claim: action.claim, sourceDocumentId: action.sourceDocumentId, source: action.source }));
      toast({ title: "Declaration updated", description: "Your declared value was changed and the review was re-run. Your existing Trust Profile versions and sharing consents are unchanged.", variant: "success" });
    } catch (e) {
      toast({ title: "Couldn't apply the correction", description: getApiError(e), variant: "destructive" });
      await load();
      throw e;
    }
  }

  if (error && !review) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!review) return <LoadingState label="Reading your documents" />;

  const { plan } = review;
  const nothingToDo = plan.actions.length === 0 && plan.unresolved.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Trust"
        title="Evidence review"
        description="Pramaan reads the text of your uploaded documents, compares it with what you declared, and works out the fewest things you need to do next."
        actions={<Button variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden />Re-run review</Button>}
      />

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
                  <p className="text-sm font-medium text-slate-900">{issueLabel(item.issueId)} <span className="font-normal text-slate-600">· {item.reason === "NOT_SUPPORTED_BY_DESIGN" ? "not supported yet" : item.reason === "DOCUMENTS_DISAGREE" ? "your documents disagree" : "needs human review"}</span></p>
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
