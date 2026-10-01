import axios from "axios";
import type {
  AuditAction, AuditLogEntry, Business, ConsentDurationHours, ConsentField,
  ConsentRequest, Notification, Role, TrustProfile, TrustViewResult, User,
  EvidenceStatus, TrustSummary,
  AccessGrant, GuestVerificationView, ShareableField, ShareableEvidenceType,
} from "@/types";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000/api").replace(/\/$/, "");
const client = axios.create({ baseURL: API_URL, timeout: 15000 });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("pramaan_access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use((response) => response, (error) => {
  if (error.response?.status === 401) localStorage.removeItem("pramaan_access_token");
  return Promise.reject(error);
});

export function getApiError(error: unknown): string {
  if (axios.isAxiosError(error)) return error.response?.data?.error?.message || error.message;
  return error instanceof Error ? error.message : "Something went wrong.";
}

const roleToApi: Record<Role, "MSME" | "BUYER" | "BANK"> = { msme: "MSME", buyer: "BUYER", bank: "BANK" };
const roleFromApi: Record<string, Role> = { MSME: "msme", BUYER: "buyer", BANK: "bank" };
const statusFromApi: Record<string, ConsentRequest["status"]> = {
  PENDING: "pending", APPROVED: "active", REJECTED: "rejected", REVOKED: "revoked", EXPIRED: "expired",
};
const fieldToApi: Record<ConsentField, string> = {
  legalName: "legalBusinessName", gstin: "gstin", udyamNumber: "udyamNumber", address: "address",
  complianceStatus: "summary", turnoverBand: "turnoverBand", bankVerificationStatus: "documentConfidence",
};
const fieldFromApi: Record<string, ConsentField> = {
  legalBusinessName: "legalName", gstin: "gstin", udyamNumber: "udyamNumber", address: "address",
  summary: "complianceStatus", turnoverBand: "turnoverBand", documentConfidence: "bankVerificationStatus",
};

function mapUser(raw: any): User {
  const name = raw.name || "Pramaan user";
  return { id: raw.id, role: roleFromApi[raw.role] || raw.role, name, orgName: raw.organizationName, email: raw.email, avatarInitials: name.split(" ").map((part: string) => part[0]).join("").slice(0, 2).toUpperCase() };
}

function normalizeTurnoverBand(value: unknown): Business["turnoverBand"] {
  const raw = String(value || "");
  if (raw.includes("40 Lakh") || raw.includes("40LAKH")) return "₹40 Lakh – ₹1.5 Cr";
  if (raw.includes("1.5 Cr") || raw.includes("1Cr") || raw.includes("1.5Cr")) return "₹1.5 Cr – ₹5 Cr";
  if (raw.includes("5 Cr") || raw.includes("5Cr")) return "₹5 Cr – ₹25 Cr";
  if (raw.includes("25 Cr") || raw.includes("25Cr")) return "Above ₹25 Cr";
  return "Under ₹40 Lakh";
}

function mapBusiness(raw: any): Business {
  const passportSnapshot = raw.passports?.[0]?.snapshotJson;
  const fieldConfidence = passportSnapshot?.fieldConfidence || [];
  const trustSummary = raw.trustSummary && typeof raw.trustSummary === "object" ? raw.trustSummary as TrustSummary : undefined;
  return Object.assign({
    id: raw.id, ownerId: raw.userId, legalName: raw.legalName || "", gstin: raw.gstin || "", udyamNumber: raw.udyamNumber || "",
    pan: raw.pan || "", address: raw.address || "", turnoverBand: raw.turnoverBand || "Under ₹40 Lakh", inviteCode: "",
    verificationStatus: String(raw.verificationStatus || "UNVERIFIED").toLowerCase() as Business["verificationStatus"],
    trustStatus: String(raw.trustStatus || "SELF_DECLARED") as EvidenceStatus,
    trustSummary,
    sourceVerificationPerformed: false,
    fieldVerification: {
      gstin: fieldConfidence.find((f: any) => f.field === "gstin")?.status === "CROSS_CHECKED",
      udyamNumber: fieldConfidence.find((f: any) => f.field === "udyamNumber")?.status === "CROSS_CHECKED",
      pan: fieldConfidence.find((f: any) => f.field === "pan")?.status === "CROSS_CHECKED",
    },
    documents: (raw.documents || []).map((doc: any) => ({
      type: String(doc.docType).toLowerCase() as Business["documents"][number]["type"],
      label: String(doc.docType).replace(/_/g, " "), uploaded: true,
      verified: doc.evidenceStatus === "CROSS_CHECKED" || doc.evidenceStatus === "SOURCE_VERIFIED",
      fileName: doc.originalName, uploadedAt: doc.uploadedAt, evidenceStatus: doc.evidenceStatus,
      confidence: doc.confidence, confidenceReason: doc.confidenceReason, source: doc.source,
      checkedAt: doc.checkedAt, expiresAt: doc.expiresAt, issuedAt: doc.issuedAt, revision: doc.revision,
      isCurrent: doc.isCurrent, previousVersionId: doc.previousVersionId, lifecycle: doc.lifecycle,
    })),
    verifiedAt: raw.lastCrossCheckedAt,
  }, { turnoverBand: normalizeTurnoverBand(raw.turnoverBand) }) as Business;
}

function mapConsent(raw: any): ConsentRequest {
  const requested = (raw.requestedFields || []).map((field: string) => fieldFromApi[field] || field).filter(Boolean) as ConsentField[];
  const approved = (raw.approvedFields || []).map((field: string) => fieldFromApi[field] || field).filter(Boolean) as ConsentField[];
  const requestedAt = raw.createdAt || raw.requestedAt;
  return {
    id: raw.id, businessId: raw.businessId, businessName: raw.business?.legalName, requesterId: raw.requesterId,
    requesterName: raw.requester?.organizationName || raw.requester?.name || "Stakeholder",
    requesterRole: roleFromApi[raw.requester?.role] as "buyer" | "bank",
    purpose: raw.purpose, requestedFields: requested, approvedFields: approved, durationHours: raw.durationDays ? (raw.durationDays * 24 as ConsentDurationHours) : null,
    status: statusFromApi[raw.status] || "pending", requestedAt, approvedAt: raw.approvedAt, expiresAt: raw.expiresAt, revokedAt: raw.revokedAt,
  };
}

function passportValue(value: any, key: string): string | undefined {
  const unwrapped = value && typeof value === "object" && "value" in value ? value.value : value;
  if (key === "summary" && unwrapped && typeof unwrapped === "object") {
    return `Trust readiness ${unwrapped.trustReadiness}%`;
  }
  if (key === "documentConfidence" && Array.isArray(unwrapped)) {
    const bank = unwrapped.find((item: any) => item.documentType === "BANK_STATEMENT");
    return bank ? `Bank evidence ${bank.status} (${bank.confidence}/45)` : "Bank evidence not submitted";
  }
  if (unwrapped === null || unwrapped === undefined) return undefined;
  return typeof unwrapped === "string" ? unwrapped : JSON.stringify(unwrapped);
}

export async function login(role: Role, email?: string, password?: string): Promise<User> {
  const defaults: Record<Role, [string, string]> = {
    msme: ["msme@pramaan.demo", "password123"], buyer: ["buyer@pramaan.demo", "password123"], bank: ["bank@pramaan.demo", "password123"],
  };
  const [defaultEmail, defaultPassword] = defaults[role];
  const { data } = await client.post("/auth/login", { email: email || defaultEmail, password: password || defaultPassword });
  localStorage.setItem("pramaan_access_token", data.token);
  return mapUser(data.user);
}

export async function register(input: { name: string; orgName: string; email: string; password: string; role: Role }): Promise<User> {
  const { data } = await client.post("/auth/register", { role: roleToApi[input.role], name: input.name, organizationName: input.orgName, email: input.email, password: input.password });
  localStorage.setItem("pramaan_access_token", data.token);
  return mapUser(data.user);
}

export async function getBusiness(): Promise<Business> { const { data } = await client.get("/business/me"); return mapBusiness(data.business); }
export async function lookupBusiness(gstin: string): Promise<{ id: string; legalName: string; gstin: string; address: string; trustStatus: EvidenceStatus }> {
  const { data } = await client.get(`/business/lookup/${encodeURIComponent(gstin.trim().toUpperCase())}`);
  return data.business;
}

export async function generateTrustProfile(): Promise<TrustProfile> {
  const { data } = await client.post("/passport/generate");
  return mapTrustProfile(data.snapshot, data.passportId);
}

function mapTrustProfile(snapshot: any, fallbackId?: string): TrustProfile {
  const summary = (snapshot?.summary || {}) as TrustSummary;
  const bankDocument = (snapshot?.documentConfidence || []).find((item: any) => item.documentType === "BANK_STATEMENT");
  return {
    id: snapshot?.profileId || fallbackId, businessId: snapshot?.businessId, version: snapshot?.version || 1, generatedAt: snapshot?.generatedAt,
    complianceStatus: "Internally cross-checked",
    bankVerificationStatus: bankDocument ? `${bankDocument.status} (${bankDocument.confidence}/45)` : "Not submitted",
    summary,
    sourceVerificationPerformed: false,
  };
}

export async function getTrustProfile(): Promise<TrustProfile | null> { try { const { data } = await client.get("/passport/me"); return mapTrustProfile(data.passport.snapshotJson, data.passport.id); } catch (error) { if (axios.isAxiosError(error) && error.response?.status === 404) return null; throw error; } }

export async function getCurrentUser(): Promise<User> { const { data } = await client.get("/auth/me"); return mapUser(data.user); }

export async function saveBusinessProfile(input: { legalName: string; gstin: string; udyamNumber: string; pan: string; address: string; turnoverBand: Business["turnoverBand"] }): Promise<Business> {
  const { data } = await client.post("/business", input);
  return mapBusiness(data.business);
}

export async function uploadBusinessDocument(docType: Business["documents"][number]["type"], file: File, metadata: { issuedAt?: string; expiresAt?: string; source?: string } = {}): Promise<void> {
  const form = new FormData();
  form.append("docType", docType.toUpperCase());
  form.append("file", file);
  if (metadata.issuedAt) form.append("issuedAt", metadata.issuedAt);
  if (metadata.expiresAt) form.append("expiresAt", metadata.expiresAt);
  if (metadata.source) form.append("source", metadata.source);
  await client.post("/business/documents", form);
}

export async function crossCheckBusiness(): Promise<Business> { await client.post("/business/cross-check"); return getBusiness(); }

export async function createConsentRequest(input: { lookup: string; requesterId: string; requesterName: string; requesterRole: "buyer" | "bank"; requestedFields: ConsentField[]; purpose?: ConsentRequest["purpose"] }): Promise<ConsentRequest> {
  const { data } = await client.post("/consent-requests", { businessGstin: input.lookup, purpose: input.purpose, requestedFields: input.requestedFields.map((field) => fieldToApi[field]) });
  return mapConsent(data.consent);
}
export async function getIncomingRequests(): Promise<ConsentRequest[]> { const { data } = await client.get("/consent-requests", { params: { scope: "incoming" } }); return data.requests.map(mapConsent); }
export async function getOutgoingRequests(_requesterId: string): Promise<ConsentRequest[]> { const { data } = await client.get("/consent-requests", { params: { scope: "outgoing" } }); return data.requests.map(mapConsent); }
export async function approveConsentRequest(id: string, fields: ConsentField[], duration: ConsentDurationHours): Promise<ConsentRequest> { const { data } = await client.patch(`/consent-requests/${id}/approve`, { approvedFields: fields.map((field) => fieldToApi[field]), durationDays: duration / 24 }); return mapConsent(data.consent); }
export async function rejectConsentRequest(id: string): Promise<ConsentRequest> { const { data } = await client.patch(`/consent-requests/${id}/reject`); return mapConsent(data.consent); }
export async function revokeConsentRequest(id: string): Promise<ConsentRequest> { const { data } = await client.patch(`/consent-requests/${id}/revoke`); return mapConsent(data.consent); }

export async function getTrustView(consentId: string): Promise<TrustViewResult> {
  try {
    const { data } = await client.get(`/trust-view/${consentId}`);
    const fields: Partial<Record<ConsentField, string>> = {};
    Object.entries(data.sharedFields || {}).forEach(([key, value]) => { const field = fieldFromApi[key]; const displayValue = passportValue(value, key); if (field && displayValue !== undefined) fields[field] = displayValue; });
    return { state: "active", consentId, businessName: String(fields.legalName || "Verification Profile"), grantedAt: data.metadata.accessGrantedAt, expiresAt: data.metadata.expiresAt, purpose: data.metadata.purpose, fields, evidence: data.evidence };
  } catch (error) {
    if (axios.isAxiosError(error)) { const code = error.response?.data?.error?.code; if (code === "CONSENT_REVOKED") return { state: "revoked", consentId }; if (code === "CONSENT_EXPIRED") return { state: "expired", consentId }; if (error.response?.status === 404) return { state: "not_found", consentId }; }
    throw error;
  }
}

export async function getAuditLogs(): Promise<AuditLogEntry[]> {
  const { data } = await client.get("/audit-logs");
  const actionMap: Record<string, AuditAction | undefined> = {
    BUSINESS_CROSS_CHECKED: "business_verified",
    TRUST_PROFILE_GENERATED: "trust_profile_generated",
    CONSENT_REQUESTED: "consent_requested",
    CONSENT_APPROVED: "consent_approved",
    CONSENT_REJECTED: "consent_rejected",
    TRUST_PROFILE_VIEWED: "consent_viewed",
    CONSENT_REVOKED: "consent_revoked",
    CONSENT_EXPIRED: "consent_expired",
  };
  return data.logs.flatMap((raw: any) => {
    const action = String(raw.action) === "DOCUMENT_SUBMITTED" ? (raw.metadata?.replacedDocumentId ? "evidence_replaced" : "evidence_uploaded") : actionMap[String(raw.action)];
    return action ? [{ id: raw.id, businessId: raw.businessId, timestamp: raw.createdAt, actor: raw.actor?.name || raw.actor?.organizationName || "System", action, consentId: raw.consentRequestId, details: raw.metadata ? JSON.stringify(raw.metadata) : undefined }] : [];
  });
}
export async function getNotifications(_userId: string): Promise<Notification[]> { const { data } = await client.get("/notifications"); return data.notifications.map((raw: any) => ({ id: raw.id, userId: raw.userId, message: raw.message, read: raw.readFlag, createdAt: raw.createdAt, relatedConsentId: raw.relatedConsentId })); }
export async function markNotificationRead(id: string): Promise<void> { await client.patch(`/notifications/${id}/read`); }

export async function createAccessGrant(input: { recipientName?: string; recipientOrganization?: string; recipientEmail?: string; purpose: string; scope: { fields: ShareableField[]; evidenceTypes: ShareableEvidenceType[] }; durationHours?: number; expiresAt?: string }): Promise<AccessGrant> {
  const { data } = await client.post("/access-grants", input);
  return data.grant;
}
export async function getAccessGrants(): Promise<AccessGrant[]> { const { data } = await client.get("/access-grants"); return data.grants; }
export async function revokeAccessGrant(id: string): Promise<AccessGrant> { const { data } = await client.patch(`/access-grants/${id}/revoke`); return data.grant; }
export async function getGuestVerification(token: string): Promise<GuestVerificationView> { const { data } = await axios.get(`${API_URL}/public/verify/${encodeURIComponent(token)}`, { timeout: 15000 }); return data; }
