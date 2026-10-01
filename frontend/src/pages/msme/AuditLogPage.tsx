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
        <h2 className="text-xl font-semibold text-slate-900">Audit Log</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A complete, timestamped record of every verification and consent event on your account.
        </p>
      </div>

      <SectionCard title="Full history">
        <AuditTimeline logs={auditLogs} />
      </SectionCard>
    </div>
  );
}
