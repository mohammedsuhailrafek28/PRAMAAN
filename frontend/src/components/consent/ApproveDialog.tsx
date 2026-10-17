import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RequesterIdentityDetails } from "@/components/shared/RequesterIdentityBadge";
import { DisclosureSelector } from "@/components/shared/DisclosureSelector";
import { ROUTES } from "@/components/layout/navigation";
import { backendFieldLabel } from "@/lib/fieldLabels";
import { approvalGate, approvalNeedsAcknowledgement, organizationNames, type ApprovalGate } from "@/lib/requesterIdentity";
import { EMPTY_SCOPE, scopeLabelPhrase, scopeSize, type DisclosureScope } from "@/lib/disclosure";
import { formatDateTime } from "@/lib/utils";
import { CONSENT_DURATION_LABELS, type ConsentDurationHours, type ConsentRequest, type TrustProfile } from "@/types";

const DURATIONS: ConsentDurationHours[] = [24, 168, 720];

interface ApproveDialogProps {
  request: ConsentRequest | null;
  trustProfile: TrustProfile | null;
  onApprove: (scope: DisclosureScope, duration: ConsentDurationHours) => Promise<void>;
  onClose: () => void;
}

/**
 * Approval is deliberate: only requested items can be chosen, the count of
 * what is shared is always visible, and a plain-language preview states who
 * will see what, from which Trust Profile version, until when.
 */
export function ApproveDialog({ request, trustProfile, onApprove, onClose }: ApproveDialogProps) {
  const [selected, setSelected] = useState<DisclosureScope>(EMPTY_SCOPE);
  const [duration, setDuration] = useState<ConsentDurationHours>(168);
  const [submitting, setSubmitting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (request) { setSelected(request.requested); setDuration(168); setAcknowledged(false); }
  }, [request]);

  const identity = request?.requesterIdentity;
  const requesterLabel = identity && request ? organizationNames(identity, request.requesterName).primary : request?.requesterName;
  const gate: ApprovalGate = identity ? approvalGate({ identity, selectedCount: scopeSize(selected), acknowledged, submitting }) : { canApprove: false };
  const requestedCount = request ? scopeSize(request.requested) : 0;
  const selectedCount = scopeSize(selected);
  // Preview only: the backend sets the real expiry at approval time.
  const until = new Date(Date.now() + duration * 3600 * 1000).toISOString();

  async function approve() {
    setSubmitting(true);
    try { await onApprove(selected, duration); } finally { setSubmitting(false); }
  }

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Approve access for {requesterLabel}</DialogTitle>
          <DialogDescription>Purpose: {request?.purpose || "Not stated"}. You can share some or all of what was requested, never more.</DialogDescription>
        </DialogHeader>

        {request && identity && <RequesterIdentityDetails identity={identity} fallbackName={request.requesterName} />}
        {request && identity && approvalNeedsAcknowledgement(identity) && (
          <label htmlFor="ack-unverified" className="flex cursor-pointer items-start gap-2.5 rounded-md border border-warning-border px-3 py-2 text-sm text-slate-800">
            <Checkbox id="ack-unverified" className="mt-0.5" checked={acknowledged} onCheckedChange={(value) => setAcknowledged(value === true)} />
            <span>I understand this requester has not been independently checked, and I still choose what to share.</span>
          </label>
        )}

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <Label>What to share</Label>
            <span className={selectedCount < requestedCount ? "text-xs font-semibold text-info-foreground" : "text-xs font-medium text-slate-600"} aria-live="polite">
              Sharing {selectedCount} of {requestedCount} requested
            </span>
          </div>
          {request && <DisclosureSelector idPrefix="approve" value={selected} onChange={setSelected} options={request.requested} requested={request.requested} />}
          <p className="mt-2 text-xs text-slate-500">Only items {requesterLabel} asked for are listed. Anything they didn't request can't be added here.</p>
          {request && request.unsupportedRequested.length > 0 && (
            <p className="mt-1 text-xs text-warning-foreground">Not shareable through Pramaan and will not be approved: {request.unsupportedRequested.map(backendFieldLabel).join(", ")}</p>
          )}
        </div>

        <div>
          <Label className="mb-2 block">Access period</Label>
          <RadioGroup value={String(duration)} onValueChange={(v) => setDuration(Number(v) as ConsentDurationHours)} className="grid grid-cols-3 gap-2">
            {DURATIONS.map((d) => (
              <label key={d} htmlFor={`d-${d}`} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-[[data-state=checked]]:border-primary-300 has-[[data-state=checked]]:bg-primary-50">
                <RadioGroupItem value={String(d)} id={`d-${d}`} />
                {CONSENT_DURATION_LABELS[d]}
              </label>
            ))}
          </RadioGroup>
        </div>

        {trustProfile ? (
          <div className="rounded-lg border border-info-border bg-info-bg p-3 text-sm text-info-foreground">
            <p className="flex items-center gap-1.5 font-semibold"><Eye className="h-4 w-4" aria-hidden />What {requesterLabel} will see</p>
            <p className="mt-1">
              {selectedCount === 0 ? "Nothing selected yet." : <>{scopeLabelPhrase(selected, 4)}, from Trust Profile v{trustProfile.version}, until about {formatDateTime(until)}. Later changes to your profile are not shared under this consent.</>}
            </p>
          </div>
        ) : (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg p-3 text-sm text-warning-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Generate your Trust Profile before approving. Verifiers are shown a fixed version of it.
          </p>
        )}

        {gate.reason && <p id="approve-reason" role="status" className="text-xs text-slate-600">{gate.reason}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          {trustProfile ? (
            <Button onClick={() => void approve()} disabled={!gate.canApprove} aria-describedby={gate.reason ? "approve-reason" : undefined}>
              {submitting ? "Approving…" : `Approve ${selectedCount} item${selectedCount === 1 ? "" : "s"}`}
            </Button>
          ) : (
            <Button asChild><Link to={ROUTES.trustProfile}>Go to Trust Profile</Link></Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
