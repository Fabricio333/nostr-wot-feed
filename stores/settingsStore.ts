import { create } from 'zustand';
import type { Settings, SortMode } from '@/types/nostr';
import {
  defaultSettings,
  loadSettings,
  setSetting,
} from '@/lib/storage/settings';

interface SettingsStore extends Settings {
  loaded: boolean;
  load: () => void;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setSortMode: (mode: SortMode) => void;
  setMaxHops: (hops: number) => void;
  setTrustedOnly: (val: boolean) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  addRelay: (url: string) => void;
  removeRelay: (url: string) => void;
  setRelays: (urls: string[]) => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...defaultSettings,
  loaded: false,

  load: () => {
    const settings = loadSettings();
    set({ ...settings, loaded: true });
  },

  set: (key, value) => {
    set({ [key]: value } as any);
    setSetting(key, value);
  },

  setSortMode: (mode) => {
    set({ sortMode: mode });
    setSetting('sortMode', mode);
  },

  setMaxHops: (hops) => {
    set({ maxHops: hops });
    setSetting('maxHops', hops);
  },

  setTrustedOnly: (val) => {
    set({ trustedOnly: val });
    setSetting('trustedOnly', val);
  },

  setTheme: (theme) => {
    set({ theme });
    setSetting('theme', theme);
  },

  addRelay: (url) => {
    const relays = [...get().relays, url];
    set({ relays });
    setSetting('relays', relays);
  },

  removeRelay: (url) => {
    const relays = get().relays.filter((u) => u !== url);
    if (relays.length === 0) return;
    set({ relays });
    setSetting('relays', relays);
  },

  setRelays: (urls) => {
    if (urls.length === 0) return;
    set({ relays: urls });
    setSetting('relays', urls);
  },
}));
