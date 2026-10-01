import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/shared/StatusPill";
import { getApiError, getGuestVerification } from "@/services/api";
import type { GuestVerificationView } from "@/types";
import { formatDateTime } from "@/lib/utils";

export function ExternalVerificationPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<GuestVerificationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (token) void getGuestVerification(token).then(setView).catch((e) => setError(getApiError(e))); }, [token]);
  if (error) return <div className="flex min-h-screen items-center justify-center bg-surface px-4"><Card className="max-w-md text-center"><CardContent className="space-y-3 p-8"><XCircle className="mx-auto h-10 w-10 text-destructive" /><h1 className="text-xl font-semibold text-slate-900">Access link unavailable</h1><p className="text-sm text-muted-foreground">{error.includes("expired") ? "This access link has expired." : error.includes("revoked") ? "This access was revoked by the business." : "This access link is not valid."}</p></CardContent></Card></div>;
  if (!view) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading verification...</div>;
  const displayValue = (value: unknown) => {
    if (value && typeof value === "object" && "value" in value) {
      const unwrapped = (value as { value?: unknown }).value;
      if (unwrapped && typeof unwrapped === "object" && "trustReadiness" in unwrapped) return `Trust readiness ${(unwrapped as { trustReadiness: number }).trustReadiness}%`;
      return unwrapped === null || unwrapped === undefined ? "Not available" : String(unwrapped);
    }
    if (value && typeof value === "object" && "trustReadiness" in value) return `Trust readiness ${(value as { trustReadiness: number }).trustReadiness}%`;
    return value === null || value === undefined ? "Not available" : String(value);
  };
  return <main className="min-h-screen bg-surface px-4 py-10"><div className="mx-auto max-w-3xl space-y-5"><header className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Pramaan secure verification</p><h1 className="mt-2 text-2xl font-semibold text-slate-900">{view.business.legalName || "Business Trust Profile"}</h1><p className="mt-1 text-sm text-muted-foreground">Information shared by the business for {view.grant.purpose.toLowerCase()}.</p></div><StatusPill label="Access granted" tone="verified" /></header><Card><CardContent className="grid gap-4 p-5 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Recipient</p><p className="mt-1 text-sm font-medium">{view.grant.recipientOrganization || view.grant.recipientName || "External verifier"}</p></div><div><p className="text-xs text-muted-foreground">Granted</p><p className="mt-1 text-sm font-medium">{formatDateTime(view.grant.createdAt)}</p></div><div><p className="text-xs text-muted-foreground">Expires</p><p className="mt-1 text-sm font-medium">{formatDateTime(view.grant.expiresAt)}</p></div></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Shared business information</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">{Object.entries(view.sharedFields).map(([key, value]) => <div key={key}><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{key.replace(/([A-Z])/g, " $1")}</p><p className="mt-1 break-words text-sm font-medium text-slate-800">{displayValue(value)}</p></div>)}</CardContent></Card>{view.evidence.length > 0 && <Card><CardHeader><CardTitle className="text-base">Current evidence shared</CardTitle></CardHeader><CardContent className="space-y-3">{view.evidence.map((doc) => <div key={`${doc.docType}-${doc.uploadedAt}`} className="rounded-md border p-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-verified-foreground" /><span className="text-sm font-medium">{doc.docType.replace(/_/g, " ")}</span></div><StatusPill label={doc.lifecycle.state.replace(/_/g, " ")} tone={doc.lifecycle.state === "CURRENT" ? "verified" : "warning"} /></div><p className="mt-2 text-xs text-muted-foreground">Source: {doc.source || "MSME submitted"} · Status: {doc.evidenceStatus}</p>{doc.lifecycle.conflict && <p className="mt-2 flex items-center gap-1 text-xs text-warning-foreground"><AlertTriangle className="h-3.5 w-3.5" />Deterministic consistency checks require attention.</p>}</div>)}</CardContent></Card>}<p className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5" />Only current, explicitly authorized information is shown. No raw files or historical versions are exposed.</p></div></main>;
}
