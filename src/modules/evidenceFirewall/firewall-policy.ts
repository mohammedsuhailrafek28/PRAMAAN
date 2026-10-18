import type { FirewallPolicy } from "./firewall.types.js";

/**
 * Mirrors trustEngine/confidence-calculator.ts `fieldDocumentMap` (claims that a document can support) and
 * trustEngine/contradiction-detector.ts (the contradictions the engine can record). The tests pin both to the
 * engine's own output, so a drift fails the tests instead of silently weakening the firewall.
 */
export const DEFAULT_FIREWALL_POLICY: FirewallPolicy = {
  fieldEvidence: {
    gstin: ["GST_CERTIFICATE"],
    udyamNumber: ["UDYAM_CERTIFICATE"]
  },
  contradictionInvolves: {
    pan: [{ kind: "FIELD", key: "gstin" }, { kind: "UNDISCLOSABLE", key: "pan" }],
    businessName: [{ kind: "FIELD", key: "legalBusinessName" }, { kind: "UNDISCLOSABLE", key: "accountOrganizationName" }]
  }
};

export const FIREWALL_LIMITATION = "No external source was consulted. A supported conclusion means internally cross-checked, document-submitted evidence, not source verification.";
