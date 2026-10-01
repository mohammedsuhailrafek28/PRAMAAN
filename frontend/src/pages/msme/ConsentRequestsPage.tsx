import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Inbox, Layers } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ConsentRequestCard } from "@/components/shared/ConsentRequestCard";
import { DisclosureSelector } from "@/components/shared/DisclosureSelector";
import { EmptyState } from "@/components/shared/EmptyState";
import { useAppStore } from "@/store/appStore";
import { useToast } from "@/components/ui/use-toast";
import { getApiError } from "@/services/api";
import { backendFieldLabel } from "@/lib/fieldLabels";
import { EMPTY_SCOPE, scopeSize, type DisclosureScope } from "@/lib/disclosure";
import {
  CONSENT_DURATION_LABELS,
  type ConsentDurationHours,
  type ConsentRequest,
} from "@/types";

const DURATIONS: ConsentDurationHours[] = [24, 168, 720];

export function ConsentRequestsPage() {
  const navigate = useNavigate();
  const { consentRequests, trustProfile, loadBusiness, loadConsentRequests, approveConsentRequest, rejectConsentRequest, revokeConsentRequest } =
    useAppStore();
  const { toast } = useToast();

  const [approving, setApproving] = useState<ConsentRequest | null>(null);
  const [selected, setSelected] = useState<DisclosureScope>(EMPTY_SCOPE);
  const [duration, setDuration] = useState<ConsentDurationHours>(168);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadConsentRequests();
    // The approval pins the current Trust Profile version, so show which one.
    loadBusiness();
  }, [loadConsentRequests, loadBusiness]);

  const pending = useMemo(() => consentRequests.filter((r) => r.status === "pending"), [consentRequests]);
  const active = useMemo(() => consentRequests.filter((r) => r.status === "active"), [consentRequests]);
  const history = useMemo(
    () => consentRequests.filter((r) => ["rejected", "revoked", "expired"].includes(r.status)),
    [consentRequests]
  );

  function openApprove(request: ConsentRequest) {
    setApproving(request);
    setSelected(request.requested);
    setDuration(168);
  }

  async function confirmApprove() {
    if (!approving) return;
    setSubmitting(true);
    try {
      await approveConsentRequest(approving.id, selected, duration);
      toast({ title: "Access granted", description: `${approving.requesterName} can see ${scopeSize(selected)} item${scopeSize(selected) === 1 ? "" : "s"} for ${CONSENT_DURATION_LABELS[duration]}.`, variant: "success" });
      setApproving(null);
    } catch (e) {
      toast({ title: "Approval failed", description: getApiError(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject(request: ConsentRequest) {
    try {
      await rejectConsentRequest(request.id);
      toast({ title: "Request declined", description: `${request.requesterName}'s request was declined. Nothing was shared.` });
    } catch (e) {
      toast({ title: "Rejection failed", description: getApiError(e), variant: "destructive" });
    }
  }

  async function handleRevoke(request: ConsentRequest) {
    try {
      await revokeConsentRequest(request.id);
      toast({ title: "Consent revoked", description: `${request.requesterName} can no longer open your shared information.`, variant: "warning" });
    } catch (e) {
      toast({ title: "Revocation failed", description: getApiError(e), variant: "destructive" });
    }
  }

  const requestedCount = approving ? scopeSize(approving.requested) : 0;
  const selectedCount = scopeSize(selected);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Consent Requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review who wants access, why, and decide exactly what they can see and for how long.
        </p>
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
          <TabsTrigger value="history">History ({history.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-3">
          {pending.length === 0 ? (
            <EmptyState icon={Inbox} title="No pending requests" description="New verification requests from buyers or banks will appear here." />
          ) : (
            pending.map((r) => (
              <ConsentRequestCard key={r.id} request={r} onApprove={() => openApprove(r)} onReject={() => handleReject(r)} />
            ))
          )}
        </TabsContent>

        <TabsContent value="active" className="space-y-3">
          {active.length === 0 ? (
            <EmptyState icon={Inbox} title="No active consents" description="Approved requests with live access will appear here." />
          ) : (
            active.map((r) => <ConsentRequestCard key={r.id} request={r} onRevoke={() => handleRevoke(r)} />)
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-3">
          {history.length === 0 ? (
            <EmptyState icon={Inbox} title="No history yet" description="Declined, revoked, and expired requests will appear here." />
          ) : (
            history.map((r) => <ConsentRequestCard key={r.id} request={r} />)
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!approving} onOpenChange={(open) => !open && setApproving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve access for {approving?.requesterName}</DialogTitle>
            <DialogDescription>
              You can share some or all of what was requested, never more. You can revoke access at any time.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md bg-surface px-3 py-2 text-xs text-slate-600">
            <span className="font-medium">Purpose:</span> {approving?.purpose || "Not stated"}
          </div>

          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <Label>What to share</Label>
              <span className="text-xs font-medium text-slate-600" aria-live="polite">
                Sharing {selectedCount} of {requestedCount} requested
              </span>
            </div>
            {approving && (
              <DisclosureSelector
                idPrefix="approve"
                value={selected}
                onChange={setSelected}
                options={approving.requested}
                requested={approving.requested}
              />
            )}
            <p className="mt-2 text-xs text-muted-foreground">Only items {approving?.requesterName} asked for are listed. Anything they didn't request can't be added here.</p>
            {approving && approving.unsupportedRequested.length > 0 && (
              <p className="mt-1 text-xs text-warning-foreground">
                Not shareable through Pramaan and will not be approved: {approving.unsupportedRequested.map(backendFieldLabel).join(", ")}
              </p>
            )}
          </div>

          <div>
            <Label className="mb-2 block">Access period</Label>
            <RadioGroup
              value={String(duration)}
              onValueChange={(v) => setDuration(Number(v) as ConsentDurationHours)}
              className="grid grid-cols-3 gap-2"
            >
              {DURATIONS.map((d) => (
                <label
                  key={d}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-[[data-state=checked]]:border-primary-300 has-[[data-state=checked]]:bg-primary-50"
                >
                  <RadioGroupItem value={String(d)} id={`d-${d}`} />
                  {CONSENT_DURATION_LABELS[d]}
                </label>
              ))}
            </RadioGroup>
          </div>

          {trustProfile ? (
            <p className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-xs text-slate-600">
              <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Values and evidence will come from Trust Profile v{trustProfile.version}, fixed at approval. Later changes are not shared under this consent.
            </p>
          ) : (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Generate your Trust Profile before approving. Verifiers are shown a fixed version of it.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setApproving(null)}>
              Cancel
            </Button>
            {trustProfile ? (
              <Button onClick={confirmApprove} disabled={selectedCount === 0 || submitting}>
                {submitting ? "Approving…" : `Approve ${selectedCount} item${selectedCount === 1 ? "" : "s"}`}
              </Button>
            ) : (
              <Button onClick={() => navigate("/msme/trust-profile")}>Go to Trust Profile</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
