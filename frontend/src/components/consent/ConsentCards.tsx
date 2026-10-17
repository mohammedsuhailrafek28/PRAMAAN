import { AlertTriangle, Building2, Clock, Landmark, Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConsentStatusBadge, LinkStatusBadge } from "@/components/shared/EvidenceStatusBadge";
import { RequesterIdentityBadge, RequesterOrganization } from "@/components/shared/RequesterIdentityBadge";
import { ScopeColumns } from "@/components/consent/ScopeColumns";
import { effectiveAssurance } from "@/lib/requesterIdentity";
import { backendFieldLabel } from "@/lib/fieldLabels";
import { scopeSize, withheldScope } from "@/lib/disclosure";
import { formatDateTime, formatDurationDays, timeAgo, timeUntil } from "@/lib/utils";
import type { AccessGrant, ConsentRequest } from "@/types";

function Requester({ request }: { request: ConsentRequest }) {
  const Icon = request.requesterRole === "bank" ? Landmark : Building2;
  const declared = request.requesterRole === "bank" ? "Bank / NBFC" : request.requesterRole === "buyer" ? "Buyer" : "Verifier";
  const reviewed = effectiveAssurance(request.requesterIdentity).level === "ORG_REVIEWED" || effectiveAssurance(request.requesterIdentity).level === "AUTHORIZED";
  // The account type is chosen at registration, so it is a claim unless a review is in force.
  const role = reviewed || !request.requesterRole ? declared : `Declares itself a ${declared}`;
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Icon className="h-5 w-5" aria-hidden /></div>
      <div className="min-w-0">
        <RequesterOrganization heading identity={request.requesterIdentity} fallbackName={request.requesterName} />
        <p className="text-xs text-slate-500">{role} · requested {timeAgo(request.requestedAt)}</p>
        <div className="mt-1.5"><RequesterIdentityBadge identity={request.requesterIdentity} /></div>
      </div>
    </div>
  );
}

/** A request awaiting the MSME's decision. */
export function PendingRequestCard({ request, onReview, onDecline }: { request: ConsentRequest; onReview: () => void; onDecline: () => void }) {
  return (
    <Card className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <Requester request={request} />
        <ConsentStatusBadge status="pending" />
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-slate-500">Purpose</dt><dd className="font-medium text-slate-900">{request.purpose || "Not stated"}</dd></div>
        <div><dt className="text-xs text-slate-500">Asking for</dt><dd className="font-medium text-slate-900">{scopeSize(request.requested)} item{scopeSize(request.requested) === 1 ? "" : "s"}</dd></div>
        <div><dt className="text-xs text-slate-500">Access period</dt><dd className="font-medium text-slate-900">You choose on approval</dd></div>
      </dl>
      <div className="mt-4"><ScopeColumns scope={request.requested} /></div>
      {request.unsupportedRequested.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-warning-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Also asked for items Pramaan can't share: {request.unsupportedRequested.map(backendFieldLabel).join(", ")}
        </p>
      )}
      <div className="mt-4 flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">Requested {formatDateTime(request.requestedAt)} · nothing is shared until you approve</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onDecline} className="flex-1 sm:flex-none">Decline</Button>
          <Button onClick={onReview} disabled={scopeSize(request.requested) === 0} className="flex-1 sm:flex-none">Review &amp; approve</Button>
        </div>
      </div>
    </Card>
  );
}

/** A registered verifier who currently has (or had) access. */
export function ConsentAccessCard({ request, onRevoke }: { request: ConsentRequest; onRevoke?: () => void }) {
  const active = request.status === "active";
  return (
    <Card className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <Requester request={request} />
        <ConsentStatusBadge status={request.status} />
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-slate-500">Why</dt><dd className="font-medium text-slate-900">{request.purpose || "Not stated"}</dd></div>
        <div><dt className="text-xs text-slate-500">What</dt><dd className="font-medium text-slate-900">{scopeSize(request.approved)} of {scopeSize(request.requested)} requested items</dd></div>
        <div>
          <dt className="text-xs text-slate-500">{request.status === "revoked" ? "Revoked" : active ? "Until" : request.status === "rejected" ? "Decision" : "Ended"}</dt>
          <dd className="font-medium text-slate-900">
            {request.status === "revoked" ? formatDateTime(request.revokedAt) : request.status === "rejected" ? "Declined" : formatDateTime(request.expiresAt)}
            {active && <span className="ml-1.5 text-xs font-normal text-slate-500">({timeUntil(request.expiresAt)})</span>}
          </dd>
        </div>
      </dl>
      {request.status !== "rejected" && <div className="mt-4"><ScopeColumns scope={request.approved} withheld={withheldScope(request.requested, request.approved)} /></div>}
      <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          {request.approvedAt ? `Approved ${formatDateTime(request.approvedAt)} for ${formatDurationDays(request.durationDays)}` : `Requested ${formatDateTime(request.requestedAt)}`}
          {active && " · values come from the Trust Profile version pinned at approval"}
        </p>
        {active && onRevoke && <Button variant="outline" className="border-negative-border text-negative-foreground hover:bg-negative-bg" onClick={onRevoke}>Revoke access</Button>}
      </div>
    </Card>
  );
}

/** A secure (guest) link. */
export function SecureLinkCard({ grant, onRevoke }: { grant: AccessGrant; onRevoke?: () => void }) {
  return (
    <Card className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Link2 className="h-5 w-5" aria-hidden /></div>
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold text-slate-900">{grant.recipientOrganization || grant.recipientName || "Secure link recipient"}</h3>
            <p className="text-xs text-slate-500">Secure link · created {timeAgo(grant.createdAt)}{grant.recipientEmail ? ` · for ${grant.recipientEmail}` : ""}</p>
          </div>
        </div>
        <LinkStatusBadge status={grant.status} />
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-slate-500">Why</dt><dd className="font-medium text-slate-900">{grant.purpose}</dd></div>
        <div><dt className="text-xs text-slate-500">{grant.status === "REVOKED" ? "Revoked" : grant.status === "ACTIVE" ? "Until" : "Ended"}</dt><dd className="font-medium text-slate-900">{grant.status === "REVOKED" ? formatDateTime(grant.revokedAt) : formatDateTime(grant.expiresAt)}{grant.status === "ACTIVE" && <span className="ml-1.5 text-xs font-normal text-slate-500">({timeUntil(grant.expiresAt)})</span>}</dd></div>
        <div><dt className="text-xs text-slate-500">Last opened</dt><dd className="font-medium text-slate-900">{grant.lastAccessedAt ? formatDateTime(grant.lastAccessedAt) : "Not opened yet"}</dd></div>
      </dl>
      <div className="mt-4"><ScopeColumns scope={grant.scope} /></div>
      {grant.status === "ACTIVE" && onRevoke && (
        <div className="mt-4 flex justify-end border-t border-slate-100 pt-4">
          <Button variant="outline" className="border-negative-border text-negative-foreground hover:bg-negative-bg" onClick={onRevoke}>Revoke link</Button>
        </div>
      )}
    </Card>
  );
}
