import { Building2, Landmark } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/shared/StatusPill";
import {
  CONSENT_DURATION_LABELS,
  CONSENT_FIELD_LABELS,
  type ConsentRequest,
} from "@/types";
import { formatDateTime, timeUntil } from "@/lib/utils";

const STATUS_TONE = {
  pending: { label: "Pending", tone: "pending" as const },
  active: { label: "Active", tone: "verified" as const },
  rejected: { label: "Rejected", tone: "danger" as const },
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
  const status = STATUS_TONE[request.status];
  const fieldsToShow = request.status === "pending" ? request.requestedFields : request.approvedFields;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-50 text-primary-700">
              <RoleIcon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">{request.requesterName}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {request.requesterRole === "bank" ? "Bank / NBFC" : "Buyer"} · Requested{" "}
                {formatDateTime(request.requestedAt)}
              </p>
              {request.purpose && <p className="mt-1 text-xs font-medium text-slate-600">Purpose: {request.purpose}</p>}
            </div>
          </div>
          <StatusPill label={status.label} tone={status.tone} />
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {fieldsToShow.map((f) => (
            <span
              key={f}
              className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-slate-600"
            >
              {CONSENT_FIELD_LABELS[f]}
            </span>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
          <div className="text-xs text-muted-foreground">
            {request.status === "pending" && "Awaiting your decision"}
            {request.status === "active" && request.expiresAt && (
              <>
                {CONSENT_DURATION_LABELS[request.durationHours!]} · {timeUntil(request.expiresAt)}
              </>
            )}
            {request.status === "rejected" && `Rejected ${formatDateTime(request.rejectedAt!)}`}
            {request.status === "revoked" && `Revoked ${formatDateTime(request.revokedAt!)}`}
            {request.status === "expired" && request.expiresAt && `Expired ${formatDateTime(request.expiresAt)}`}
          </div>

          <div className="flex gap-2">
            {request.status === "pending" && (
              <>
                <Button size="sm" variant="outline" onClick={onReject}>
                  Reject
                </Button>
                <Button size="sm" onClick={onApprove}>
                  Approve
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
