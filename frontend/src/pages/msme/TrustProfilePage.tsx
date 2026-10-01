import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BadgeCheck, Inbox } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TrustProfileCard } from "@/components/shared/TrustProfileCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { useAppStore } from "@/store/appStore";
import { getApiError } from "@/services/api";
import { useToast } from "@/components/ui/use-toast";

export function TrustProfilePage() {
  const navigate = useNavigate();
  const { business, trustProfile, loadBusiness, generateTrustProfile, error } = useAppStore();
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    loadBusiness();
  }, [loadBusiness]);

  const isCrossChecked = business?.trustStatus === "CROSS_CHECKED";

  async function handleGenerate() {
    setGenerating(true);
    try { await generateTrustProfile(); }
    catch (error) { toast({ title: "Passport generation failed", description: getApiError(error), variant: "destructive" }); }
    finally { setGenerating(false); }
  }

  if (error && !business) return <EmptyState icon={BadgeCheck} title="Could not load your Verification Profile" description={error} action={<Button onClick={() => loadBusiness()}>Try again</Button>} />;
  if (!business) return <EmptyState icon={BadgeCheck} title="Loading your Verification Profile" description="Reading the latest business and passport state." />;

  if (!isCrossChecked) {
    return (
      <EmptyState
        icon={BadgeCheck}
        title="Complete the internal cross-check first"
        description="Your Business Trust Passport is generated from claims and evidence assessed by Pramaan's deterministic internal checks."
        action={<Button onClick={() => navigate("/msme/verification")}>Go to Business Verification</Button>}
      />
    );
  }

  if (!trustProfile) {
    return (
      <EmptyState
        icon={BadgeCheck}
        title="Your business is cross-checked — Trust Passport ready"
        description="Generate your Verification Profile to start sharing selected evidence with buyers and banks under your control."
        action={
          <Button onClick={handleGenerate} disabled={generating}>
            {generating ? "Generating..." : "Generate Verification Profile"}
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
            <h2 className="text-xl font-semibold text-slate-900">Verification Profile</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your portable, reusable trust record — share only what's needed, with consent.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleGenerate} disabled={generating}>
            {generating ? "Regenerating…" : "Regenerate Passport"}
          </Button>
          <Button onClick={() => navigate("/msme/consent-requests")}>
            <Inbox className="h-4 w-4" />
            View Consent Requests
          </Button>
        </div>
      </div>

      <TrustProfileCard business={business} trustProfile={trustProfile} />

    </div>
  );
}
