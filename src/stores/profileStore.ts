import { create } from 'zustand';
import type { Profile } from '@/types/nostr';
import { Profiles } from '@/services/profiles';

interface ProfileStore {
  profiles: Map<string, Profile>;
  updateTick: number;
  getProfile: (pubkey: string) => Profile | null;
  requestProfile: (pubkey: string) => void;
  onProfilesUpdated: (pubkeys: string[]) => void;
  syncFromService: () => void;
}

export const useProfileStore = create<ProfileStore>((set, get) => ({
  profiles: new Map(),
  updateTick: 0,

  getProfile: (pubkey: string) => {
    return Profiles.get(pubkey);
  },

  requestProfile: (pubkey: string) => {
    Profiles.request(pubkey);
  },

  onProfilesUpdated: (pubkeys: string[]) => {
    const profiles = new Map(get().profiles);
    for (const pk of pubkeys) {
      const p = Profiles.get(pk);
      if (p) profiles.set(pk, p);
    }
    set({ profiles, updateTick: get().updateTick + 1 });
  },

  /** Sync the store profiles map from the service cache (call after Profiles.init) */
  syncFromService: () => {
    set({ profiles: new Map(Profiles.cache) });
  },
}));
