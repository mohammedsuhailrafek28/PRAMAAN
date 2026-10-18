import { useMemo, useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/shared/SectionCard";
import { DisclosureSelector } from "@/components/shared/DisclosureSelector";
import { EVIDENCE_KEYS, scopeSize, type DisclosureScope, type EvidenceKey } from "@/lib/disclosure";
import { createAccessGrant, getApiError } from "@/services/api";
import { captureSession } from "@/services/sessionEpoch";
import { formatDateTime } from "@/lib/utils";
import type { AccessGrant, Business, TrustProfile } from "@/types";

const PURPOSES = ["Business verification", "Loan application", "Vendor onboarding", "Procurement", "Other"];
const SELECT_CLASS = "flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Create a time-limited link for someone without a Pramaan account. Same vocabulary as consent. */
export function SecureLinkForm({ business, trustProfile, onCreated }: { business: Business | null; trustProfile: TrustProfile | null; onCreated: (grant: AccessGrant) => void }) {
  const [scope, setScope] = useState<DisclosureScope>({ fields: ["legalBusinessName", "gstin"], evidence: [] });
  const [recipientName, setRecipientName] = useState("");
  const [recipientOrganization, setRecipientOrganization] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [duration, setDuration] = useState("168");
  const [created, setCreated] = useState<AccessGrant | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guest links share evidence as of the pinned version; a type with no document on file can't be shared.
  const missingEvidence = useMemo(() => {
    const onFile = new Set((business?.documents ?? []).map((doc) => doc.type.toUpperCase()));
    return Object.fromEntries(EVIDENCE_KEYS.filter((key) => !onFile.has(key)).map((key) => [key, "No document on file"])) as Partial<Record<EvidenceKey, string>>;
  }, [business]);

  async function create() {
    if (scopeSize(scope) === 0) { setError("Select at least one item to share."); return; }
    setBusy(true); setError(null); setCopied(false);
    const session = captureSession();
    try {
      const grant = await session.run(createAccessGrant({ recipientName: recipientName || undefined, recipientOrganization: recipientOrganization || undefined, recipientEmail: recipientEmail || undefined, purpose, scope, durationHours: Number(duration) }));
      setCreated(grant);
      onCreated(grant);
    } catch (e) { if (session.isCurrent()) setError(getApiError(e)); } finally { setBusy(false); }
  }

  async function copy() {
    if (!created?.secureUrl) return;
    try { await navigator.clipboard.writeText(created.secureUrl); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <SectionCard title="Create a secure link" description={<>For someone without a Pramaan account. The link shares {trustProfile ? `Trust Profile v${trustProfile.version}` : "your current Trust Profile"} as it is now, expires automatically, and can be revoked at any time.</>}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><Label htmlFor="g-name">Recipient name</Label><Input id="g-name" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Optional" /></div>
          <div className="space-y-1.5"><Label htmlFor="g-org">Organization</Label><Input id="g-org" value={recipientOrganization} onChange={(e) => setRecipientOrganization(e.target.value)} placeholder="Optional" /></div>
          <div className="space-y-1.5"><Label htmlFor="g-email">Email</Label><Input id="g-email" type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="Optional" /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="g-purpose">Purpose</Label><select id="g-purpose" className={SELECT_CLASS} value={purpose} onChange={(e) => setPurpose(e.target.value)}>{PURPOSES.map((item) => <option key={item}>{item}</option>)}</select></div>
          <div className="space-y-1.5"><Label htmlFor="g-duration">Access period</Label><select id="g-duration" className={SELECT_CLASS} value={duration} onChange={(e) => setDuration(e.target.value)}><option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option></select></div>
        </div>
        <div>
          <div className="mb-2 flex items-baseline justify-between"><Label>What to share</Label><span className="text-xs font-medium text-slate-600">{scopeSize(scope)} selected</span></div>
          <DisclosureSelector idPrefix="guest" value={scope} onChange={setScope} disabledEvidence={missingEvidence} />
        </div>
        {error && <p role="alert" className="rounded-md bg-negative-bg px-3 py-2 text-sm text-negative-foreground">{error}</p>}
        <Button onClick={() => void create()} disabled={busy || scopeSize(scope) === 0 || !trustProfile}><Link2 className="h-4 w-4" />{busy ? "Creating…" : "Create secure link"}</Button>
        {!trustProfile && <p className="text-xs text-slate-500">Generate your Trust Profile first; links share a fixed version of it.</p>}

        {created?.secureUrl && (
          <div className="rounded-lg border border-positive-border bg-positive-bg p-4" role="status">
            <p className="flex items-center gap-2 text-sm font-semibold text-positive-foreground"><Check className="h-4 w-4" aria-hidden />Secure link created</p>
            <p className="mt-2 break-all rounded-md bg-white px-3 py-2 font-mono text-xs text-slate-700" data-testid="secure-url">{created.secureUrl}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <span>Expires {formatDateTime(created.expiresAt)}. Anyone with this link can open it until then.</span>
              <Button size="sm" variant="outline" onClick={() => void copy()}><Copy className="h-3.5 w-3.5" />{copied ? "Copied" : "Copy link"}</Button>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
