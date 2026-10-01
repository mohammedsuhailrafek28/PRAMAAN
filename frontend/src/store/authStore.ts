import { create } from "zustand";

import * as api from "@/services/api";
import type { Role, User } from "@/types";

interface AuthState {
  currentUser: User | null;
  loading: boolean;
  hydrating: boolean;
  loginAs: (role: Role, email?: string, password?: string) => Promise<void>;
  restoreSession: () => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  currentUser: null,
  loading: false,
  hydrating: true,
  loginAs: async (role, email, password) => {
    set({ loading: true });
    try {
      const user = await api.login(role, email, password);
      set({ currentUser: user, loading: false });
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },
  restoreSession: async () => {
    const token = localStorage.getItem("pramaan_access_token");
    if (!token) { set({ hydrating: false }); return; }
    try {
      const user = await api.getCurrentUser();
      set({ currentUser: user, hydrating: false });
    } catch {
      localStorage.removeItem("pramaan_access_token");
      set({ currentUser: null, hydrating: false });
    }
  },
  logout: () => { localStorage.removeItem("pramaan_access_token"); set({ currentUser: null }); },
}));
