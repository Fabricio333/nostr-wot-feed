import { create } from 'zustand';
import type { TrustData } from '@/types/nostr';
import { WoT } from '@/services/wot';

interface WoTStore {
  hasExtension: boolean;
  cacheTick: number;
  getTrust: (pubkey: string) => TrustData | null;
  setHasExtension: (val: boolean) => void;
  invalidateCache: () => void;
}

export const useWoTStore = create<WoTStore>((set, get) => ({
  hasExtension: false,
  cacheTick: 0,

  getTrust: (pubkey: string) => {
    return WoT.cache.get(pubkey) || null;
  },

  setHasExtension: (val) => set({ hasExtension: val }),

  invalidateCache: () =>
    set((state) => ({ cacheTick: state.cacheTick + 1 })),
}));
