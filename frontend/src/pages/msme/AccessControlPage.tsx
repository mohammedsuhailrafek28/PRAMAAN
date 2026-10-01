import { useEffect, useMemo, useState } from "react";
import { Ban, Check, Clock3, Copy, Link2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/shared/StatusPill";
import { EmptyState } from "@/components/shared/EmptyState";
import { DisclosureSelector } from "@/components/shared/DisclosureSelector";
import { DisclosureChips } from "@/components/shared/DisclosureChips";
import { formatDateTime } from "@/lib/utils";
import { EVIDENCE_KEYS, scopeSize, type DisclosureScope, type EvidenceKey } from "@/lib/disclosure";
import { getApiError, createAccessGrant, getAccessGrants, getIncomingRequests, getBusiness, revokeAccessGrant, revokeConsentRequest } from "@/services/api";
import type { AccessGrant, Business, ConsentRequest } from "@/types";

const PURPOSES = ["Business verification", "Loan application", "Vendor onboarding", "Procurement", "Other"];

export function AccessControlPage() {
  const [business, setBusiness] = useState<Business | null>(null);
  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [registered, setRegistered] = useState<ConsentRequest[]>([]);
  const [scope, setScope] = useState<DisclosureScope>({ fields: ["legalBusinessName", "gstin"], evidence: [] });
  const [recipientName, setRecipientName] = useState("");
  const [recipientOrganization, setRecipientOrganization] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [duration, setDuration] = useState("168");
  const [created, setCreated] = useState<AccessGrant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [b, g, r] = await Promise.all([getBusiness(), getAccessGrants(), getIncomingRequests()]);
      setBusiness(b); setGrants(g); setRegistered(r);
    } catch (e) { setError(getApiError(e)); }
  }
  useEffect(() => { void load(); }, []);

  // Evidence can only be shared when a current document of that type is on file.
  const missingEvidence = useMemo(() => {
    const current = new Set((business?.documents ?? []).filter((doc) => doc.isCurrent !== false).map((doc) => doc.type.toUpperCase()));
    return Object.fromEntries(EVIDENCE_KEYS.filter((key) => !current.has(key)).map((key) => [key, "No current document on file"])) as Partial<Record<EvidenceKey, string>>;
  }, [business]);

  async function create() {
    if (scopeSize(scope) === 0) { setError("Select at least one item to share."); return; }
    setBusy(true); setError(null);
    try {
      const grant = await createAccessGrant({ recipientName: recipientName || undefined, recipientOrganization: recipientOrganization || undefined, recipientEmail: recipientEmail || undefined, purpose, scope, durationHours: Number(duration) });
      setCreated(grant); setGrants((items) => [grant, ...items]);
    } catch (e) { setError(getApiError(e)); } finally { setBusy(false); }
  }
  async function revoke(id: string) { try { const grant = await revokeAccessGrant(id); setGrants((items) => items.map((item) => item.id === id ? grant : item)); } catch (e) { setError(getApiError(e)); } }
  async function copy(url?: string) { if (url) await navigator.clipboard.writeText(url); }

  const activeRegistered = registered.filter((request) => request.status === "active");

  return <div className="space-y-6">
    <div><h2 className="text-xl font-semibold text-slate-900">Share via secure link</h2><p className="mt-1 text-sm text-muted-foreground">Create a time-limited link for someone who doesn't have a Pramaan account. It uses the same sharing choices as consent requests.</p></div>
    <Card><CardHeader><CardTitle className="text-base">Create secure link</CardTitle></CardHeader><CardContent className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div><Label htmlFor="g-name">Recipient name</Label><Input id="g-name" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Optional" /></div>
        <div><Label htmlFor="g-org">Organization</Label><Input id="g-org" value={recipientOrganization} onChange={(e) => setRecipientOrganization(e.target.value)} placeholder="Optional" /></div>
        <div><Label htmlFor="g-email">Email</Label><Input id="g-email" type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="Optional" /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label htmlFor="g-purpose">Purpose</Label><select id="g-purpose" className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={purpose} onChange={(e) => setPurpose(e.target.value)}>{PURPOSES.map((item) => <option key={item}>{item}</option>)}</select></div>
        <div><Label htmlFor="g-duration">Access period</Label><select id="g-duration" className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={duration} onChange={(e) => setDuration(e.target.value)}><option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option></select></div>
      </div>
      <div>
        <div className="mb-2 flex items-baseline justify-between"><Label>What to share</Label><span className="text-xs font-medium text-slate-600">{scopeSize(scope)} selected</span></div>
        <DisclosureSelector idPrefix="guest" value={scope} onChange={setScope} disabledEvidence={missingEvidence} />
      </div>
      <div className="rounded-md bg-surface px-4 py-3 text-xs text-muted-foreground">The link shares your current Trust Profile version, fixed when the link is created, including evidence as of that version. It expires automatically and you can revoke it at any time.</div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button onClick={() => void create()} disabled={busy || scopeSize(scope) === 0}><Link2 className="h-4 w-4" />{busy ? "Creating..." : "Create secure link"}</Button>
    </CardContent></Card>
    {created?.secureUrl && <Card className="border-verified-foreground/30 bg-verified-bg"><CardContent className="space-y-3 p-5"><div className="flex items-center gap-2 font-medium text-verified-foreground"><Check className="h-4 w-4" />Secure link created</div><div className="break-all rounded-md bg-white px-3 py-2 font-mono text-xs text-slate-700">{created.secureUrl}</div><div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><span>Expires {formatDateTime(created.expiresAt)}</span><Button size="sm" variant="outline" onClick={() => void copy(created.secureUrl)}><Copy className="h-3.5 w-3.5" />Copy link</Button></div></CardContent></Card>}
    <div><h3 className="mb-3 text-base font-semibold text-slate-900">Secure links</h3>{grants.length === 0 ? <EmptyState icon={ShieldCheck} title="No secure links yet" description="Links you create will appear here with their current state." /> : <div className="space-y-3">{grants.map((grant) => <Card key={grant.id}><CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 space-y-2"><div className="flex flex-wrap items-center gap-2"><span className="font-medium text-slate-900">{grant.recipientOrganization || grant.recipientName || "Link recipient"}</span><StatusPill label={grant.status === "ACTIVE" ? "Active" : grant.status === "REVOKED" ? "Revoked" : "Expired"} tone={grant.status === "ACTIVE" ? "verified" : grant.status === "EXPIRED" ? "warning" : "neutral"} /></div><p className="text-sm text-muted-foreground">{grant.purpose} · expires {formatDateTime(grant.expiresAt)} · {grant.lastAccessedAt ? `last opened ${formatDateTime(grant.lastAccessedAt)}` : "not opened yet"}</p><DisclosureChips scope={grant.scope} /></div>{grant.status === "ACTIVE" && <Button variant="outline" onClick={() => void revoke(grant.id)}><Ban className="h-4 w-4" />Revoke</Button>}</CardContent></Card>)}</div>}</div>
    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />Expiry and scope are enforced by Pramaan's server, not this page.</div>
    <div className="space-y-3"><h3 className="text-base font-semibold text-slate-900">Registered verifier access</h3>{activeRegistered.length === 0 ? <p className="text-sm text-muted-foreground">No registered buyers or banks currently have active access.</p> : activeRegistered.map((request) => <Card key={request.id}><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="space-y-2"><p className="font-medium text-slate-900">{request.requesterName}</p><p className="text-sm text-muted-foreground">Pramaan verifier · {request.purpose || "Verification"} · expires {formatDateTime(request.expiresAt)}</p><DisclosureChips scope={request.approved} /></div><Button variant="outline" onClick={() => void revokeConsentRequest(request.id).then(load).catch((e) => setError(getApiError(e)))}><Ban className="h-4 w-4" />Revoke</Button></CardContent></Card>)}</div>
  </div>;
}
