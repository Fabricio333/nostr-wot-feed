import { create } from 'zustand';
import type { SignerBackend } from '@/types/nostr';
import { Signer } from '@/services/signer';
import {
  tryRestoreSession,
  loginWithExtension,
  loginWithBunker,
  loginWithNsec,
  loginReadOnly,
  logout as authLogout,
  detectExtension,
} from '@/services/auth';

interface AuthStore {
  isLoggedIn: boolean;
  isReadOnly: boolean;
  backend: SignerBackend;
  pubkey: string | null;
  loading: boolean;
  error: string | null;
  hasExtension: boolean;

  initialize: () => Promise<void>;
  loginExtension: () => Promise<void>;
  loginBunker: (input: string) => Promise<void>;
  loginNsec: (secretKey: Uint8Array) => Promise<void>;
  loginReadOnly: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  isLoggedIn: false,
  isReadOnly: false,
  backend: null,
  pubkey: null,
  loading: true,
  error: null,
  hasExtension: false,

  initialize: async () => {
    set({ loading: true, error: null });

    const hasExt = await detectExtension();
    set({ hasExtension: hasExt });

    const result = await tryRestoreSession();
    if (result.success) {
      set({
        isLoggedIn: true,
        isReadOnly: result.method === 'readonly',
        backend: result.method || null,
        pubkey: Signer.getPubkey(),
        loading: false,
      });
    } else {
      if (result.error) {
        set({ error: result.error });
      }
      set({ loading: false });
    }
  },

  loginExtension: async () => {
    set({ loading: true, error: null });
    try {
      const pubkey = await loginWithExtension();
      set({
        isLoggedIn: true,
        isReadOnly: false,
        backend: 'nip07',
        pubkey,
        loading: false,
      });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  loginBunker: async (input: string) => {
    set({ loading: true, error: null });
    try {
      const pubkey = await loginWithBunker(input);
      set({
        isLoggedIn: true,
        isReadOnly: false,
        backend: 'nip46',
        pubkey,
        loading: false,
      });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  loginNsec: async (secretKey: Uint8Array) => {
    set({ loading: true, error: null });
    try {
      const pubkey = await loginWithNsec(secretKey);
      set({
        isLoggedIn: true,
        isReadOnly: false,
        backend: 'nsec',
        pubkey,
        loading: false,
      });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  loginReadOnly: async () => {
    await loginReadOnly();
    set({
      isLoggedIn: true,
      isReadOnly: true,
      backend: 'readonly',
      pubkey: null,
      loading: false,
      error: null,
    });
  },

  logout: async () => {
    await authLogout();
    set({
      isLoggedIn: false,
      isReadOnly: false,
      backend: null,
      pubkey: null,
      error: null,
    });
  },

  clearError: () => set({ error: null }),
}));
