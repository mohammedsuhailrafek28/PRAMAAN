import { create } from "zustand";

import * as api from "@/services/api";
import { TOKEN_KEY, onUnauthorized } from "@/services/session";
import { useAppStore } from "@/store/appStore";
import type { User } from "@/types";

interface AuthState {
  currentUser: User | null;
  loading: boolean;
  hydrating: boolean;
  /** True after the server rejected our token; the login page explains why the user was signed out. */
  sessionExpired: boolean;
  loginAs: (email: string, password: string) => Promise<User>;
  registerAs: (input: Parameters<typeof api.register>[0]) => Promise<User>;
  restoreSession: () => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  currentUser: null,
  loading: false,
  hydrating: true,
  sessionExpired: false,
  loginAs: async (email, password) => {
    set({ loading: true });
    try {
      // Clear the previous user's data first so it can never render under the new session.
      useAppStore.getState().reset();
      const user = await api.login(email, password);
      set({ currentUser: user, loading: false, sessionExpired: false });
      return user;
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },
  registerAs: async (input) => {
    useAppStore.getState().reset();
    const user = await api.register(input);
    set({ currentUser: user, sessionExpired: false });
    return user;
  },
  restoreSession: async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { set({ hydrating: false }); return; }
    try {
      const user = await api.getCurrentUser();
      set({ currentUser: user, hydrating: false });
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      set({ currentUser: null, hydrating: false });
    }
  },
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    useAppStore.getState().reset();
    set({ currentUser: null, sessionExpired: false });
  },
}));

// A 401 on an authenticated request ends the UI session too, not just the stored token.
onUnauthorized(() => {
  if (!useAuthStore.getState().currentUser) return;
  useAppStore.getState().reset();
  useAuthStore.setState({ currentUser: null, sessionExpired: true });
});
