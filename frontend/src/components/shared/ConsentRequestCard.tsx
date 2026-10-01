import { AlertTriangle, Building2, Landmark } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/shared/StatusPill";
import { DisclosureChips } from "@/components/shared/DisclosureChips";
import { backendFieldLabel } from "@/lib/fieldLabels";
import { scopeSize, withheldScope } from "@/lib/disclosure";
import type { ConsentRequest } from "@/types";
import { formatDateTime, formatDurationDays, timeUntil } from "@/lib/utils";

const CONSENT_STATUS_PILL = {
  pending: { label: "Awaiting decision", tone: "pending" as const },
  active: { label: "Access active", tone: "verified" as const },
  rejected: { label: "Declined", tone: "danger" as const },
  revoked: { label: "Revoked", tone: "danger" as const },
  expired: { label: "Expired", tone: "neutral" as const },
};

interface ConsentRequestCardProps {
  request: ConsentRequest;
  onApprove?: () => void;
  onReject?: () => void;
  onRevoke?: () => void;
}

export function ConsentRequestCard({ request, onApprove, onReject, onRevoke }: ConsentRequestCardProps) {
  const RoleIcon = request.requesterRole === "bank" ? Landmark : Building2;
  const status = CONSENT_STATUS_PILL[request.status];
  const decided = request.status === "active" || request.status === "revoked" || request.status === "expired";

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">
              <RoleIcon className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">{request.requesterName}</p>
              <p className="text-xs text-muted-foreground">
                {request.requesterRole === "bank" ? "Bank / NBFC" : request.requesterRole === "buyer" ? "Buyer" : "Verifier"} · Requested {formatDateTime(request.requestedAt)}
              </p>
              <p className="mt-1 text-xs font-medium text-slate-600">Purpose: {request.purpose || "Not stated"}</p>
            </div>
          </div>
          <StatusPill label={status.label} tone={status.tone} />
        </div>

        <div className="mt-4 space-y-2">
          {decided ? (
            <>
              <p className="text-xs font-medium text-slate-600">Shared {scopeSize(request.approved)} of {scopeSize(request.requested)} requested items</p>
              <DisclosureChips scope={request.approved} withheld={withheldScope(request.requested, request.approved)} />
            </>
          ) : (
            <>
              <p className="text-xs font-medium text-slate-600">Requested ({scopeSize(request.requested)} items)</p>
              <DisclosureChips scope={request.requested} />
            </>
          )}
          {request.unsupportedRequested.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-warning-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Also requested, but not shareable through Pramaan: {request.unsupportedRequested.map(backendFieldLabel).join(", ")}
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">
            {request.status === "pending" && "Nothing is shared until you approve."}
            {request.status === "active" && `${formatDurationDays(request.durationDays)} access · expires ${formatDateTime(request.expiresAt)} (${timeUntil(request.expiresAt)})`}
            {request.status === "rejected" && "You declined this request. Nothing was shared."}
            {request.status === "revoked" && `Revoked ${formatDateTime(request.revokedAt)}. The verifier can no longer open it.`}
            {request.status === "expired" && `Expired ${formatDateTime(request.expiresAt)}. The verifier can no longer open it.`}
          </div>

          <div className="flex gap-2">
            {request.status === "pending" && (
              <>
                <Button size="sm" variant="outline" onClick={onReject}>
                  Reject
                </Button>
                <Button size="sm" onClick={onApprove} disabled={scopeSize(request.requested) === 0}>
                  Review &amp; approve
                </Button>
              </>
            )}
            {request.status === "active" && (
              <Button size="sm" variant="destructive" onClick={onRevoke}>
                Revoke
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
