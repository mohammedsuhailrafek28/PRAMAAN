import { useEffect } from "react";

import { SectionCard } from "@/components/shared/SectionCard";
import { AuditTimeline } from "@/components/shared/AuditTimeline";
import { useAppStore } from "@/store/appStore";

export function AuditLogPage() {
  const { auditLogs, loadAuditLogs } = useAppStore();

  useEffect(() => {
    loadAuditLogs();
  }, [loadAuditLogs]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Activity</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A timestamped record of evidence changes, cross-checks, and every access request, approval, view, expiry, and revocation on your business.
        </p>
      </div>

      <SectionCard title="Full history">
        <AuditTimeline logs={auditLogs} />
      </SectionCard>
    </div>
  );
}
