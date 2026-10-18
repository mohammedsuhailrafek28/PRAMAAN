import { StatusPill } from "@/components/shared/StatusPill";
import { describeAssurance, effectiveAssurance, organizationNames, type RequesterIdentity } from "@/lib/requesterIdentity";
import { cn, formatDate } from "@/lib/utils";

/**
 * How well Pramaan knows a requester, as text + icon + colour (never colour alone).
 * The wording is deliberately plain: no "trusted", "certified" or "approved".
 */
export function RequesterIdentityBadge({ identity, className }: { identity: RequesterIdentity; className?: string }) {
  const descriptor = describeAssurance(identity);
  return <StatusPill label={descriptor.label} tone={descriptor.tone} icon={descriptor.icon} description={descriptor.summary} className={cn("whitespace-normal text-left", className)} />;
}

/** The organization name, with a claimed name always labelled as claimed. */
export function RequesterOrganization({ identity, fallbackName, className, heading = false }: { identity: RequesterIdentity; fallbackName: string; className?: string; heading?: boolean }) {
  const names = organizationNames(identity, fallbackName);
  const Name = heading ? "h3" : "p";
  return (
    <div className={cn("min-w-0", className)}>
      <Name className="break-words text-[15px] font-semibold text-slate-900">{names.primary}</Name>
      <p className="text-xs text-slate-500">
        {names.primaryIsReviewed ? "Organization name as reviewed by Pramaan" : "Name typed by the requester, not checked"}
      </p>
      {names.claimed && (
        <p className="text-xs text-warning-foreground">Account was registered as “{names.claimed}”, which differs from the reviewed name.</p>
      )}
    </div>
  );
}

/** Full explanation: what the status means, what it proves and what it does not. Dates and basis only when supplied. */
export function RequesterIdentityDetails({ identity, fallbackName, className }: { identity: RequesterIdentity; fallbackName: string; className?: string }) {
  const descriptor = describeAssurance(identity);
  const { level, lapsed } = effectiveAssurance(identity);
  const names = organizationNames(identity, fallbackName);
  const facts: [string, string][] = [];
  if (identity.reviewedAt) facts.push(["Reviewed on", formatDate(identity.reviewedAt)]);
  if (identity.expiresAt) facts.push([lapsed ? "Expired on" : "Expires on", formatDate(identity.expiresAt)]);
  if (identity.basis) facts.push(["Basis", identity.basis]);
  if (names.previouslyReviewed) facts.push(["Previously reviewed as", names.previouslyReviewed]);

  return (
    <section aria-label="Requester identity" data-assurance={level} className={cn("rounded-lg border p-3 text-sm", level === "SUSPENDED" ? "border-negative-border bg-negative-bg" : level === "UNVERIFIED" ? "border-warning-border bg-warning-bg" : "border-border bg-slate-50", className)}>
      <div className="flex flex-wrap items-center gap-2"><RequesterIdentityBadge identity={identity} /></div>
      <p className="mt-2 text-slate-800">{descriptor.summary}</p>
      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        <div><dt className="text-xs text-slate-500">{names.primaryIsReviewed ? "Reviewed organization" : "Organization name typed by requester"}</dt><dd className="font-medium text-slate-900">{names.primary}</dd></div>
        {names.claimed && <div><dt className="text-xs text-slate-500">Registered as (claimed)</dt><dd className="font-medium text-slate-900">{names.claimed}</dd></div>}
        {facts.map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="font-medium text-slate-900">{value}</dd></div>)}
      </dl>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div><p className="text-xs font-semibold text-slate-700">What this shows</p><ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-700">{descriptor.proves.map((line) => <li key={line}>{line}</li>)}</ul></div>
        <div><p className="text-xs font-semibold text-slate-700">What this does not show</p><ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-700">{descriptor.doesNotProve.map((line) => <li key={line}>{line}</li>)}</ul></div>
      </div>
    </section>
  );
}
