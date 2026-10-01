import axios from "axios";
import type {
  AuditActor, AuditLogEntry, Business, BusinessDocument, ConsentDurationHours,
  ConsentRequest, Contradiction, CrossCheckResult, DocumentCheck, EvidenceGap, FieldCheck,
  Notification, Role, TrustProfile, TrustViewResult, User, EvidenceStatus, TrustSummary,
  AccessGrant, GuestLinkFailure, GuestVerificationView, SharedEvidence,
} from "@/types";
import { formatSharedFields } from "@/lib/sharedFields";
import { parseScope, type DisclosureScope } from "@/lib/disclosure";

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

/** User-facing copy for backend error codes; backend message strings are never shown for these. */
const FRIENDLY_ERRORS: Record<string, string> = {
  PROFILE_NOT_READY: "Generate your Trust Profile first. Verifiers are shown a pinned version of it, so one must exist before access can be shared.",
  CONSENT_REVOKED: "The business has revoked this access.",
  CONSENT_EXPIRED: "This access period has ended.",
  ACCESS_REVOKED: "The business has revoked this link.",
  ACCESS_EXPIRED: "This link has expired.",
  INVALID_ACCESS_LINK: "This link is not valid.",
  PROFILE_SNAPSHOT_UNAVAILABLE: "The shared Trust Profile version is no longer available.",
  CONFLICT: "This request has already been handled. Refresh to see its current state.",
  RATE_LIMITED: "Too many requests. Please wait a moment and try again.",
  INTERNAL_SERVER_ERROR: "Something went wrong on our side. Please try again.",
};

export function getApiErrorCode(error: unknown): string | undefined {
  return axios.isAxiosError(error) ? error.response?.data?.error?.code : undefined;
}

export function getApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) return "Can't reach Pramaan right now. Check your connection and try again.";
    const code = error.response.data?.error?.code;
    return (code && FRIENDLY_ERRORS[code]) || error.response.data?.error?.message || "Something went wrong. Please try again.";
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

const roleToApi: Record<Role, "MSME" | "BUYER" | "BANK"> = { msme: "MSME", buyer: "BUYER", bank: "BANK" };
const roleFromApi: Record<string, Role> = { MSME: "msme", BUYER: "buyer", BANK: "bank" };
const statusFromApi: Record<string, ConsentRequest["status"]> = {
  PENDING: "pending", APPROVED: "active", REJECTED: "rejected", REVOKED: "revoked", EXPIRED: "expired",
};
function mapUser(raw: any): User {
  const name = raw.name || "Pramaan user";
  return { id: raw.id, role: roleFromApi[raw.role] || raw.role, name, orgName: raw.organizationName, email: raw.email, avatarInitials: name.split(" ").map((part: string) => part[0]).join("").slice(0, 2).toUpperCase() };
}

function mapActor(raw: any): AuditActor | undefined {
  if (!raw) return undefined;
  return { name: raw.name || undefined, organization: raw.organizationName || undefined, role: roleFromApi[raw.role] };
}

function mapDocument(doc: any): BusinessDocument {
  return {
    id: doc.id,
    type: String(doc.docType).toLowerCase() as BusinessDocument["type"],
    label: String(doc.docType).replace(/_/g, " "),
    fileName: doc.originalName, uploadedAt: doc.uploadedAt, evidenceStatus: doc.evidenceStatus,
    confidence: doc.confidence, confidenceReason: doc.confidenceReason, source: doc.source,
    checkedAt: doc.checkedAt, expiresAt: doc.expiresAt, issuedAt: doc.issuedAt, revision: doc.revision,
    isCurrent: doc.isCurrent, previousVersionId: doc.previousVersionId, lifecycle: doc.lifecycle,
  };
}

function mapBusiness(raw: any): Business {
  const trustSummary = raw.trustSummary && typeof raw.trustSummary === "object" ? raw.trustSummary as TrustSummary : undefined;
  return {
    id: raw.id, ownerId: raw.userId, legalName: raw.legalName || "", gstin: raw.gstin || "", udyamNumber: raw.udyamNumber || "",
    pan: raw.pan || "", address: raw.address || "", turnoverBand: raw.turnoverBand || "",
    trustStatus: String(raw.trustStatus || "SELF_DECLARED") as EvidenceStatus,
    trustSummary,
    sourceVerificationPerformed: false,
    documents: (raw.documents || []).map(mapDocument),
    lastCrossCheckedAt: raw.lastCrossCheckedAt || undefined,
  };
}

function mapFieldChecks(raw: any[] | undefined): FieldCheck[] {
  return (raw || []).map((item) => ({ field: item.field, value: item.value, status: item.status, confidence: item.confidence, reason: item.reason, checks: item.checks || [] }));
}

function mapDocumentChecks(raw: any[] | undefined): DocumentCheck[] {
  return (raw || []).map((item) => ({ documentId: item.documentId, documentType: item.documentType, status: item.status, confidence: item.confidence, reason: item.reason, checks: item.checks || [] }));
}

function mapGaps(raw: any[] | undefined): EvidenceGap[] {
  return (raw || []).map((item) => ({ field: item.field, severity: item.severity, message: item.message }));
}

function mapContradictions(raw: any[] | undefined): Contradiction[] {
  return (raw || []).map((item) => ({ field: item.field, severity: item.severity, reason: item.reason }));
}

function mapConsent(raw: any): ConsentRequest {
  const requested = parseScope(raw.requestedFields, raw.requestedEvidenceTypes);
  const approved = parseScope(raw.approvedFields, raw.approvedEvidenceTypes);
  let status = statusFromApi[raw.status] || "pending";
  // Defensive: the backend materialises expiry on read, but never show lapsed access as live.
  if (status === "active" && raw.expiresAt && new Date(raw.expiresAt).getTime() <= Date.now()) status = "expired";
  return {
    id: raw.id, businessId: raw.businessId ?? raw.business?.id,
    // Only identity the verifier already sees via GSTIN lookup; nothing else is read from `raw.business`.
    businessName: raw.business?.legalName || undefined,
    businessGstin: raw.business?.gstin || undefined,
    requesterId: raw.requesterId ?? raw.requester?.id,
    requesterName: raw.requester?.organizationName || raw.requester?.name || "Verifier",
    requesterRole: roleFromApi[raw.requester?.role] as ConsentRequest["requesterRole"],
    purpose: raw.purpose || undefined,
    requested: requested.scope, approved: approved.scope, unsupportedRequested: requested.unsupported,
    durationDays: typeof raw.durationDays === "number" ? raw.durationDays : null,
    status, requestedAt: raw.createdAt || raw.requestedAt, approvedAt: raw.approvedAt || undefined, expiresAt: raw.expiresAt || undefined, revokedAt: raw.revokedAt || undefined,
  };
}

function mapGrant(raw: any): AccessGrant {
  return { ...raw, scope: parseScope(raw.scope?.fields, raw.scope?.evidenceTypes).scope };
}

function mapTrustProfile(snapshot: any, fallbackId?: string): TrustProfile {
  return {
    id: snapshot?.profileId || fallbackId, businessId: snapshot?.businessId, version: snapshot?.version || 1,
    generatedAt: snapshot?.generatedAt, lastCalculatedAt: snapshot?.lastCalculatedAt,
    summary: (snapshot?.summary || {}) as TrustSummary,
    fields: mapFieldChecks(snapshot?.fieldConfidence),
    documents: mapDocumentChecks(snapshot?.documentConfidence),
    gaps: mapGaps(snapshot?.gaps),
    contradictions: mapContradictions(snapshot?.contradictions),
    limitations: Array.isArray(snapshot?.limitations) ? snapshot.limitations.map(String) : [],
    sourceVerificationPerformed: false,
  };
}

function mapSharedEvidence(raw: any[] | undefined): SharedEvidence[] {
  return (raw || []).map((doc) => ({
    docType: doc.docType, evidenceStatus: doc.evidenceStatus, confidence: doc.confidence,
    source: doc.source, issuedAt: doc.issuedAt, checkedAt: doc.checkedAt, expiresAt: doc.expiresAt, uploadedAt: doc.uploadedAt, lifecycle: doc.lifecycle || undefined,
  }));
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
export async function lookupBusiness(gstin: string): Promise<{ id: string; legalName: string; gstin: string; trustStatus: EvidenceStatus }> {
  const { data } = await client.get(`/business/lookup/${encodeURIComponent(gstin.trim().toUpperCase())}`);
  return data.business;
}

export async function generateTrustProfile(): Promise<TrustProfile> {
  const { data } = await client.post("/passport/generate");
  return mapTrustProfile(data.snapshot ?? data.passport?.snapshotJson, data.passportId ?? data.passport?.id);
}

export async function getTrustProfile(): Promise<TrustProfile | null> { try { const { data } = await client.get("/passport/me"); return mapTrustProfile(data.passport.snapshotJson, data.passport.id); } catch (error) { if (axios.isAxiosError(error) && error.response?.status === 404) return null; throw error; } }

export async function getCurrentUser(): Promise<User> { const { data } = await client.get("/auth/me"); return mapUser(data.user); }

export async function saveBusinessProfile(input: { legalName: string; gstin: string; udyamNumber: string; pan: string; address: string; turnoverBand: string }): Promise<Business> {
  const { data } = await client.post("/business", input);
  return mapBusiness(data.business);
}

export async function uploadBusinessDocument(docType: BusinessDocument["type"], file: File, metadata: { issuedAt?: string; expiresAt?: string; source?: string } = {}): Promise<void> {
  const form = new FormData();
  form.append("docType", docType.toUpperCase());
  form.append("file", file);
  if (metadata.issuedAt) form.append("issuedAt", metadata.issuedAt);
  if (metadata.expiresAt) form.append("expiresAt", metadata.expiresAt);
  if (metadata.source) form.append("source", metadata.source);
  await client.post("/business/documents", form);
}

/** Runs the internal cross-check and returns the engine's own result plus the refreshed business. */
export async function crossCheckBusiness(): Promise<{ business: Business; result: CrossCheckResult }> {
  const { data } = await client.post("/business/cross-check");
  const profile = data.profile || {};
  const result: CrossCheckResult = {
    trustStatus: data.trustStatus,
    checkedAt: profile.lastCalculatedAt,
    summary: (profile.summary || {}) as TrustSummary,
    fields: mapFieldChecks(profile.fieldConfidence),
    documents: mapDocumentChecks(profile.documentConfidence),
    gaps: mapGaps(profile.gaps),
    contradictions: mapContradictions(profile.contradictions),
    limitations: Array.isArray(profile.limitations) ? profile.limitations.map(String) : [],
  };
  return { business: await getBusiness(), result };
}

const toApiScope = (scope: DisclosureScope) => ({ fields: scope.fields, evidenceTypes: scope.evidence });

export async function createConsentRequest(input: { lookup: string; scope: DisclosureScope; purpose?: string }): Promise<ConsentRequest> {
  const { data } = await client.post("/consent-requests", { businessGstin: input.lookup, purpose: input.purpose, requestedFields: input.scope.fields, requestedEvidenceTypes: input.scope.evidence });
  return mapConsent(data.consent);
}
export async function getIncomingRequests(): Promise<ConsentRequest[]> { const { data } = await client.get("/consent-requests", { params: { scope: "incoming" } }); return data.requests.map(mapConsent); }
export async function getOutgoingRequests(): Promise<ConsentRequest[]> { const { data } = await client.get("/consent-requests", { params: { scope: "outgoing" } }); return data.requests.map(mapConsent); }
export async function approveConsentRequest(id: string, scope: DisclosureScope, duration: ConsentDurationHours): Promise<ConsentRequest> { const { data } = await client.patch(`/consent-requests/${id}/approve`, { approvedFields: scope.fields, approvedEvidenceTypes: scope.evidence, durationDays: duration / 24 }); return mapConsent(data.consent); }
export async function rejectConsentRequest(id: string): Promise<ConsentRequest> { const { data } = await client.patch(`/consent-requests/${id}/reject`); return mapConsent(data.consent); }
export async function revokeConsentRequest(id: string): Promise<ConsentRequest> { const { data } = await client.patch(`/consent-requests/${id}/revoke`); return mapConsent(data.consent); }

export async function getTrustView(consentId: string): Promise<TrustViewResult> {
  try {
    const { data } = await client.get(`/trust-view/${consentId}`);
    const fields = formatSharedFields(data.sharedFields);
    const name = fields.find((field) => field.key === "legalBusinessName")?.value;
    return {
      state: "active", consentId, businessName: name || "Shared business information",
      grantedAt: data.metadata.accessGrantedAt, expiresAt: data.metadata.expiresAt, purpose: data.metadata.purpose || undefined,
      profileVersion: typeof data.metadata.passportVersion === "number" ? data.metadata.passportVersion : undefined,
      fields, evidence: mapSharedEvidence(data.evidence),
    };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      const code = getApiErrorCode(error);
      if (code === "CONSENT_REVOKED") return { state: "revoked", consentId };
      if (code === "CONSENT_EXPIRED") return { state: "expired", consentId };
      if (code === "PROFILE_NOT_READY") return { state: "unavailable", consentId, message: "The business's Trust Profile for this consent isn't available yet." };
      if (error.response.status === 403) return { state: "unavailable", consentId, message: "This request hasn't been approved, or it isn't yours to open." };
      if (error.response.status === 404) return { state: "not_found", consentId };
    }
    throw error;
  }
}

export async function getAuditLogs(): Promise<AuditLogEntry[]> {
  const { data } = await client.get("/audit-logs");
  return (data.logs || []).map((raw: any): AuditLogEntry => ({
    id: raw.id,
    action: String(raw.action),
    timestamp: raw.createdAt,
    actor: mapActor(raw.actor),
    requester: mapActor(raw.consentRequest?.requester),
    consentId: raw.consentRequestId || undefined,
    accessGrantId: raw.accessGrantId || undefined,
    metadata: raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata) ? raw.metadata : undefined,
  }));
}
export async function getNotifications(): Promise<Notification[]> { const { data } = await client.get("/notifications"); return data.notifications.map((raw: any) => ({ id: raw.id, userId: raw.userId, message: raw.message, read: raw.readFlag, createdAt: raw.createdAt, relatedConsentId: raw.relatedConsentId })); }
export async function markNotificationRead(id: string): Promise<void> { await client.patch(`/notifications/${id}/read`); }

export async function createAccessGrant(input: { recipientName?: string; recipientOrganization?: string; recipientEmail?: string; purpose: string; scope: DisclosureScope; durationHours?: number; expiresAt?: string }): Promise<AccessGrant> {
  const { data } = await client.post("/access-grants", { ...input, scope: toApiScope(input.scope) });
  return mapGrant(data.grant);
}
export async function getAccessGrants(): Promise<AccessGrant[]> { const { data } = await client.get("/access-grants"); return data.grants.map(mapGrant); }
export async function revokeAccessGrant(id: string): Promise<AccessGrant> { const { data } = await client.patch(`/access-grants/${id}/revoke`); return mapGrant(data.grant); }

const GUEST_FAILURES: Record<string, GuestLinkFailure> = {
  ACCESS_REVOKED: "revoked", ACCESS_EXPIRED: "expired", INVALID_ACCESS_LINK: "invalid", PROFILE_SNAPSHOT_UNAVAILABLE: "unavailable",
};

export async function getGuestVerification(token: string): Promise<{ view: GuestVerificationView } | { failure: GuestLinkFailure }> {
  try {
    const { data } = await axios.get(`${API_URL}/public/verify/${encodeURIComponent(token)}`, { timeout: 15000 });
    return { view: { grant: data.grant, business: data.business || {}, fields: formatSharedFields(data.sharedFields), evidence: mapSharedEvidence(data.evidence) } };
  } catch (error) {
    const code = getApiErrorCode(error);
    if (code && GUEST_FAILURES[code]) return { failure: GUEST_FAILURES[code] };
    if (axios.isAxiosError(error) && error.response?.status === 404) return { failure: "invalid" };
    throw error;
  }
}
