import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { AuditTimeline } from "@/components/shared/AuditTimeline";
import { LoadingState } from "@/components/shared/AsyncState";
import { useAppStore } from "@/store/appStore";
import { AUDIT_CATEGORIES, auditCategory, type AuditCategory } from "@/lib/auditEvents";
import { cn } from "@/lib/utils";

export function AuditLogPage() {
  const { auditLogs, loadAuditLogs } = useAppStore();
  const [loaded, setLoaded] = useState(false);
  const [category, setCategory] = useState<AuditCategory | "all">("all");

  useEffect(() => { void loadAuditLogs().then(() => setLoaded(true)); }, [loadAuditLogs]);

  const filtered = useMemo(() => (category === "all" ? auditLogs : auditLogs.filter((log) => auditCategory(log) === category)), [auditLogs, category]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sharing"
        title="Activity"
        description="A permanent, timestamped record of evidence changes, checks, and every access request, approval, view, expiry and revocation on your business."
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter activity">
        {AUDIT_CATEGORIES.map((item) => (
          <Button key={item.value} size="sm" variant={category === item.value ? "default" : "outline"} aria-pressed={category === item.value} onClick={() => setCategory(item.value)} className={cn(category !== item.value && "text-slate-700")}>
            {item.label}
          </Button>
        ))}
      </div>
      {!loaded && auditLogs.length === 0 ? (
        <LoadingState label="Loading activity" />
      ) : (
        <SectionCard title={category === "all" ? "Full history" : AUDIT_CATEGORIES.find((c) => c.value === category)!.label} description={`${filtered.length} event${filtered.length === 1 ? "" : "s"}`}>
          <AuditTimeline logs={filtered} />
        </SectionCard>
      )}
    </div>
  );
}
