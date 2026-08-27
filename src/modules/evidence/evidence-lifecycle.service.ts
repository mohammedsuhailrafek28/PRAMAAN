import type { Document } from "@prisma/client";

export const EXPIRING_SOON_DAYS = 30;

export type EvidenceLifecycleState = "CURRENT" | "EXPIRING_SOON" | "EXPIRED" | "CONFLICT" | "NEEDS_ATTENTION";

function hasFailedCheck(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasFailedCheck);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.result === "FAILED" || record.severity === "HIGH" || record.severity === "CRITICAL") return true;
  return Object.values(record).some(hasFailedCheck);
}

export function deriveEvidenceLifecycle(document: Pick<Document, "expiresAt" | "isCurrent" | "evidenceStatus" | "contradictionDetails">, now = new Date()) {
  const conflict = hasFailedCheck(document.contradictionDetails);
  const expired = Boolean(document.expiresAt && document.expiresAt.getTime() < now.getTime());
  const expiringSoon = Boolean(
    document.expiresAt && !expired && document.expiresAt.getTime() - now.getTime() <= EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000
  );
  const state: EvidenceLifecycleState = !document.isCurrent || document.evidenceStatus === "REJECTED"
    ? "NEEDS_ATTENTION"
    : expired
        ? "EXPIRED"
        : expiringSoon
          ? "EXPIRING_SOON"
          : conflict
            ? "CONFLICT"
            : "CURRENT";
  return { state, freshnessState: expired ? "EXPIRED" : expiringSoon ? "EXPIRING_SOON" : "CURRENT", conflict, needsAttention: state !== "CURRENT" } as const;
}

export function parseLifecycleDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must use YYYY-MM-DD format.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid date.`);
  return date;
}
