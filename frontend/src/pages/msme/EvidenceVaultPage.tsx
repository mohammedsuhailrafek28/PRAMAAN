import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ChevronDown, FileText, History, Landmark, Receipt, UploadCloud, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorState, LoadingState } from "@/components/shared/AsyncState";
import { FactList } from "@/components/shared/FactList";
import { EvidenceBadges, LifecycleBadge } from "@/components/shared/EvidenceStatusBadge";
import { ROUTES } from "@/components/layout/navigation";
import { useAppStore } from "@/store/appStore";
import { getApiError } from "@/services/api";
import { useToast } from "@/components/ui/use-toast";
import { evidenceHealth, evidenceSlots, isTrustProfileOutdated, type EvidenceSlot } from "@/lib/evidenceSlots";
import { sourceLabel } from "@/lib/fieldLabels";
import { NOT_EXTERNALLY_VERIFIED } from "@/lib/trustVocabulary";
import { cn, formatDate } from "@/lib/utils";
import type { DocumentType } from "@/types";

const SLOT_ICONS: Record<DocumentType, LucideIcon> = { gst_certificate: Receipt, udyam_certificate: FileText, bank_statement: Landmark };
const ACCEPT = "application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg";
const MAX_BYTES = 5 * 1024 * 1024;

function SlotCard({ slot, onUpload }: { slot: EvidenceSlot; onUpload: () => void }) {
  const [showHistory, setShowHistory] = useState(false);
  const Icon = SLOT_ICONS[slot.type];
  const doc = slot.current;
  const attention = slot.state !== "CURRENT";

  return (
    <Card className={cn("flex flex-col", !doc && "border-dashed border-slate-300 shadow-none")}>
      <div className="flex items-start gap-3 p-5 pb-4">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", !doc ? "bg-slate-100 text-slate-500" : attention ? "bg-warning-bg text-warning" : "bg-primary-50 text-primary-700")}>
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-slate-900">{slot.label}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{slot.purpose}</p>
        </div>
      </div>

      <div className="flex-1 space-y-4 px-5">
        {doc ? (
          <>
            <EvidenceBadges status={doc.evidenceStatus} lifecycle={doc.lifecycle?.state} />
            <FactList
              facts={[
                { label: "Issued", value: formatDate(doc.issuedAt) },
                { label: "Expires", value: doc.expiresAt ? formatDate(doc.expiresAt) : "No expiry recorded" },
                { label: "Uploaded", value: formatDate(doc.uploadedAt) },
                { label: "Last checked", value: doc.checkedAt ? formatDate(doc.checkedAt) : "Not yet" },
                { label: "Source", value: sourceLabel(doc.source) },
                { label: "Version", value: `${doc.revision ?? 1}${slot.history.length ? ` · ${slot.history.length} earlier` : ""}` },
              ]}
            />
            {doc.lifecycle?.state === "CONFLICT" && (
              <p className="flex gap-2 rounded-md bg-negative-bg px-3 py-2 text-xs text-negative-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Internal checks found a conflict with this document. <Link className="font-medium underline underline-offset-2" to={ROUTES.businessProfile}>Review</Link>
              </p>
            )}
            {doc.confidenceReason && <p className="text-xs leading-5 text-slate-500">{doc.confidenceReason}</p>}
          </>
        ) : (
          <div className="rounded-lg bg-slate-50 px-4 py-5 text-center">
            <LifecycleBadge state={null} />
            <p className="mt-2 text-sm text-slate-600">Not uploaded yet. Verifiers who ask for this evidence will see it as missing.</p>
          </div>
        )}
      </div>

      <div className="mt-4 space-y-3 border-t border-slate-100 p-5 pt-4">
        <Button className="w-full" variant={doc && !attention ? "outline" : "default"} onClick={onUpload}>
          <UploadCloud className="h-4 w-4" />
          {doc ? "Replace with a new version" : `Upload ${slot.label.toLowerCase()}`}
        </Button>
        {slot.history.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              aria-expanded={showHistory}
              className="flex min-h-9 w-full items-center justify-between rounded-md px-1 text-xs font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex items-center gap-1.5"><History className="h-3.5 w-3.5" aria-hidden />Version history ({slot.history.length})</span>
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showHistory && "rotate-180")} aria-hidden />
            </button>
            {showHistory && (
              <ol className="mt-2 space-y-2 border-l border-slate-200 pl-3">
                {slot.history.map((old) => (
                  <li key={old.id} className="text-xs text-slate-600">
                    <span className="font-medium text-slate-800">Version {old.revision ?? 1}</span> · uploaded {formatDate(old.uploadedAt)} · replaced
                    {old.expiresAt && <span className="block text-slate-500">Expired/expires {formatDate(old.expiresAt)}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function UploadDialog({ slot, onClose }: { slot: EvidenceSlot | null; onClose: () => void }) {
  const { uploadBusinessDocument, crossCheckBusiness } = useAppStore();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [source, setSource] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => { setFile(null); setIssuedAt(""); setExpiresAt(""); setSource(""); setProblem(null); }, [slot]);

  async function submit() {
    if (!slot) return;
    if (!file) { setProblem("Choose a PDF, PNG or JPEG file."); return; }
    if (file.size > MAX_BYTES) { setProblem("Files must be 5 MB or smaller."); return; }
    if (issuedAt && expiresAt && expiresAt < issuedAt) { setProblem("The expiry date can't be before the issue date."); return; }
    setSaving(true); setProblem(null);
    try {
      await uploadBusinessDocument(slot.type, file, { issuedAt, expiresAt, source });
      await crossCheckBusiness();
      toast({ title: `${slot.label} ${slot.current ? "replaced" : "uploaded"}`, description: "Pramaan re-ran its internal cross-check with the new version.", variant: "success" });
      onClose();
    } catch (e) {
      setProblem(getApiError(e));
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={!!slot} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{slot?.current ? `Replace ${slot.label.toLowerCase()}` : `Upload ${slot?.label.toLowerCase()}`}</DialogTitle>
          <DialogDescription>
            {slot?.current ? `This becomes version ${(slot.current.revision ?? 1) + 1}. The current version is kept in history.` : "Contents are stored but not read or parsed by Pramaan."} Dates and source are your declaration.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="ev-file">File (PDF, PNG or JPEG, up to 5 MB)</Label><Input id="ev-file" type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="ev-issued">Issue date</Label><Input id="ev-issued" type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="ev-expires">Expiry date <span className="font-normal text-slate-500">(if any)</span></Label><Input id="ev-expires" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="ev-source">Where it came from <span className="font-normal text-slate-500">(optional)</span></Label><Input id="ev-source" value={source} placeholder="e.g. GST portal download" onChange={(e) => setSource(e.target.value)} /></div>
          {problem && <p role="alert" className="rounded-md bg-negative-bg px-3 py-2 text-sm text-negative-foreground">{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving}><UploadCloud className="h-4 w-4" />{saving ? "Uploading and checking…" : slot?.current ? "Replace evidence" : "Upload evidence"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EvidenceVaultPage() {
  const { business, trustProfile, loadBusiness, error } = useAppStore();
  const [params, setParams] = useSearchParams();
  const [uploading, setUploading] = useState<EvidenceSlot | null>(null);

  useEffect(() => { loadBusiness(); }, [loadBusiness]);

  const slots = useMemo(() => evidenceSlots(business), [business]);
  const health = evidenceHealth(slots);

  // Deep link from the Action Center: /msme/evidence-vault?upload=bank_statement
  useEffect(() => {
    const requested = params.get("upload");
    if (!requested || !business) return;
    const slot = slots.find((item) => item.type === requested);
    if (slot) setUploading(slot);
    params.delete("upload");
    setParams(params, { replace: true });
  }, [params, setParams, slots, business]);

  if (!business && error) return <ErrorState message={error} onRetry={() => loadBusiness()} />;
  if (!business) return <LoadingState label="Loading your evidence" />;

  const outdated = trustProfile ? isTrustProfileOutdated(business, trustProfile) : false;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Trust"
        title="Evidence"
        description={<>The documents behind your claims. Verifiers never receive the files, only the check status and dates of evidence you explicitly share. {NOT_EXTERNALLY_VERIFIED}</>}
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-white px-4 py-3 text-sm shadow-card" aria-label="Evidence health">
        <span className="font-semibold text-slate-900">{health.current} of {health.total} current</span>
        {health.missing > 0 && <span className="text-negative-foreground">{health.missing} missing</span>}
        {health.stale > 0 && <span className="text-warning-foreground">{health.stale} stale</span>}
        {health.expiringSoon > 0 && <span className="text-warning-foreground">{health.expiringSoon} expiring soon</span>}
        {health.conflict > 0 && <span className="text-negative-foreground">{health.conflict} in conflict</span>}
        {outdated && trustProfile && (
          <span className="text-slate-600 sm:ml-auto">
            Trust Profile v{trustProfile.version} doesn't include recent changes. <Link to={ROUTES.trustProfile} className="font-medium text-primary-700 underline-offset-2 hover:underline">Generate a new version</Link>
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {slots.map((slot) => <SlotCard key={slot.type} slot={slot} onUpload={() => setUploading(slot)} />)}
      </div>

      <UploadDialog slot={uploading} onClose={() => setUploading(null)} />
    </div>
  );
}
