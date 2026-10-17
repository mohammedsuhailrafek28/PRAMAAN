import { create } from "zustand";

import * as api from "@/services/api";
import { TOKEN_KEY, onUnauthorized } from "@/services/session";
import { StaleSessionError, captureSession, isStaleSession } from "@/services/sessionEpoch";
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

// Only one sign-in/registration may be in flight. Two concurrent ones would race
// on the stored token and could leave the token and the displayed user disagreeing.
let authInFlight = false;

export const useAuthStore = create<AuthState>((set) => {
  /** Runs a sign-in; if the session was ended (logout, 401) before it finished, the token it stored is removed again. */
  async function signIn(request: () => Promise<User>): Promise<User> {
    if (authInFlight) throw new Error("A sign-in is already in progress.");
    authInFlight = true;
    set({ loading: true });
    try {
      // Clear the previous user's data first so it can never render under the new session.
      useAppStore.getState().reset();
      const session = captureSession();
      let user: User;
      try { user = await request(); }
      catch (error) {
        if (!session.isCurrent()) { localStorage.removeItem(TOKEN_KEY); throw new StaleSessionError(); }
        throw error;
      }
      if (!session.isCurrent()) { localStorage.removeItem(TOKEN_KEY); throw new StaleSessionError(); }
      set({ currentUser: user, sessionExpired: false });
      return user;
    } finally {
      authInFlight = false;
      set({ loading: false });
    }
  }

  return {
    currentUser: null,
    loading: false,
    hydrating: true,
    sessionExpired: false,
    loginAs: (email, password) => signIn(() => api.login(email, password)),
    registerAs: (input) => signIn(() => api.register(input)),
    restoreSession: async () => {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) { set({ hydrating: false }); return; }
      const session = captureSession();
      try {
        const user = await session.run(api.getCurrentUser());
        set({ currentUser: user, hydrating: false });
      } catch (error) {
        // A login/logout that happened meanwhile owns the token and the user; leave both alone.
        if (isStaleSession(error)) { set({ hydrating: false }); return; }
        localStorage.removeItem(TOKEN_KEY);
        set({ currentUser: null, hydrating: false });
      }
    },
    logout: () => {
      localStorage.removeItem(TOKEN_KEY);
      useAppStore.getState().reset();
      set({ currentUser: null, sessionExpired: false });
    },
  };
});

// A 401 on an authenticated request ends the UI session too, not just the stored token.
onUnauthorized(() => {
  if (!useAuthStore.getState().currentUser) return;
  useAppStore.getState().reset();
  useAuthStore.setState({ currentUser: null, sessionExpired: true });
});
