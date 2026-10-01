import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Link2, ShieldCheck, Ban, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/shared/StatusPill";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatDateTime } from "@/lib/utils";
import { getApiError, createAccessGrant, getAccessGrants, getIncomingRequests, getBusiness, revokeAccessGrant, revokeConsentRequest } from "@/services/api";
import type { AccessGrant, Business, ShareableEvidenceType, ShareableField } from "@/types";

const fields: Array<[ShareableField, string]> = [["legalBusinessName", "Legal business name"], ["gstin", "GSTIN"], ["udyamNumber", "Udyam number"], ["address", "Registered address"], ["turnoverBand", "Turnover band"], ["summary", "Trust readiness summary"]];
const evidence: Array<[ShareableEvidenceType, string]> = [["GST_CERTIFICATE", "GST certificate"], ["UDYAM_CERTIFICATE", "Udyam certificate"], ["BANK_STATEMENT", "Bank statement"]];

export function AccessControlPage() {
  const [business, setBusiness] = useState<Business | null>(null);
  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [registered, setRegistered] = useState<Awaited<ReturnType<typeof getIncomingRequests>>>([]);
  const [selectedFields, setSelectedFields] = useState<ShareableField[]>(["legalBusinessName", "gstin"]);
  const [selectedEvidence, setSelectedEvidence] = useState<ShareableEvidenceType[]>([]);
  const [recipientName, setRecipientName] = useState("");
  const [recipientOrganization, setRecipientOrganization] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [purpose, setPurpose] = useState("Business verification");
  const [duration, setDuration] = useState("168");
  const [created, setCreated] = useState<AccessGrant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() { try { const [b, g, r] = await Promise.all([getBusiness(), getAccessGrants(), getIncomingRequests()]); setBusiness(b); setGrants(g); setRegistered(r); } catch (e) { setError(getApiError(e)); } }
  useEffect(() => { void load(); }, []);
  const currentDocs = useMemo(() => business?.documents.filter((doc) => doc.isCurrent !== false) || [], [business]);
  const toggle = <T,>(value: T, selected: T[], setter: (next: T[]) => void) => setter(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);

  async function create() {
    if (!selectedFields.length && !selectedEvidence.length) { setError("Select at least one field or evidence type."); return; }
    setBusy(true); setError(null);
    try { const grant = await createAccessGrant({ recipientName: recipientName || undefined, recipientOrganization: recipientOrganization || undefined, recipientEmail: recipientEmail || undefined, purpose, scope: { fields: selectedFields, evidenceTypes: selectedEvidence }, durationHours: Number(duration) }); setCreated(grant); setGrants((items) => [grant, ...items]); }
    catch (e) { setError(getApiError(e)); } finally { setBusy(false); }
  }
  async function revoke(id: string) { try { const grant = await revokeAccessGrant(id); setGrants((items) => items.map((item) => item.id === id ? grant : item)); } catch (e) { setError(getApiError(e)); } }
  async function copy(url?: string) { if (!url) return; await navigator.clipboard.writeText(url); }

  return <div className="space-y-6">
    <div><h2 className="text-xl font-semibold text-slate-900">Share Evidence</h2><p className="mt-1 text-sm text-muted-foreground">Create a secure, time-limited link for a verifier who does not need a Pramaan account.</p></div>
    <Card><CardHeader><CardTitle className="text-base">Create secure link</CardTitle></CardHeader><CardContent className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3"><div><Label>Recipient name</Label><Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Optional" /></div><div><Label>Organization</Label><Input value={recipientOrganization} onChange={(e) => setRecipientOrganization(e.target.value)} placeholder="Optional" /></div><div><Label>Email</Label><Input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="Optional" /></div></div>
      <div className="grid gap-4 sm:grid-cols-2"><div><Label>Purpose</Label><select className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={purpose} onChange={(e) => setPurpose(e.target.value)}>{["Business verification", "Loan application", "Vendor onboarding", "Procurement", "Other"].map((item) => <option key={item}>{item}</option>)}</select></div><div><Label>Access duration</Label><select className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={duration} onChange={(e) => setDuration(e.target.value)}><option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option></select></div></div>
      <div><Label>Profile fields</Label><div className="mt-2 grid gap-2 sm:grid-cols-3">{fields.map(([value, label]) => <label key={value} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"><input type="checkbox" checked={selectedFields.includes(value)} onChange={() => toggle(value, selectedFields, setSelectedFields)} />{label}</label>)}</div></div>
      <div><Label>Current evidence</Label><div className="mt-2 grid gap-2 sm:grid-cols-3">{evidence.map(([value, label]) => { const available = currentDocs.some((doc) => doc.type.toUpperCase() === value); return <label key={value} className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${available ? "" : "opacity-50"}`}><input type="checkbox" disabled={!available} checked={selectedEvidence.includes(value)} onChange={() => toggle(value, selectedEvidence, setSelectedEvidence)} />{label}{!available && <span className="text-xs text-muted-foreground">Missing</span>}</label>; })}</div></div>
      <div className="rounded-md bg-surface px-4 py-3 text-xs text-muted-foreground">Only the selected current fields and evidence metadata will be visible. The link expires automatically and can be revoked at any time.</div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button onClick={() => void create()} disabled={busy}><Link2 className="h-4 w-4" />{busy ? "Creating..." : "Create Secure Link"}</Button>
    </CardContent></Card>
    {created?.secureUrl && <Card className="border-verified-foreground/30 bg-verified-bg"><CardContent className="space-y-3 p-5"><div className="flex items-center gap-2 font-medium text-verified-foreground"><Check className="h-4 w-4" />Secure link created</div><div className="break-all rounded-md bg-white px-3 py-2 font-mono text-xs text-slate-700">{created.secureUrl}</div><div className="flex items-center gap-3 text-xs text-muted-foreground"><span>Expires {formatDateTime(created.expiresAt)}</span><Button size="sm" variant="outline" onClick={() => void copy(created.secureUrl)}><Copy className="h-3.5 w-3.5" />Copy link</Button></div></CardContent></Card>}
    <div><h3 className="mb-3 text-base font-semibold text-slate-900">Active Access</h3>{grants.length === 0 ? <EmptyState icon={ShieldCheck} title="No external links yet" description="Created secure links will appear here with their current state." /> : <div className="space-y-3">{grants.map((grant) => <Card key={grant.id}><CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-medium text-slate-900">{grant.recipientOrganization || grant.recipientName || "External verifier"}</span><StatusPill label={grant.status === "ACTIVE" ? "Active" : grant.status === "REVOKED" ? "Revoked" : "Expired"} tone={grant.status === "ACTIVE" ? "verified" : grant.status === "EXPIRED" ? "warning" : "default"} /></div><p className="mt-1 text-sm text-muted-foreground">{grant.purpose} · {grant.scope.fields.length + grant.scope.evidenceTypes.length} selected items · expires {formatDateTime(grant.expiresAt)}</p><p className="mt-1 text-xs text-muted-foreground">{grant.lastAccessedAt ? `Last accessed ${formatDateTime(grant.lastAccessedAt)}` : "Not accessed yet"}</p></div>{grant.status === "ACTIVE" && <Button variant="outline" onClick={() => void revoke(grant.id)}><Ban className="h-4 w-4" />Revoke</Button>}</CardContent></Card>)}</div>}</div>
    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />Backend expiry and scope checks remain authoritative.</div>
    <div className="space-y-3"><h3 className="text-base font-semibold text-slate-900">Registered verifier access</h3>{registered.filter((request) => request.status === "active").length === 0 ? <p className="text-sm text-muted-foreground">No registered buyers or banks currently have active access.</p> : registered.filter((request) => request.status === "active").map((request) => <Card key={request.id}><CardContent className="flex items-center justify-between gap-3 p-4"><div><p className="font-medium text-slate-900">{request.requesterName}</p><p className="text-sm text-muted-foreground">Pramaan verifier · {request.purpose || "Verification"} · {request.approvedFields.length} approved fields</p></div><Button variant="outline" onClick={() => void revokeConsentRequest(request.id).then(load)}><Ban className="h-4 w-4" />Revoke</Button></CardContent></Card>)}</div>
  </div>;
}
