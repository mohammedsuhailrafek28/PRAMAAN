import { create } from "zustand";

import * as api from "@/services/api";
import { advanceEpoch, captureSession, isStaleSession } from "@/services/sessionEpoch";
import type { DisclosureScope } from "@/lib/disclosure";
import type {
  AccessGrant,
  AuditLogEntry,
  Business,
  ConsentDurationHours,
  ConsentRequest,
  CrossCheckResult,
  Notification,
  TrustProfile,
} from "@/types";

interface AppState {
  business: Business | null;
  trustProfile: TrustProfile | null;
  /** Result of the most recent cross-check run in this session (null until one runs). */
  crossCheckResult: CrossCheckResult | null;
  consentRequests: ConsentRequest[];
  /** Secure (guest) links created by this MSME. */
  accessGrants: AccessGrant[];
  auditLogs: AuditLogEntry[];
  notifications: Notification[];
  loading: boolean;
  error: string | null;

  loadBusiness: () => Promise<void>;
  saveBusinessProfile: (input: Parameters<typeof api.saveBusinessProfile>[0]) => Promise<void>;
  uploadBusinessDocument: (docType: Business["documents"][number]["type"], file: File, metadata?: { issuedAt?: string; expiresAt?: string; source?: string }) => Promise<void>;
  crossCheckBusiness: () => Promise<CrossCheckResult>;
  generateTrustProfile: () => Promise<void>;

  loadConsentRequests: () => Promise<void>;
  loadAccessGrants: () => Promise<void>;
  approveConsentRequest: (id: string, scope: DisclosureScope, duration: ConsentDurationHours) => Promise<void>;
  rejectConsentRequest: (id: string) => Promise<void>;
  revokeConsentRequest: (id: string) => Promise<void>;

  loadAuditLogs: () => Promise<void>;
  loadNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  clearError: () => void;
  /** Drops every user-specific value. Called on login, logout, registration and session expiry. */
  reset: () => void;
}

const INITIAL_STATE = {
  business: null,
  trustProfile: null,
  crossCheckResult: null,
  consentRequests: [],
  accessGrants: [],
  auditLogs: [],
  notifications: [],
  loading: false,
  error: null,
} satisfies Partial<AppState>;

/** Records an action error unless it belongs to a session that already ended. */
function failure(set: (partial: Partial<AppState>) => void, error: unknown, extra: Partial<AppState> = {}) {
  if (!isStaleSession(error)) set({ ...extra, error: api.getApiError(error) });
}

// Every async action captures the session before it starts (services/sessionEpoch).
// If the user logs out or another account signs in meanwhile, its result AND its
// error are dropped, and it must not chain follow-up requests: those would be
// sent with the new user's token. Mutations that already reached the server are
// not cancelled; only their effect on this frontend is suppressed.
export const useAppStore = create<AppState>((set, get) => ({
  ...INITIAL_STATE,

  reset: () => { advanceEpoch(); set({ ...INITIAL_STATE }); },

  loadBusiness: async () => {
    const session = captureSession();
    set({ loading: true, error: null });
    try {
      const [business, trustProfile] = await session.run(Promise.all([api.getBusiness(), api.getTrustProfile()]));
      set({ business, trustProfile, loading: false });
    } catch (error) { failure(set, error, { loading: false }); }
  },

  saveBusinessProfile: async (input) => {
    const session = captureSession();
    set({ error: null });
    try {
      const business = await session.run(api.saveBusinessProfile(input));
      // Saving claims resets the backend cross-check status, so any earlier result is no longer current.
      set({ business, crossCheckResult: null });
    } catch (error) { failure(set, error); throw error; }
  },

  uploadBusinessDocument: async (docType, file, metadata) => {
    const session = captureSession();
    set({ error: null });
    try { await session.run(api.uploadBusinessDocument(docType, file, metadata)); }
    catch (error) { failure(set, error); throw error; }
  },

  crossCheckBusiness: async () => {
    const session = captureSession();
    set({ loading: true, error: null });
    try {
      const result = await session.run(api.crossCheckBusiness());
      const business = await session.run(api.getBusiness());
      set({ business, crossCheckResult: result, loading: false });
      await get().loadAuditLogs();
      return result;
    } catch (error) { failure(set, error, { loading: false }); throw error; }
  },

  generateTrustProfile: async () => {
    const session = captureSession();
    set({ loading: true, error: null });
    try {
      const trustProfile = await session.run(api.generateTrustProfile());
      // Generation re-runs the cross-check server-side; refresh business state to match.
      const business = await session.run(api.getBusiness());
      set({ trustProfile, business, loading: false });
      await get().loadAuditLogs();
    } catch (error) { failure(set, error, { loading: false }); throw error; }
  },

  loadConsentRequests: async () => {
    const session = captureSession();
    try { set({ consentRequests: await session.run(api.getIncomingRequests()), error: null }); }
    catch (error) { failure(set, error); }
  },

  loadAccessGrants: async () => {
    const session = captureSession();
    try { set({ accessGrants: await session.run(api.getAccessGrants()) }); }
    catch (error) { failure(set, error); }
  },

  approveConsentRequest: async (id, scope, duration) => {
    const session = captureSession();
    await session.run(api.approveConsentRequest(id, scope, duration));
    await get().loadConsentRequests();
    session.assertCurrent(); // do not reload audit logs on behalf of a different user
    await get().loadAuditLogs();
  },

  rejectConsentRequest: async (id) => {
    const session = captureSession();
    await session.run(api.rejectConsentRequest(id));
    await get().loadConsentRequests();
    session.assertCurrent();
    await get().loadAuditLogs();
  },

  revokeConsentRequest: async (id) => {
    const session = captureSession();
    await session.run(api.revokeConsentRequest(id));
    await get().loadConsentRequests();
    session.assertCurrent();
    await get().loadAuditLogs();
  },

  loadAuditLogs: async () => {
    const session = captureSession();
    try { set({ auditLogs: await session.run(api.getAuditLogs()), error: null }); }
    catch (error) { failure(set, error); }
  },

  loadNotifications: async () => {
    const session = captureSession();
    try { set({ notifications: await session.run(api.getNotifications()), error: null }); }
    catch (error) { failure(set, error); }
  },

  markNotificationRead: async (id) => {
    const session = captureSession();
    try {
      await session.run(api.markNotificationRead(id));
      set({ notifications: get().notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) });
    } catch (error) {
      // Fire-and-forget from the bell: an obsolete session is simply ignored.
      if (!isStaleSession(error)) throw error;
    }
  },
  clearError: () => set({ error: null }),
}));
