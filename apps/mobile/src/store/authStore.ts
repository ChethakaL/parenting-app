import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const TOKEN_KEY = "parentai_bearer_token";
const ONBOARDED_KEY = "parentai_onboarded";

type AuthState = {
  token: string | null;
  onboarded: boolean;
  loading: boolean;
  loadFromStorage: () => Promise<void>;
  setToken: (token: string, onboarded: boolean) => Promise<void>;
  clearToken: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  onboarded: false,
  loading: true,
  loadFromStorage: async () => {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      const onboardedStr = await SecureStore.getItemAsync(ONBOARDED_KEY);
      const onboarded = onboardedStr === "true";
      if (token) {
        set({ token, onboarded, loading: false });
        return;
      }
      set({ token: null, onboarded: false, loading: false });
    } catch {
      set({ token: null, onboarded: false, loading: false });
    }
  },
  setToken: async (token, onboarded) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(ONBOARDED_KEY, String(onboarded));
    set({ token, onboarded, loading: false });
  },
  clearToken: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(ONBOARDED_KEY);
    set({ token: null, onboarded: false, loading: false });
  },
}));

