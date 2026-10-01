import { useEffect, useMemo, useState } from "react";
import { Archive, CheckCircle2, FileText, UploadCloud, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/shared/EmptyState";
import { useAppStore } from "@/store/appStore";
import { getApiError } from "@/services/api";
import { useToast } from "@/components/ui/use-toast";
import type { BusinessDocument, DocumentType, EvidenceLifecycleState } from "@/types";

const DOC_LABELS: Record<DocumentType, string> = {
  gst_certificate: "GST Certificate",
  udyam_certificate: "Udyam Certificate",
  bank_statement: "Bank Statement",
};

const STATE_COPY: Record<EvidenceLifecycleState, string> = {
  CURRENT: "Current",
  EXPIRING_SOON: "Expiring soon",
  EXPIRED: "Expired",
  CONFLICT: "Conflict detected",
  NEEDS_ATTENTION: "Needs attention",
};

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value)) : "Not provided";
}

export function EvidenceVaultPage() {
  const { business, loadBusiness, uploadBusinessDocument, crossCheckBusiness, error } = useAppStore();
  const { toast } = useToast();
  const [selectedType, setSelectedType] = useState<DocumentType>("gst_certificate");
  const [file, setFile] = useState<File | null>(null);
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [source, setSource] = useState("MSME submitted");
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadBusiness(); }, [loadBusiness]);

  const documents = useMemo(() => business?.documents ?? [], [business]);
  const current = documents.filter((document) => document.isCurrent !== false);
  const history = documents.filter((document) => document.isCurrent === false);

  async function submitEvidence() {
    if (!file) return;
    setSaving(true);
    try {
      await uploadBusinessDocument(selectedType, file, { issuedAt, expiresAt, source });
      await crossCheckBusiness();
      setFile(null); setIssuedAt(""); setExpiresAt("");
      toast({ title: "Evidence updated", description: `${DOC_LABELS[selectedType]} is now in the vault.` });
    } catch (e) {
      toast({ title: "Evidence update failed", description: getApiError(e), variant: "destructive" });
    } finally { setSaving(false); }
  }

  function status(document: BusinessDocument) {
    return document.lifecycle?.state || (document.isCurrent === false ? "NEEDS_ATTENTION" : "CURRENT");
  }

  if (!business) return <EmptyState icon={Archive} title="Evidence Vault unavailable" description={error || "Loading your evidence workspace."} />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Evidence Vault</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Keep the evidence behind your business profile current and ready for a verification workflow.</p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <h3 className="font-semibold text-slate-900">Add or replace evidence</h3>
            <p className="mt-1 text-sm text-muted-foreground">Dates and source are MSME-provided metadata. File contents are not parsed.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5"><Label>Evidence type</Label><select className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm" value={selectedType} onChange={(e) => setSelectedType(e.target.value as DocumentType)}>{Object.entries(DOC_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <div className="space-y-1.5"><Label>File</Label><Input type="file" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
            <div className="space-y-1.5"><Label>Issued date</Label><Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Expiry date</Label><Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Source</Label><Input value={source} onChange={(e) => setSource(e.target.value)} /></div>
          </div>
          <Button onClick={submitEvidence} disabled={!file || saving}><UploadCloud className="h-4 w-4" />{saving ? "Updating evidence..." : "Update evidence"}</Button>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold text-slate-900">Current evidence</h3><span className="text-sm text-muted-foreground">{current.filter((d) => status(d) === "CURRENT").length} current</span></div>
        {current.length === 0 ? <EmptyState icon={FileText} title="No evidence submitted" description="Add your first supporting document above." /> : current.map((document) => <EvidenceRow key={document.fileName + document.type + document.revision} document={document} state={status(document)} />)}
      </section>

      {history.length > 0 && <section className="space-y-3"><h3 className="font-semibold text-slate-900">Version history</h3>{history.map((document) => <EvidenceRow key={document.fileName + document.type + document.revision} document={document} state={status(document)} historical />)}</section>}
    </div>
  );
}

function EvidenceRow({ document, state, historical = false }: { document: BusinessDocument; state: EvidenceLifecycleState; historical?: boolean }) {
  const attention = state !== "CURRENT";
  return <Card><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between"><div className="flex min-w-0 gap-3"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${attention ? "bg-warning-bg text-warning-foreground" : "bg-verified-bg text-verified-foreground"}`}>{attention ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}</div><div className="min-w-0"><p className="font-semibold text-slate-900">{DOC_LABELS[document.type]}</p><p className="truncate text-sm text-muted-foreground">{document.fileName || "Evidence file"}</p><p className="mt-2 text-xs text-muted-foreground">{historical ? `Version ${document.revision || 1} · Replaced` : `Version ${document.revision || 1} · Current`} · {document.source || "MSME submitted"}</p></div></div><div className="grid gap-1 text-sm sm:min-w-64 sm:text-right"><p className={attention ? "font-medium text-warning-foreground" : "font-medium text-verified-foreground"}>{STATE_COPY[state]}</p><p className="text-xs text-muted-foreground">Uploaded {formatDate(document.uploadedAt)}</p><p className="text-xs text-muted-foreground">Issued {formatDate(document.issuedAt)} · Expires {formatDate(document.expiresAt)}</p>{document.lifecycle?.conflict && <p className="text-xs text-destructive">Deterministic conflict requires review</p>}</div></CardContent></Card>;
}
