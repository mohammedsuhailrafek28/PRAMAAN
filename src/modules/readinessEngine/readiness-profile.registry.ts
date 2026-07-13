import { DocumentType, EvidenceStatus } from "@prisma/client";
import { ApiError } from "../../utils/apiError.js";
import type { ReadinessProfileDefinition, SupportedBusinessField } from "./readiness-engine.types.js";
import { evidenceStatusRank } from "./readiness-profile.defaults.js";
import { vendorOnboardingProfile } from "./profiles/vendor-onboarding.profile.js";
import { loanApplicationPreparationProfile } from "./profiles/loan-application-preparation.profile.js";
import { governmentProcurementProfile } from "./profiles/government-procurement.profile.js";
import { governmentSchemeApplicationProfile } from "./profiles/government-scheme-application.profile.js";

const supportedFields: SupportedBusinessField[] = [
  "legalBusinessName",
  "ownerName",
  "gstin",
  "pan",
  "udyamNumber",
  "address",
  "turnoverBand",
  "bankAccount",
  "businessType"
];

const profiles = [
  vendorOnboardingProfile,
  loanApplicationPreparationProfile,
  governmentProcurementProfile,
  governmentSchemeApplicationProfile
];

export function validateReadinessProfile(definition: ReadinessProfileDefinition) {
  if (!definition.id || !definition.version || !definition.name) {
    throw new Error("Readiness profile id, version, and name are required.");
  }
  const requirementIds = new Set<string>();
  let totalWeight = 0;
  for (const requirement of definition.requirements) {
    if (requirementIds.has(requirement.id)) {
      throw new Error(`Duplicate requirement id ${requirement.id} in profile ${definition.id}.`);
    }
    requirementIds.add(requirement.id);
    if (requirement.weight <= 0) throw new Error(`Requirement ${requirement.id} must have positive weight.`);
    totalWeight += requirement.weight;
    if (requirement.minimumConfidence !== undefined && (requirement.minimumConfidence < 0 || requirement.minimumConfidence > 100)) {
      throw new Error(`Requirement ${requirement.id} has invalid minimum confidence.`);
    }
    if (requirement.minimumMetric && (requirement.minimumMetric.value < 0 || requirement.minimumMetric.value > 100)) {
      throw new Error(`Requirement ${requirement.id} has invalid metric threshold.`);
    }
    if (requirement.field && !supportedFields.includes(requirement.field)) {
      throw new Error(`Requirement ${requirement.id} uses unsupported field ${requirement.field}.`);
    }
    for (const documentType of requirement.acceptedDocumentTypes ?? []) {
      if (!Object.values(DocumentType).includes(documentType)) {
        throw new Error(`Requirement ${requirement.id} uses unsupported document type ${documentType}.`);
      }
    }
    if (requirement.minimumEvidenceStatus && evidenceStatusRank[requirement.minimumEvidenceStatus] === undefined) {
      throw new Error(`Requirement ${requirement.id} uses invalid evidence status ${requirement.minimumEvidenceStatus}.`);
    }
    if (requirement.minimumEvidenceStatus === EvidenceStatus.SOURCE_VERIFIED) {
      throw new Error(`Profile ${definition.id} cannot require SOURCE_VERIFIED during this phase.`);
    }
  }
  if (totalWeight <= 0) throw new Error(`Profile ${definition.id} has zero applicable requirement weight.`);
  return definition;
}

function validateRegistry(definitions: ReadinessProfileDefinition[]) {
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`Duplicate readiness profile id ${definition.id}.`);
    ids.add(definition.id);
    validateReadinessProfile(definition);
  }
  return definitions;
}

export const readinessProfiles = validateRegistry(profiles);

export function listReadinessProfiles() {
  return readinessProfiles.map(({ id, version, name, purpose, description, disclaimer }) => ({
    id,
    version,
    name,
    purpose,
    description,
    disclaimer
  }));
}

export function getReadinessProfile(profileId: string) {
  const definition = readinessProfiles.find((profile) => profile.id === profileId);
  if (!definition) throw new ApiError(404, "READINESS_PROFILE_NOT_FOUND", "Readiness profile not found.");
  return definition;
}
