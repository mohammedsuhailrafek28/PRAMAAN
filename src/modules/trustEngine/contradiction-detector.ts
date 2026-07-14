import type { Business, User } from "@prisma/client";
import type { Contradiction } from "./trust-engine.types.js";
import { normalizeIdentityValue, panFromGstin } from "./rules/identity.rules.js";

export function detectContradictions(business: Business & { user?: User | null }): Contradiction[] {
  const contradictions: Contradiction[] = [];

  const panFromBusiness = normalizeIdentityValue(business.pan);
  const panEmbeddedInGstin = panFromGstin(business.gstin);
  if (panFromBusiness && panEmbeddedInGstin && panFromBusiness !== panEmbeddedInGstin) {
    contradictions.push({
      field: "pan",
      claimedValue: business.pan,
      evidenceValues: [panEmbeddedInGstin],
      severity: "HIGH",
      reason: "The PAN claim does not match the PAN segment embedded in the submitted GSTIN."
    });
  }

  const legalName = normalizeIdentityValue(business.legalName);
  const organizationName = normalizeIdentityValue(business.user?.organizationName);
  if (legalName && organizationName && legalName !== organizationName) {
    contradictions.push({
      field: "businessName",
      claimedValue: business.legalName,
      evidenceValues: [business.user?.organizationName ?? ""],
      severity: "MEDIUM",
      reason: "The legal business name differs from the organization name stored on the user account."
    });
  }

  return contradictions;
}
