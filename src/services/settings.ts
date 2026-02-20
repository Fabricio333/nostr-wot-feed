import type { Settings } from '@/types/nostr';

const STORAGE_KEY = 'wot-feed-settings';

export const defaultSettings: Settings = {
  sortMode: 'trust-desc',
  maxNotes: 150,
  timeWindow: 24,
  maxHops: 3,
  trustedOnly: false,
  trustWeight: 0.7,
  trustThreshold: 0,
  showTrustFooter: true,
  showDebug: false,
  compactMode: false,
  relays: ['wss://relay.damus.io', 'wss://relay.nostr.band', 'wss://nos.lol'],
  mutedPubkeys: [],
  bookmarks: {},
  theme: 'dark',
};

let _data: Settings | null = null;

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    _data = { ...defaultSettings, ...saved };
  } catch {
    _data = { ...defaultSettings };
  }
  return _data!;
}

export function saveSettings(data: Settings): void {
  _data = data;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // quota exceeded
  }
}

export function getSettings(): Settings {
  return _data || loadSettings();
}

export function setSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K]
): void {
  if (!_data) loadSettings();
  _data![key] = value;
  saveSettings(_data!);
}
