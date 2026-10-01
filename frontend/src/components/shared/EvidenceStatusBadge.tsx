import { StatusPill } from "@/components/shared/StatusPill";
import { describeConsent, describeEvidenceStatus, describeLifecycle, describeLink, type StatusDescriptor } from "@/lib/trustVocabulary";
import type { ConsentStatus } from "@/types";

function Descriptor({ d }: { d: StatusDescriptor }) {
  return <StatusPill label={d.label} tone={d.tone} description={d.description} icon={d.icon} />;
}

/** Claim/evidence check status in Pramaan's honest vocabulary ("Missing" when absent). */
export function EvidenceStatusBadge({ status }: { status?: string | null }) {
  return <Descriptor d={describeEvidenceStatus(status)} />;
}

/** Freshness/lifecycle of a stored evidence version. */
export function LifecycleBadge({ state }: { state?: string | null }) {
  return <Descriptor d={describeLifecycle(state)} />;
}

/** Registered-verifier consent state. */
export function ConsentStatusBadge({ status }: { status: ConsentStatus }) {
  return <Descriptor d={describeConsent(status)} />;
}

/** Secure (guest) link state. */
export function LinkStatusBadge({ status }: { status: "ACTIVE" | "EXPIRED" | "REVOKED" }) {
  return <Descriptor d={describeLink(status)} />;
}

/** Any precomputed descriptor (e.g. field freshness). */
export function DescriptorBadge({ descriptor }: { descriptor: StatusDescriptor }) {
  return <Descriptor d={descriptor} />;
}
