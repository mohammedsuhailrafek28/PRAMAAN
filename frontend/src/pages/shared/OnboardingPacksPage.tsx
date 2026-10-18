import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, ClipboardList, FileUp, Loader2, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { useToast } from "@/components/ui/use-toast";
import { getApiError } from "@/services/api";
import * as api from "@/services/api";
import { captureSession, isStaleSession } from "@/services/sessionEpoch";
import type { OnboardingAssignment, OnboardingPack, Role } from "@/types";
import { cn } from "@/lib/utils";
import { effectiveAssurance } from "@/lib/requesterIdentity";

function statusLabel(status: OnboardingAssignment["status"]) {
  return status.replace(/_/g, " ").toLowerCase().replace(/^./, (value: string) => value.toUpperCase());
}

function AssignmentCard({ assignment, owner, onChange }: { assignment: OnboardingAssignment; owner: boolean; onChange: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function act(action: "accept" | "decline" | "cancel") {
    setBusy(true);
    try {
      if (action === "accept") await api.acceptOnboardingAssignment(assignment.id);
      if (action === "decline") await api.declineOnboardingAssignment(assignment.id);
      if (action === "cancel") await api.cancelOnboardingAssignment(assignment.id);
      toast({ title: action === "accept" ? "Checklist accepted" : action === "decline" ? "Request declined" : "Request cancelled", variant: action === "decline" || action === "cancel" ? "warning" : "success" });
      onChange();
    } catch (error) {
      if (!isStaleSession(error)) toast({ title: "Action failed", description: getApiError(error), variant: "destructive" });
    } finally { setBusy(false); }
  }
  const done = assignment.checklist.filter((item) => item.status === "RECEIVED" || item.status === "SUBMITTED").length;
  return (
    <Card className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{assignment.pack.key} · v{assignment.pack.version}</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">{owner ? assignment.requester.organizationName : assignment.business.legalName}</h2>
          <p className="mt-1 text-sm text-slate-600">{owner ? `${assignment.requester.role} requester · ${effectiveAssurance(assignment.requester.identity).level}` : `GSTIN ${assignment.business.gstin}`}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{statusLabel(assignment.status)}</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {assignment.checklist.map((item) => {
          const satisfied = item.status === "RECEIVED" || item.status === "SUBMITTED";
          return <div key={item.key} className="rounded-md border border-slate-200 p-3" aria-label={`${item.label}: ${item.status}`}>
            <div className="flex items-start gap-2"><span className={cn("mt-0.5", satisfied ? "text-emerald-600" : "text-amber-600")} aria-hidden>{satisfied ? <CheckCircle2 className="h-4 w-4" /> : <ClipboardList className="h-4 w-4" />}</span><div><p className="text-sm font-medium text-slate-900">{item.label}{!item.required && <span className="ml-1 text-xs font-normal text-slate-500">Optional</span>}</p><p className="mt-1 text-xs text-slate-500">{owner ? item.status.replace(/_/g, " ") : satisfied ? "Received" : "Outstanding"}</p></div></div>
          </div>;
        })}
      </div>
      <p className="mt-4 text-sm text-slate-600">{done} of {assignment.checklist.length} checklist items received. This workflow never grants Trust Profile access.</p>
      {owner && <p className="mt-2 text-sm text-slate-600">Requester assurance: <strong>{effectiveAssurance(assignment.requester.identity).level}</strong>. Review access separately through Consent & Access.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {owner && assignment.status === "REQUESTED" && <><Button onClick={() => void act("accept")} disabled={busy}><CheckCircle2 className="h-4 w-4" />Accept</Button><Button variant="outline" onClick={() => void act("decline")} disabled={busy}><XCircle className="h-4 w-4" />Decline</Button></>}
        {!owner && ["REQUESTED", "ACCEPTED"].includes(assignment.status) && <Button variant="outline" onClick={() => void act("cancel")} disabled={busy}><XCircle className="h-4 w-4" />Cancel request</Button>}
        {owner && <Button asChild variant="outline"><Link to="/msme/evidence-vault"><FileUp className="h-4 w-4" />Open evidence vault<ArrowRight className="h-4 w-4" /></Link></Button>}
      </div>
    </Card>
  );
}

export function OnboardingPacksPage({ role }: { role: Role }) {
  const owner = role === "msme";
  const { toast } = useToast();
  const [packs, setPacks] = useState<OnboardingPack[]>([]);
  const [assignments, setAssignments] = useState<OnboardingAssignment[]>([]);
  const [gstin, setGstin] = useState("");
  const [purpose, setPurpose] = useState("Vendor onboarding");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const session = captureSession();
    try {
      const result = owner ? await session.run(api.getIncomingOnboardingAssignments()) : await session.run(api.getOutgoingOnboardingAssignments());
      setAssignments(result);
      if (!owner) setPacks(await session.run(api.getOnboardingPacks()));
    } catch (error) { if (!isStaleSession(error)) toast({ title: "Onboarding workspace unavailable", description: getApiError(error), variant: "destructive" }); }
    finally { setLoading(false); }
  }, [owner, toast]);

  useEffect(() => { void load(); }, [load]);

  async function send() {
    const pack = packs[0];
    if (!pack || !gstin.trim()) return;
    setSending(true);
    try { await api.createOnboardingAssignment({ businessGstin: gstin, packKey: pack.key, packVersion: pack.version, purpose }); setGstin(""); toast({ title: "Checklist sent", description: "The MSME will decide whether to accept it.", variant: "success" }); await load(); }
    catch (error) { if (!isStaleSession(error)) toast({ title: "Could not send checklist", description: getApiError(error), variant: "destructive" }); }
    finally { setSending(false); }
  }

  return <div className="space-y-6">
    <PageHeader eyebrow={owner ? "Collection" : role === "bank" ? "Lender workspace" : "Buyer workspace"} title="Onboarding packs" description={owner ? "Review institution checklists and decide what your business is ready to collect. Nothing is shared automatically." : "Request a defined document checklist from an MSME. Consent remains separate."} />
    {!owner && packs[0] && <Card className="p-5"><div className="flex items-start gap-3"><div className="rounded-lg bg-primary-50 p-2 text-primary"><ClipboardList className="h-5 w-5" /></div><div><h2 className="font-semibold text-slate-900">{packs[0].name} · v{packs[0].version}</h2><p className="mt-1 text-sm text-slate-600">{packs[0].description}</p><p className="mt-2 text-xs text-slate-500">Required: GST certificate and Udyam certificate · Optional: bank statement</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><div><Label htmlFor="onboarding-gstin">MSME GSTIN</Label><Input id="onboarding-gstin" value={gstin} onChange={(event) => setGstin(event.target.value.toUpperCase())} placeholder="33ABCDE1234F1Z5" className="mt-1 font-mono uppercase" /></div><div><Label htmlFor="onboarding-purpose">Purpose</Label><Input id="onboarding-purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} className="mt-1" /></div><Button onClick={() => void send()} disabled={sending || !gstin.trim()}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}Send pack</Button></div></Card>}
    {loading && assignments.length === 0 ? <div role="status" className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600">Loading onboarding requests…</div> : assignments.length === 0 ? <EmptyState icon={ClipboardList} title="No onboarding requests" description={owner ? "Requests from buyers and banks will appear here." : "Requests you send will appear here with their checklist progress."} /> : <div className="space-y-4">{assignments.map((assignment) => <AssignmentCard key={assignment.id} assignment={assignment} owner={owner} onChange={() => void load()} />)}</div>}
  </div>;
}
