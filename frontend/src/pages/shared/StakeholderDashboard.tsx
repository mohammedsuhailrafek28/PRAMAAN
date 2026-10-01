import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileSearch, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/shared/StatusPill";
import { EmptyState } from "@/components/shared/EmptyState";
import { DisclosureSelector } from "@/components/shared/DisclosureSelector";
import { DisclosureChips } from "@/components/shared/DisclosureChips";
import * as api from "@/services/api";
import { getApiError } from "@/services/api";
import type { ConsentRequest, Role } from "@/types";
import { scopeSize, withheldScope, type DisclosureScope } from "@/lib/disclosure";
import { formatDate, formatDateTime, timeUntil } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";

const PURPOSES = ["Business Loan", "Vendor Onboarding", "Procurement", "Custom"] as const;
// Suggested starting scopes per purpose; the verifier can change every item before sending.
const PRESETS: Record<(typeof PURPOSES)[number], DisclosureScope> = {
  "Business Loan": { fields: ["legalBusinessName", "gstin", "udyamNumber", "turnoverBand", "summary"], evidence: ["BANK_STATEMENT"] },
  "Vendor Onboarding": { fields: ["legalBusinessName", "gstin", "udyamNumber", "address", "summary"], evidence: ["GST_CERTIFICATE"] },
  Procurement: { fields: ["legalBusinessName", "gstin", "address", "summary"], evidence: ["GST_CERTIFICATE", "UDYAM_CERTIFICATE"] },
  Custom: { fields: ["legalBusinessName", "gstin"], evidence: [] },
};
type CaseState = "WAITING_FOR_CONSENT" | "READY_TO_REVIEW" | "REJECTED" | "REVOKED" | "EXPIRED";
// mapConsent already downgrades lapsed approvals to "expired".
function stateOf(request: ConsentRequest): CaseState {
  if (request.status === "pending") return "WAITING_FOR_CONSENT";
  if (request.status === "active") return "READY_TO_REVIEW";
  if (request.status === "rejected") return "REJECTED";
  if (request.status === "revoked") return "REVOKED";
  return "EXPIRED";
}
const LABELS: Record<CaseState, string> = { WAITING_FOR_CONSENT: "Waiting for consent", READY_TO_REVIEW: "Access granted", REJECTED: "Declined by MSME", REVOKED: "Revoked by MSME", EXPIRED: "Expired" };
const TONES: Record<CaseState, "pending" | "verified" | "danger" | "neutral"> = { WAITING_FOR_CONSENT: "pending", READY_TO_REVIEW: "verified", REJECTED: "danger", REVOKED: "danger", EXPIRED: "neutral" };
const HINTS: Record<CaseState, string> = {
  WAITING_FOR_CONSENT: "The MSME is reviewing your request. Nothing is visible until they approve.",
  READY_TO_REVIEW: "",
  REJECTED: "The MSME declined. No information was shared.",
  REVOKED: "The MSME revoked access. Request again if you still need it.",
  EXPIRED: "The access period ended. Create a new request when needed.",
};
interface Props { role: Extract<Role, "buyer" | "bank">; helperText: string; }
type Filter = "All" | "Waiting" | "Access granted" | "Closed";

function CaseCard({ request, state, onOpen }: { request: ConsentRequest; state: CaseState; onOpen: () => void }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{request.businessName || "Business name unavailable"}</p>
            <p className="text-xs text-muted-foreground">{request.businessGstin ? `GSTIN ${request.businessGstin} · ` : ""}{request.purpose || "Purpose not stated"} · Requested {formatDate(request.requestedAt)}</p>
          </div>
          <StatusPill label={LABELS[state]} tone={TONES[state]} />
        </div>
        <div className="space-y-1.5 text-xs text-slate-600">
          {state === "READY_TO_REVIEW" || state === "REVOKED" || state === "EXPIRED" ? (
            <>
              <p className="font-medium">Approved {scopeSize(request.approved)} of {scopeSize(request.requested)} requested</p>
              <DisclosureChips scope={request.approved} withheld={withheldScope(request.requested, request.approved)} />
            </>
          ) : (
            <>
              <p className="font-medium">Requested ({scopeSize(request.requested)})</p>
              <DisclosureChips scope={request.requested} />
            </>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {state === "READY_TO_REVIEW" ? `Access until ${formatDateTime(request.expiresAt)} (${timeUntil(request.expiresAt)})` : HINTS[state]}
          </p>
          {state === "READY_TO_REVIEW" && <Button size="sm" onClick={onOpen}>Open Trust View</Button>}
        </div>
      </CardContent>
    </Card>
  );
}

export function StakeholderDashboard({ role, helperText }: Props) {
  const { toast } = useToast(); const navigate = useNavigate();
  const [requests, setRequests] = useState<ConsentRequest[]>([]); const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(""); const [found, setFound] = useState<Awaited<ReturnType<typeof api.lookupBusiness>> | null>(null); const [searched, setSearched] = useState(false);
  const initialPurpose: (typeof PURPOSES)[number] = role === "bank" ? "Business Loan" : "Vendor Onboarding";
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]>(initialPurpose); const [selected, setSelected] = useState<DisclosureScope>(PRESETS[initialPurpose]);
  const [creating, setCreating] = useState(false); const [filter, setFilter] = useState<Filter>("All");

  const load = useCallback(async () => {
    setLoading(true);
    try { setRequests(await api.getOutgoingRequests()); }
    catch (e) { toast({ title: "Workspace unavailable", description: getApiError(e), variant: "destructive" }); }
    finally { setLoading(false); }
  }, [toast]);

  // Load on entry and when the tab regains focus (e.g. after switching to the MSME to approve).
  // Listing outgoing requests is read-only and is not recorded as a Trust Profile view.
  useEffect(() => {
    void load();
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const withState = useMemo(() => requests.map((request) => ({ request, state: stateOf(request) })), [requests]);
  const cases = useMemo(() => withState.filter(({ state }) => filter === "All" || (filter === "Waiting" && state === "WAITING_FOR_CONSENT") || (filter === "Access granted" && state === "READY_TO_REVIEW") || (filter === "Closed" && ["EXPIRED", "REJECTED", "REVOKED"].includes(state))), [withState, filter]);
  const counts = useMemo(() => withState.reduce((acc, { state }) => { acc[state] += 1; return acc; }, { WAITING_FOR_CONSENT: 0, READY_TO_REVIEW: 0, REJECTED: 0, REVOKED: 0, EXPIRED: 0 } as Record<CaseState, number>), [withState]);

  async function search() { setSearched(true); try { setFound(await api.lookupBusiness(query)); } catch (e) { setFound(null); toast({ title: "Business lookup failed", description: getApiError(e), variant: "destructive" }); } }
  function choosePurpose(next: (typeof PURPOSES)[number]) { setPurpose(next); setSelected(PRESETS[next]); }
  async function sendRequest() {
    if (!found) return; setCreating(true);
    try { await api.createConsentRequest({ lookup: found.gstin, purpose, scope: selected }); setFound(null); setSearched(false); setQuery(""); await load(); toast({ title: "Request sent", description: `${found.legalName} will decide what to approve and for how long.` }); }
    catch (e) { toast({ title: "Request failed", description: getApiError(e), variant: "destructive" }); }
    finally { setCreating(false); }
  }

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="text-xl font-semibold text-slate-900">Verification Workspace</h2><p className="mt-1 text-sm text-muted-foreground">{helperText}</p></div><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button></div>
    <div className="grid gap-3 sm:grid-cols-3"><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Access granted</p><p className="mt-1 text-2xl font-semibold">{counts.READY_TO_REVIEW}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Waiting for consent</p><p className="mt-1 text-2xl font-semibold">{counts.WAITING_FOR_CONSENT}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Expired, declined or revoked</p><p className="mt-1 text-2xl font-semibold">{counts.EXPIRED + counts.REVOKED + counts.REJECTED}</p></CardContent></Card></div>
    <Card><CardHeader><CardTitle className="text-base">Request MSME information</CardTitle></CardHeader><CardContent className="space-y-4"><div className="flex gap-2"><Input aria-label="MSME GSTIN" placeholder="Search MSME by GSTIN" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} /><Button variant="outline" onClick={() => void search()}><Search className="h-4 w-4" />Find</Button></div>{searched && !found && <p className="text-sm text-muted-foreground">No business found. Check the GSTIN and try again.</p>}{found && <div className="space-y-4 rounded-md border bg-surface p-4"><div><p className="font-semibold">{found.legalName}</p><p className="text-xs text-muted-foreground">GSTIN {found.gstin}</p></div><div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor="purpose" className="text-xs font-medium text-slate-600">Purpose</label><select id="purpose" className="mt-1 h-10 w-full rounded-md border bg-white px-3 text-sm" value={purpose} onChange={(e) => choosePurpose(e.target.value as (typeof PURPOSES)[number])}>{PURPOSES.map((item) => <option key={item}>{item}</option>)}</select></div><div className="text-xs text-muted-foreground"><p className="font-medium text-slate-600">Request context</p><p className="mt-2">The MSME sees your organization, purpose, and each item you ask for, then decides what to approve and for how long. Ask only for what you need.</p></div></div><div><p className="mb-2 text-xs font-medium text-slate-600">What you're asking for</p><DisclosureSelector idPrefix="request" value={selected} onChange={setSelected} /></div><div className="rounded-md bg-white px-3 py-3 text-xs text-muted-foreground">You are about to request {selected.fields.length} field{selected.fields.length === 1 ? "" : "s"} and {selected.evidence.length} evidence item{selected.evidence.length === 1 ? "" : "s"} from {found.legalName} for {purpose.toLowerCase()}.</div><Button onClick={() => void sendRequest()} disabled={creating || scopeSize(selected) === 0}>{creating ? "Sending..." : "Send Request"}</Button></div>}</CardContent></Card>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter cases">{(["All", "Waiting", "Access granted", "Closed"] as const).map((item) => <Button key={item} size="sm" variant={filter === item ? "default" : "outline"} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</Button>)}</div>
    {cases.length === 0 ? <EmptyState icon={FileSearch} title={loading ? "Loading cases" : "No verification cases"} description="Search by GSTIN to start a consent request to a registered MSME." /> : <div className="space-y-3">{cases.map(({ request, state }) => <CaseCard key={request.id} request={request} state={state} onOpen={() => navigate(`/trust-view/${request.id}`)} />)}</div>}
  </div>;
}
