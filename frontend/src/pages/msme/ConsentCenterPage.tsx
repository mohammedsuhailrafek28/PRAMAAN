import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { History, Inbox, KeyRound, Link2 } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ApproveDialog } from "@/components/consent/ApproveDialog";
import { ConsentAccessCard, PendingRequestCard, SecureLinkCard } from "@/components/consent/ConsentCards";
import { SecureLinkForm } from "@/components/consent/SecureLinkForm";
import { useAppStore } from "@/store/appStore";
import { useToast } from "@/components/ui/use-toast";
import { getApiError, revokeAccessGrant } from "@/services/api";
import { scopeSize, type DisclosureScope } from "@/lib/disclosure";
import { CONSENT_DURATION_LABELS, type AccessGrant, type ConsentDurationHours, type ConsentRequest } from "@/types";

type Tab = "requests" | "active" | "links" | "history";
const TABS: Tab[] = ["requests", "active", "links", "history"];

type Pending =
  | { kind: "decline"; request: ConsentRequest }
  | { kind: "revoke"; request: ConsentRequest }
  | { kind: "revokeLink"; grant: AccessGrant }
  | null;

/** One place for every decision about who can see the business's information. */
export function ConsentCenterPage() {
  const { business, trustProfile, consentRequests, accessGrants, loadBusiness, loadConsentRequests, loadAccessGrants, loadAuditLogs, approveConsentRequest, rejectConsentRequest, revokeConsentRequest } = useAppStore();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as Tab) ? params.get("tab") : "requests") as Tab;
  const [approving, setApproving] = useState<ConsentRequest | null>(null);
  const [confirming, setConfirming] = useState<Pending>(null);

  useEffect(() => {
    loadConsentRequests();
    loadAccessGrants();
    loadBusiness(); // approval pins the current Trust Profile version
  }, [loadConsentRequests, loadAccessGrants, loadBusiness]);

  const pending = useMemo(() => consentRequests.filter((r) => r.status === "pending"), [consentRequests]);
  const activeConsents = useMemo(() => consentRequests.filter((r) => r.status === "active"), [consentRequests]);
  const closedConsents = useMemo(() => consentRequests.filter((r) => ["rejected", "revoked", "expired"].includes(r.status)), [consentRequests]);
  const activeLinks = useMemo(() => accessGrants.filter((g) => g.status === "ACTIVE"), [accessGrants]);
  const closedLinks = useMemo(() => accessGrants.filter((g) => g.status !== "ACTIVE"), [accessGrants]);

  function setTab(next: string) {
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
  }

  async function approve(scope: DisclosureScope, duration: ConsentDurationHours) {
    if (!approving) return;
    try {
      await approveConsentRequest(approving.id, scope, duration);
      toast({ title: "Access approved", description: `${approving.requesterName} can see ${scopeSize(scope)} item${scopeSize(scope) === 1 ? "" : "s"} for ${CONSENT_DURATION_LABELS[duration].toLowerCase()}.`, variant: "success" });
      setApproving(null);
      setTab("active");
    } catch (e) {
      toast({ title: "Approval failed", description: getApiError(e), variant: "destructive" });
    }
  }

  async function runConfirmed() {
    if (!confirming) return;
    try {
      if (confirming.kind === "decline") {
        await rejectConsentRequest(confirming.request.id);
        toast({ title: "Request declined", description: `Nothing was shared with ${confirming.request.requesterName}.` });
      } else if (confirming.kind === "revoke") {
        await revokeConsentRequest(confirming.request.id);
        toast({ title: "Access revoked", description: `${confirming.request.requesterName} can no longer open your shared information.`, variant: "warning" });
      } else {
        await revokeAccessGrant(confirming.grant.id);
        await Promise.all([loadAccessGrants(), loadAuditLogs()]);
        toast({ title: "Secure link revoked", description: "Anyone opening the link will now see that access was revoked.", variant: "warning" });
      }
    } catch (e) {
      toast({ title: "That didn't work", description: getApiError(e), variant: "destructive" });
      throw e;
    }
  }

  const count = (n: number) => (n ? <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 text-[11px] font-semibold text-slate-700 group-data-[state=active]:bg-primary-100 group-data-[state=active]:text-primary-800">{n}</span> : null);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sharing"
        title="Consent & Access"
        description="Decide exactly who can see what, why, and for how long. Every request, approval, view and revocation is recorded in Activity."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 sm:w-auto">
          <TabsTrigger value="requests" className="group min-h-9">Requests{count(pending.length)}</TabsTrigger>
          <TabsTrigger value="active" className="group min-h-9">Active access{count(activeConsents.length + activeLinks.length)}</TabsTrigger>
          <TabsTrigger value="links" className="group min-h-9">Secure links</TabsTrigger>
          <TabsTrigger value="history" className="group min-h-9">History</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="mt-5 space-y-4">
          {pending.length === 0 ? (
            <EmptyState icon={Inbox} title="No requests waiting" description="When a buyer or bank asks for your information, the request appears here. Nothing is shared until you approve." />
          ) : (
            pending.map((request) => (
              <PendingRequestCard key={request.id} request={request} onReview={() => setApproving(request)} onDecline={() => setConfirming({ kind: "decline", request })} />
            ))
          )}
        </TabsContent>

        <TabsContent value="active" className="mt-5 space-y-4">
          {activeConsents.length + activeLinks.length === 0 ? (
            <EmptyState icon={KeyRound} title="No one has access right now" description="Approved requests and active secure links appear here, with what they can see and until when." />
          ) : (
            <>
              {activeConsents.map((request) => <ConsentAccessCard key={request.id} request={request} onRevoke={() => setConfirming({ kind: "revoke", request })} />)}
              {activeLinks.map((grant) => <SecureLinkCard key={grant.id} grant={grant} onRevoke={() => setConfirming({ kind: "revokeLink", grant })} />)}
            </>
          )}
        </TabsContent>

        <TabsContent value="links" className="mt-5 space-y-4">
          <SecureLinkForm business={business} trustProfile={trustProfile} onCreated={() => { void loadAccessGrants(); void loadAuditLogs(); }} />
          <h2 className="pt-2 text-[15px] font-semibold text-slate-900">Your secure links</h2>
          {accessGrants.length === 0 ? (
            <EmptyState compact icon={Link2} title="No secure links yet" description="Links you create appear here with their status and when they were last opened." />
          ) : (
            accessGrants.map((grant) => <SecureLinkCard key={grant.id} grant={grant} onRevoke={() => setConfirming({ kind: "revokeLink", grant })} />)
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-5 space-y-4">
          {closedConsents.length + closedLinks.length === 0 ? (
            <EmptyState icon={History} title="No closed access yet" description="Declined, revoked and expired requests and links are kept here." />
          ) : (
            <>
              {closedConsents.map((request) => <ConsentAccessCard key={request.id} request={request} />)}
              {closedLinks.map((grant) => <SecureLinkCard key={grant.id} grant={grant} />)}
            </>
          )}
        </TabsContent>
      </Tabs>

      <ApproveDialog request={approving} trustProfile={trustProfile} onApprove={approve} onClose={() => setApproving(null)} />

      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => !open && setConfirming(null)}
        destructive
        title={confirming?.kind === "decline" ? `Decline ${confirming.request.requesterName}'s request?` : confirming?.kind === "revoke" ? `Revoke access for ${confirming.request.requesterName}?` : "Revoke this secure link?"}
        confirmLabel={confirming?.kind === "decline" ? "Decline request" : confirming?.kind === "revoke" ? "Revoke access" : "Revoke link"}
        description={
          confirming?.kind === "decline" ? <p>Nothing will be shared. They can send a new request later.</p>
          : confirming?.kind === "revoke" ? <p>They will immediately lose access to the {scopeSize(confirming.request.approved)} items you shared. Anything they already viewed may have been recorded on their side.</p>
          : <p>Anyone opening the link will see that access was revoked. This can't be undone; create a new link if needed.</p>
        }
        onConfirm={runConfirmed}
      />
    </div>
  );
}
