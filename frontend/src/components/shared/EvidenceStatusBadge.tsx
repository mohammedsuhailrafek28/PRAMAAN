import { StatusPill } from "@/components/shared/StatusPill";
import { describeEvidenceStatus, describeLifecycle } from "@/lib/trustVocabulary";

/** Evidence/claim check status in Pramaan's honest vocabulary (missing when absent). */
export function EvidenceStatusBadge({ status }: { status?: string | null }) {
  const { label, tone, description } = describeEvidenceStatus(status);
  return <StatusPill label={label} tone={tone} description={description} />;
}

/** Freshness/lifecycle of a stored evidence version. */
export function LifecycleBadge({ state }: { state?: string | null }) {
  const { label, tone, description } = describeLifecycle(state);
  return <StatusPill label={label} tone={tone} description={description} />;
}
