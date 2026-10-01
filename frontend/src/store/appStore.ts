import { create } from "zustand";

import * as api from "@/services/api";
import type {
  AuditLogEntry,
  Business,
  ConsentDurationHours,
  ConsentField,
  ConsentRequest,
  Notification,
  Role,
  TrustProfile,
} from "@/types";

interface AppState {
  business: Business | null;
  trustProfile: TrustProfile | null;
  consentRequests: ConsentRequest[];
  auditLogs: AuditLogEntry[];
  notifications: Notification[];
  loading: boolean;
  error: string | null;

  loadBusiness: () => Promise<void>;
  saveBusinessProfile: (input: Parameters<typeof api.saveBusinessProfile>[0]) => Promise<void>;
  uploadBusinessDocument: (docType: Business["documents"][number]["type"], file: File, metadata?: { issuedAt?: string; expiresAt?: string; source?: string }) => Promise<void>;
  crossCheckBusiness: () => Promise<void>;
  generateTrustProfile: () => Promise<void>;

  loadConsentRequests: () => Promise<void>;
  createConsentRequest: (input: {
    lookup: string;
    requesterId: string;
    requesterName: string;
    requesterRole: Extract<Role, "buyer" | "bank">;
    purpose?: ConsentRequest["purpose"];
    requestedFields: ConsentField[];
  }) => Promise<ConsentRequest>;
  approveConsentRequest: (id: string, fields: ConsentField[], duration: ConsentDurationHours) => Promise<void>;
  rejectConsentRequest: (id: string) => Promise<void>;
  revokeConsentRequest: (id: string) => Promise<void>;

  loadAuditLogs: () => Promise<void>;
  loadNotifications: (userId: string) => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  business: null,
  trustProfile: null,
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
    try { set({ business: await api.saveBusinessProfile(input) }); }
    catch (error) { set({ error: api.getApiError(error) }); throw error; }
  },

  uploadBusinessDocument: async (docType, file, metadata) => {
    set({ error: null });
    try { await api.uploadBusinessDocument(docType, file, metadata); }
    catch (error) { set({ error: api.getApiError(error) }); throw error; }
  },

  crossCheckBusiness: async () => {
    set({ loading: true, error: null });
    try { set({ business: await api.crossCheckBusiness(), loading: false }); await get().loadAuditLogs(); }
    catch (error) { set({ loading: false, error: api.getApiError(error) }); throw error; }
  },

  generateTrustProfile: async () => {
    set({ loading: true, error: null });
    try { const trustProfile = await api.generateTrustProfile(); set({ trustProfile, loading: false }); await get().loadAuditLogs(); }
    catch (error) { set({ loading: false, error: api.getApiError(error) }); throw error; }
  },

  loadConsentRequests: async () => {
    try { set({ consentRequests: await api.getIncomingRequests(), error: null }); }
    catch (error) { set({ error: api.getApiError(error) }); }
  },

  createConsentRequest: async (input) => {
    const request = await api.createConsentRequest(input);
    set({ consentRequests: await api.getOutgoingRequests(input.requesterId) });
    return request;
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

  loadNotifications: async (userId) => {
    try { set({ notifications: await api.getNotifications(userId), error: null }); }
    catch (error) { set({ error: api.getApiError(error) }); }
  },

  markNotificationRead: async (id) => {
    await api.markNotificationRead(id);
    const current = get().notifications;
    set({ notifications: current.map((n) => (n.id === id ? { ...n, read: true } : n)) });
  },
  clearError: () => set({ error: null }),
}));
