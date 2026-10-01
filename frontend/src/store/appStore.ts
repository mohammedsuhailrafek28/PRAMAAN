import { create } from "zustand";

import * as api from "@/services/api";
import type {
  AuditLogEntry,
  Business,
  ConsentDurationHours,
  ConsentField,
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
  approveConsentRequest: (id: string, fields: ConsentField[], duration: ConsentDurationHours) => Promise<void>;
  rejectConsentRequest: (id: string) => Promise<void>;
  revokeConsentRequest: (id: string) => Promise<void>;

  loadAuditLogs: () => Promise<void>;
  loadNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  business: null,
  trustProfile: null,
  crossCheckResult: null,
  consentRequests: [],
  auditLogs: [],
  notifications: [],
  loading: false,
  error: null,

  loadBusiness: async () => {
    set({ loading: true, error: null });
    try {
      const [business, trustProfile] = await Promise.all([api.getBusiness(), api.getTrustProfile()]);
      set({ business, trustProfile, loading: false });
    } catch (error) {
      set({ loading: false, error: api.getApiError(error) });
    }
  },

  saveBusinessProfile: async (input) => {
    set({ error: null });
    // Saving claims resets the backend cross-check status, so any earlier result is no longer current.
    try { set({ business: await api.saveBusinessProfile(input), crossCheckResult: null }); }
    catch (error) { set({ error: api.getApiError(error) }); throw error; }
  },

  uploadBusinessDocument: async (docType, file, metadata) => {
    set({ error: null });
    try { await api.uploadBusinessDocument(docType, file, metadata); }
    catch (error) { set({ error: api.getApiError(error) }); throw error; }
  },

  crossCheckBusiness: async () => {
    set({ loading: true, error: null });
    try {
      const { business, result } = await api.crossCheckBusiness();
      set({ business, crossCheckResult: result, loading: false });
      await get().loadAuditLogs();
      return result;
    } catch (error) { set({ loading: false, error: api.getApiError(error) }); throw error; }
  },

  generateTrustProfile: async () => {
    set({ loading: true, error: null });
    try {
      const trustProfile = await api.generateTrustProfile();
      // Generation re-runs the cross-check server-side; refresh business state to match.
      const business = await api.getBusiness();
      set({ trustProfile, business, loading: false });
      await get().loadAuditLogs();
    } catch (error) { set({ loading: false, error: api.getApiError(error) }); throw error; }
  },

  loadConsentRequests: async () => {
    try { set({ consentRequests: await api.getIncomingRequests(), error: null }); }
    catch (error) { set({ error: api.getApiError(error) }); }
  },

  approveConsentRequest: async (id, fields, duration) => {
    await api.approveConsentRequest(id, fields, duration);
    await get().loadConsentRequests();
    await get().loadAuditLogs();
  },

  rejectConsentRequest: async (id) => {
    await api.rejectConsentRequest(id);
    await get().loadConsentRequests();
    await get().loadAuditLogs();
  },

  revokeConsentRequest: async (id) => {
    await api.revokeConsentRequest(id);
    await get().loadConsentRequests();
    await get().loadAuditLogs();
  },

  loadAuditLogs: async () => {
    try { set({ auditLogs: await api.getAuditLogs(), error: null }); }
    catch (error) { set({ error: api.getApiError(error) }); }
  },

  loadNotifications: async () => {
    try { set({ notifications: await api.getNotifications(), error: null }); }
    catch (error) { set({ error: api.getApiError(error) }); }
  },

  markNotificationRead: async (id) => {
    await api.markNotificationRead(id);
    const current = get().notifications;
    set({ notifications: current.map((n) => (n.id === id ? { ...n, read: true } : n)) });
  },
  clearError: () => set({ error: null }),
}));
