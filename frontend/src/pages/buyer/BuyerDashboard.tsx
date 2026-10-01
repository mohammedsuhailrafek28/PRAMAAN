import { StakeholderDashboard } from "@/pages/shared/StakeholderDashboard";
import type { ConsentField } from "@/types";

const BUYER_DEFAULT_FIELDS: ConsentField[] = ["legalName", "gstin", "udyamNumber", "address", "complianceStatus"];

export function BuyerDashboard() {
  return (
    <StakeholderDashboard
      role="buyer"
      defaultFields={BUYER_DEFAULT_FIELDS}
      helperText="Search by the MSME's GSTIN to request a vendor onboarding verification."
    />
  );
}
