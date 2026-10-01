import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ShieldCheck, ShieldOff, ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusPill } from "@/components/shared/StatusPill";
import * as api from "@/services/api";
import { getApiError } from "@/services/api";
import { ErrorState } from "@/components/shared/AsyncState";
import { CONSENT_FIELD_LABELS, type ConsentField, type TrustViewResult } from "@/types";
import { formatDateTime, timeUntil } from "@/lib/utils";

export function DynamicTrustViewPage() {
  const { consentId } = useParams<{ consentId: string }>();
  const navigate = useNavigate();
  const [result, setResult] = useState<TrustViewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!consentId) return;
    try {
      setError(null);
      setResult(await api.getTrustView(consentId));
    } catch (e) {
      setResult(null);
      setError(getApiError(e));
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consentId]);

  if (error) return <ErrorState message={error} onRetry={() => void refresh()} />;
  if (!result) return <div className="py-10 text-center text-sm text-muted-foreground">Loading Verification View...</div>;

  if (result.state !== "active") {
    const message =
      result.state === "revoked"
        ? "This business revoked access."
        : result.state === "expired"
        ? "This consent window has expired."
        : "This consent request could not be found.";

    return (
      <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldOff className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900">Access no longer available</h2>
        <p className="text-sm text-muted-foreground">
          {message} Request fresh consent from the business to view their Verification Profile again.
        </p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>
    );
  }

  const fieldEntries = Object.entries(result.fields) as [ConsentField, string][];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{result.businessName}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{result.purpose || "Shared with MSME consent"}</p>
        </div>
        <StatusPill label="Active" tone="verified" />
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          {fieldEntries.map(([field, value]) => (
            <div key={field}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {CONSENT_FIELD_LABELS[field]}
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-sm font-medium text-slate-800">{value}</span>
                <ShieldCheck className="h-3.5 w-3.5 text-verified-foreground" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {result.evidence && result.evidence.length > 0 && <Card>
        <CardContent className="space-y-3 p-5">
          <p className="text-sm font-semibold text-slate-900">Authorized current evidence</p>
          {result.evidence.map((document) => <div key={`${document.docType}-${document.uploadedAt}`} className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{document.docType.replace(/_/g, " ")}</span><StatusPill label={document.evidenceStatus === "CROSS_CHECKED" ? "Cross-checked by Pramaan" : document.evidenceStatus} tone={document.evidenceStatus === "CROSS_CHECKED" ? "verified" : "warning"} /></div>
            <p className="mt-1 text-xs text-muted-foreground">Source: {document.source || "MSME submitted"}{document.expiresAt ? ` · Expires ${formatDateTime(document.expiresAt)}` : ""}</p>
          </div>)}
        </CardContent>
      </Card>}

      <Card className="bg-surface">
        <CardContent className="grid grid-cols-1 gap-3 p-4 text-xs text-muted-foreground sm:grid-cols-3">
          <div>
            <p className="font-medium text-slate-600">Consent ID</p>
            <p className="font-mono">{result.consentId}</p>
          </div>
          <div>
            <p className="font-medium text-slate-600">Access Granted</p>
            <p>{formatDateTime(result.grantedAt)}</p>
          </div>
          <div>
            <p className="font-medium text-slate-600">Expires</p>
            <p>
              {formatDateTime(result.expiresAt)} · {timeUntil(result.expiresAt)}
            </p>
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Raw documents are never shared — only the verified fields this business approved.
      </p>
    </div>
  );
}
