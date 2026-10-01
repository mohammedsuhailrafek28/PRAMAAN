import { StakeholderDashboard } from "@/pages/shared/StakeholderDashboard";
import type { ConsentField } from "@/types";

const BANK_DEFAULT_FIELDS: ConsentField[] = [
  "legalName",
  "gstin",
  "udyamNumber",
  "turnoverBand",
  "bankVerificationStatus",
  "complianceStatus",
];

export function BankDashboard() {
  return (
    <StakeholderDashboard
      role="bank"
      defaultFields={BANK_DEFAULT_FIELDS}
      helperText="Search by the MSME's GSTIN to request a verification workspace."
    />
  );
}
