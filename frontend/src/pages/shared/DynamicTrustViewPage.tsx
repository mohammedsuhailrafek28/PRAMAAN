import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Info, RefreshCw, ShieldOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusPill } from "@/components/shared/StatusPill";
import { EvidenceStatusBadge, LifecycleBadge } from "@/components/shared/EvidenceStatusBadge";
import * as api from "@/services/api";
import { getApiError } from "@/services/api";
import { ErrorState, LoadingState } from "@/components/shared/AsyncState";
import { SharedFieldRow } from "@/components/shared/SharedFieldRow";
import { documentTypeLabel, sourceLabel } from "@/lib/fieldLabels";
import { NOT_EXTERNALLY_VERIFIED } from "@/lib/trustVocabulary";
import type { TrustViewResult } from "@/types";
import { formatDate, formatDateTime, parseDate, timeUntil } from "@/lib/utils";

export function DynamicTrustViewPage() {
  const { consentId } = useParams<{ consentId: string }>();
  const navigate = useNavigate();
  const [result, setResult] = useState<TrustViewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Each successful load is recorded by the backend as a Trust Profile view in
  // the MSME's audit log, so the page loads once on entry and on explicit refresh.
  // Concurrent calls (e.g. React StrictMode's dev double-mount) share one request,
  // so a single page open never records two views.
  const inFlight = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (!consentId) return Promise.resolve();
    if (inFlight.current) return inFlight.current;
    setRefreshing(true);
    inFlight.current = (async () => {
      try {
        setError(null);
        setResult(await api.getTrustView(consentId));
      } catch (e) {
        setResult(null);
        setError(getApiError(e));
      } finally {
        setRefreshing(false);
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, [consentId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Re-check once when the consent window closes so the page never keeps showing lapsed access.
  const expiresAt = result?.state === "active" ? result.expiresAt : undefined;
  useEffect(() => {
    const expiry = parseDate(expiresAt)?.getTime();
    if (!expiry) return;
    const delay = expiry - Date.now() + 1000;
    if (delay > 2 ** 31 - 1) return; // beyond setTimeout range; the next manual refresh will catch it
    const timer = setTimeout(() => void refresh(), Math.max(delay, 0));
    return () => clearTimeout(timer);
  }, [expiresAt, refresh]);

  if (error) return <ErrorState message={error} onRetry={() => void refresh()} />;
  if (!result) return <LoadingState label="Loading Trust View" />;

  if (result.state !== "active") {
    const message =
      result.state === "revoked"
        ? "The business revoked your access."
        : result.state === "expired"
        ? "The approved access period has ended."
        : "This consent request could not be found.";

    return (
      <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldOff className="h-6 w-6" aria-hidden />
        </div>
        <h2 className="text-lg font-semibold text-slate-900">Access no longer available</h2>
        <p className="text-sm text-muted-foreground">
          {message} Request fresh consent from the business if you still need this information.
        </p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
          Back to workspace
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <h2 className="break-words text-xl font-semibold text-slate-900">{result.businessName}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Purpose: {result.purpose || "Not stated"}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill label={`Access active · ${timeUntil(result.expiresAt)}`} tone="verified" />
          <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={refreshing} aria-label="Refresh Trust View">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="text-sm font-semibold text-slate-900">Approved information</p>
          {result.fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">No fields are available in the business's current Trust Profile for this consent.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {result.fields.map((field) => <SharedFieldRow key={field.key} field={field} />)}
            </div>
          )}
        </CardContent>
      </Card>

      {result.evidence.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <p className="text-sm font-semibold text-slate-900">Supporting evidence (metadata only)</p>
            {result.evidence.map((document) => (
              <div key={`${document.docType}-${document.uploadedAt}`} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{documentTypeLabel(document.docType)}</span>
                  <div className="flex flex-wrap gap-1.5">
                    <EvidenceStatusBadge status={document.evidenceStatus} />
                    {document.lifecycle && <LifecycleBadge state={document.lifecycle.state} />}
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Source: {sourceLabel(document.source)} · Uploaded {formatDate(document.uploadedAt)}
                  {document.checkedAt ? ` · Checked ${formatDate(document.checkedAt)}` : ""}
                  {document.expiresAt ? ` · Expires ${formatDate(document.expiresAt)}` : ""}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="bg-surface">
        <CardContent className="grid grid-cols-1 gap-3 p-4 text-xs text-muted-foreground sm:grid-cols-3">
          <div>
            <p className="font-medium text-slate-600">Consent ID</p>
            <p className="break-all font-mono">{result.consentId}</p>
          </div>
          <div>
            <p className="font-medium text-slate-600">Access granted</p>
            <p>{formatDateTime(result.grantedAt)}</p>
          </div>
          <div>
            <p className="font-medium text-slate-600">Expires</p>
            <p>{formatDateTime(result.expiresAt)}</p>
          </div>
        </CardContent>
      </Card>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          You can see only what the business approved; document files are never shared. {NOT_EXTERNALLY_VERIFIED} Each time you open or refresh this view it is recorded in the business's audit log.
        </span>
      </p>
    </div>
  );
}
