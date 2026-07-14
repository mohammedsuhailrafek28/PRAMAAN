import { calculateAndPersistBusinessTrustProfile } from "../trustEngine/trust-engine.service.js";

export async function runInternalVerificationAlias(businessId: string) {
  const result = await calculateAndPersistBusinessTrustProfile(businessId);
  return {
    trustStatus: result.trustStatus,
    profile: result.profile,
    metadata: {
      mode: "INTERNAL_CROSS_CHECK",
      sourceVerificationPerformed: false,
      message: "This compatibility helper performs internal cross-checks only. It does not produce source verification."
    }
  };
}
