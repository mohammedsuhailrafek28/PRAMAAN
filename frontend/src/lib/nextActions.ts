// Action Center: what the MSME should do next, derived only from backend state.
// Each action names a concrete destination; nothing here is decorative.

import type { EvidenceSlot } from "@/lib/evidenceSlots";
import { isTrustProfileOutdated } from "@/lib/evidenceSlots";
import { ROUTES } from "@/components/layout/navigation";
import { formatDate, possessive } from "@/lib/utils";
import { scopeLabelPhrase } from "@/lib/disclosure";
import { identityNote } from "@/lib/requesterIdentity";
import type { Business, ConsentRequest, TrustProfile } from "@/types";

export type ActionTone = "negative" | "warning" | "info";

export interface NextAction {
  id: string;
  tone: ActionTone;
  title: string;
  description: string;
  cta: string;
  to: string;
}

export function deriveNextActions(input: {
  business: Business | null;
  trustProfile: TrustProfile | null;
  slots: EvidenceSlot[];
  pendingRequests: ConsentRequest[];
}): NextAction[] {
  const { business, trustProfile, slots, pendingRequests } = input;
  if (!business) return [];
  const actions: NextAction[] = [];

  const conflictSlots = slots.filter((slot) => slot.state === "CONFLICT");
  if (business.trustStatus === "REJECTED" || conflictSlots.length > 0) {
    actions.push({
      id: "conflict",
      tone: "negative",
      title: "Resolve conflicting information",
      description: conflictSlots.length
        ? `Internal checks found a contradiction involving your ${conflictSlots.map((slot) => slot.label).join(" and ")}.`
        : "Internal checks found a contradiction between your claims and evidence.",
      cta: "Review conflicts",
      to: ROUTES.businessProfile,
    });
  }

  for (const request of pendingRequests) {
    actions.push({
      id: `request-${request.id}`,
      tone: "info",
      title: `Review ${possessive(request.requesterName)} request`,
      description: `${request.purpose || "Verification"} · asks for ${scopeLabelPhrase(request.requested)}${identityNote(request.requesterIdentity) ? ` (requester ${identityNote(request.requesterIdentity)})` : ""}. Nothing is shared until you decide.`,
      cta: "Review request",
      to: ROUTES.consent,
    });
  }

  for (const slot of slots.filter((s) => s.state === "EXPIRED")) {
    actions.push({
      id: `stale-${slot.type}`,
      tone: "warning",
      title: `Replace stale ${slot.label.toLowerCase()}`,
      description: `Expired ${formatDate(slot.current?.expiresAt)}. Verifiers see it marked as stale.`,
      cta: "Replace",
      to: `${ROUTES.evidence}?upload=${slot.type}`,
    });
  }

  for (const slot of slots.filter((s) => s.state === "MISSING")) {
    actions.push({
      id: `missing-${slot.type}`,
      tone: "negative",
      title: `Upload your ${slot.label.toLowerCase()}`,
      description: slot.purpose,
      cta: "Upload",
      to: `${ROUTES.evidence}?upload=${slot.type}`,
    });
  }

  if (!business.lastCrossCheckedAt || business.trustStatus === "SELF_DECLARED") {
    actions.push({
      id: "cross-check",
      tone: "info",
      title: business.lastCrossCheckedAt ? "Re-run the internal cross-check" : "Run your first internal cross-check",
      description: business.lastCrossCheckedAt
        ? "Your business details changed since the last check."
        : "Pramaan checks your claims against the evidence you submitted.",
      cta: "Run cross-check",
      to: ROUTES.businessProfile,
    });
  } else if (!trustProfile) {
    actions.push({
      id: "generate-profile",
      tone: "info",
      title: "Generate your Trust Profile",
      description: "A versioned record of what Pramaan has checked. Verifiers can only be given access once it exists.",
      cta: "Generate",
      to: ROUTES.trustProfile,
    });
  } else if (isTrustProfileOutdated(business, trustProfile)) {
    actions.push({
      id: "update-profile",
      tone: "info",
      title: `Generate an updated Trust Profile`,
      description: `Your evidence or details changed after version ${trustProfile.version}. New approvals will use the newest version.`,
      cta: "Update",
      to: ROUTES.trustProfile,
    });
  }

  for (const slot of slots.filter((s) => s.state === "EXPIRING_SOON")) {
    actions.push({
      id: `expiring-${slot.type}`,
      tone: "warning",
      title: `Renew your ${slot.label.toLowerCase()} soon`,
      description: `Expires ${formatDate(slot.current?.expiresAt)}.`,
      cta: "Upload renewal",
      to: `${ROUTES.evidence}?upload=${slot.type}`,
    });
  }

  return actions;
}
