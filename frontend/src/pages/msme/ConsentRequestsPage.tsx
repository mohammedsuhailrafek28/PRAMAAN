import { useEffect, useMemo, useState } from "react";
import { Inbox } from "lucide-react";

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
import { FieldSelector } from "@/components/shared/FieldSelector";
import { EmptyState } from "@/components/shared/EmptyState";
import { useAppStore } from "@/store/appStore";
import { useToast } from "@/components/ui/use-toast";
import { consentFieldBackendKey, getApiError } from "@/services/api";
import { IMPLIED_EVIDENCE_BY_BACKEND_FIELD, backendFieldLabel, documentTypeLabel } from "@/lib/fieldLabels";
import {
  CONSENT_DURATION_LABELS,
  type ConsentDurationHours,
  type ConsentField,
  type ConsentRequest,
} from "@/types";

const DURATIONS: ConsentDurationHours[] = [24, 168, 720];

export function ConsentRequestsPage() {
  const { consentRequests, loadConsentRequests, approveConsentRequest, rejectConsentRequest, revokeConsentRequest } =
    useAppStore();
  const { toast } = useToast();

  const [approving, setApproving] = useState<ConsentRequest | null>(null);
  const [selectedFields, setSelectedFields] = useState<ConsentField[]>([]);
  const [duration, setDuration] = useState<ConsentDurationHours>(168);

  useEffect(() => {
    loadConsentRequests();
  }, [loadConsentRequests]);

  const impliedEvidence = useMemo(
    () => [...new Set(selectedFields.map((field) => IMPLIED_EVIDENCE_BY_BACKEND_FIELD[consentFieldBackendKey(field)]).filter(Boolean))].map(documentTypeLabel),
    [selectedFields]
  );

  const pending = useMemo(() => consentRequests.filter((r) => r.status === "pending"), [consentRequests]);
  const active = useMemo(() => consentRequests.filter((r) => r.status === "active"), [consentRequests]);
  const history = useMemo(
    () => consentRequests.filter((r) => ["rejected", "revoked", "expired"].includes(r.status)),
    [consentRequests]
  );

  function openApprove(request: ConsentRequest) {
    setApproving(request);
    setSelectedFields(request.requestedFields);
    setDuration(168);
  }

  async function confirmApprove() {
    if (!approving) return;
    try {
      await approveConsentRequest(approving.id, selectedFields, duration);
      toast({ title: "Access granted", description: `${approving.requesterName} can now view the selected fields for ${CONSENT_DURATION_LABELS[duration]}.`, variant: "success" });
      setApproving(null);
    } catch (e) {
      toast({ title: "Approval failed", description: getApiError(e), variant: "destructive" });
    }
  }

  async function handleReject(request: ConsentRequest) {
    try {
      await rejectConsentRequest(request.id);
      toast({ title: "Request declined", description: `${request.requesterName}'s request was rejected.` });
    } catch (e) {
      toast({ title: "Rejection failed", description: getApiError(e), variant: "destructive" });
    }
  }

  async function handleRevoke(request: ConsentRequest) {
    try {
      await revokeConsentRequest(request.id);
      toast({ title: "Consent revoked", description: `${request.requesterName} no longer has access to your Trust Profile.`, variant: "warning" });
    } catch (e) {
      toast({ title: "Revocation failed", description: getApiError(e), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Consent Requests</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review who wants access to your Trust Profile, why, and decide exactly what they can see and for how long.
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
            <EmptyState icon={Inbox} title="No history yet" description="Rejected, revoked, and expired requests will appear here." />
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
              Choose exactly which fields to share and for how long. You can revoke access at any time.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md bg-surface px-3 py-2 text-xs text-slate-600">
            <span className="font-medium">Purpose:</span> {approving?.purpose || "Not stated"}
          </div>

          <div>
            <Label className="mb-2 block">Fields to share</Label>
            <p className="mb-2 text-xs text-muted-foreground">Only fields {approving?.requesterName} requested can be approved. Untick anything you don't want to share.</p>
            <FieldSelector
              selected={selectedFields}
              options={approving?.requestedFields}
              requestedFields={approving?.requestedFields}
              onChange={setSelectedFields}
            />
            {approving && approving.unsupportedRequestedFields.length > 0 && (
              <p className="mt-2 text-xs text-warning-foreground">
                Not shareable and will not be approved: {approving.unsupportedRequestedFields.map(backendFieldLabel).join(", ")}
              </p>
            )}
            {impliedEvidence.length > 0 && (
              <p className="mt-2 rounded-md border border-border px-3 py-2 text-xs text-slate-600">
                These fields also share details of your current {impliedEvidence.join(", ")} (type, file name, check status, dates, source). Document files are never shared.
              </p>
            )}
          </div>

          <div>
            <Label className="mb-2 block">Consent duration</Label>
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

          <DialogFooter>
            <Button variant="outline" onClick={() => setApproving(null)}>
              Cancel
            </Button>
            <Button onClick={confirmApprove} disabled={selectedFields.length === 0}>
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
