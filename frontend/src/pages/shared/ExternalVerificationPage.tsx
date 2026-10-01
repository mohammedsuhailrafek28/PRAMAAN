import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, Info, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/shared/StatusPill";
import { EvidenceStatusBadge, LifecycleBadge } from "@/components/shared/EvidenceStatusBadge";
import { SharedFieldRow } from "@/components/shared/SharedFieldRow";
import { LoadingState } from "@/components/shared/AsyncState";
import { getApiError, getGuestVerification } from "@/services/api";
import { documentTypeLabel, sourceLabel } from "@/lib/fieldLabels";
import { NOT_EXTERNALLY_VERIFIED } from "@/lib/trustVocabulary";
import type { GuestVerificationView } from "@/types";
import { formatDate, formatDateTime, timeUntil } from "@/lib/utils";

export function ExternalVerificationPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<GuestVerificationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (token) void getGuestVerification(token).then(setView).catch((e) => setError(getApiError(e))); }, [token]);

  if (error) {
    const reason = error.includes("expired") ? "This access link has expired." : error.includes("revoked") ? "The business revoked this access link." : "This access link is not valid.";
    return <div className="flex min-h-screen items-center justify-center bg-surface px-4"><Card className="max-w-md text-center"><CardContent className="space-y-3 p-8"><XCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden /><h1 className="text-xl font-semibold text-slate-900">Access link unavailable</h1><p className="text-sm text-muted-foreground">{reason} Ask the business for a new link if you still need this information.</p></CardContent></Card></div>;
  }
  if (!view) return <div className="min-h-screen bg-surface"><LoadingState label="Loading shared information" /></div>;

  return <main className="min-h-screen bg-surface px-4 py-10"><div className="mx-auto max-w-3xl space-y-5">
    <header className="flex flex-col items-start justify-between gap-3 sm:flex-row"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Shared via Pramaan secure link</p><h1 className="mt-2 break-words text-2xl font-semibold text-slate-900">{view.business.legalName || "Shared business information"}</h1><p className="mt-1 text-sm text-muted-foreground">Shared by the business for: {view.grant.purpose}</p></div><StatusPill label={`Link active · ${timeUntil(view.grant.expiresAt)}`} tone="verified" /></header>
    <Card><CardContent className="grid gap-4 p-5 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Recipient</p><p className="mt-1 text-sm font-medium">{view.grant.recipientOrganization || view.grant.recipientName || "Not specified"}</p></div><div><p className="text-xs text-muted-foreground">Shared</p><p className="mt-1 text-sm font-medium">{formatDateTime(view.grant.createdAt)}</p></div><div><p className="text-xs text-muted-foreground">Expires</p><p className="mt-1 text-sm font-medium">{formatDateTime(view.grant.expiresAt)}</p></div></CardContent></Card>
    {view.fields.length > 0 && <Card><CardHeader><CardTitle className="text-base">Shared business information</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">{view.fields.map((field) => <SharedFieldRow key={field.key} field={field} />)}</CardContent></Card>}
    {view.evidence.length > 0 && <Card><CardHeader><CardTitle className="text-base">Supporting evidence (metadata only)</CardTitle></CardHeader><CardContent className="space-y-3">{view.evidence.map((doc) => <div key={`${doc.docType}-${doc.uploadedAt}`} className="rounded-md border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{documentTypeLabel(doc.docType)}</span><div className="flex flex-wrap gap-1.5"><EvidenceStatusBadge status={doc.evidenceStatus} />{doc.lifecycle && <LifecycleBadge state={doc.lifecycle.state} />}</div></div><p className="mt-2 text-xs text-muted-foreground">Source: {sourceLabel(doc.source)} · Uploaded {formatDate(doc.uploadedAt)}{doc.checkedAt ? ` · Checked ${formatDate(doc.checkedAt)}` : ""}{doc.expiresAt ? ` · Expires ${formatDate(doc.expiresAt)}` : ""}</p>{doc.lifecycle?.conflict && <p className="mt-2 flex items-center gap-1 text-xs text-warning-foreground"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />Internal consistency checks found a conflict involving this evidence.</p>}</div>)}</CardContent></Card>}
    <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span>Only current information the business explicitly chose to share is shown; document files and earlier versions are never exposed. {NOT_EXTERNALLY_VERIFIED}</span></p>
  </div></main>;
}
