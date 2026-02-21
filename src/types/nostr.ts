export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface UnsignedEvent {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
}

export interface Note {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  tags: string[][];
  trustScore: number;
  distance: number;
  trusted: boolean;
  paths: number;
  combinedScore: number;
  replyTo: string | null;
}

export interface TrustData {
  score: number;
  distance: number;
  trusted: boolean;
  paths: number;
}

export interface Profile {
  name: string;
  displayName: string;
  picture: string;
  banner: string;
  about: string;
  nip05: string;
}

export interface Settings {
  sortMode: SortMode;
  maxNotes: number;
  timeWindow: number;
  maxHops: number;
  trustedOnly: boolean;
  trustWeight: number;
  trustThreshold: number;
  showTrustFooter: boolean;
  showDebug: boolean;
  compactMode: boolean;
  relays: string[];
  mutedPubkeys: string[];
  bookmarks: Record<string, Note>;
  theme: 'dark' | 'light';
}

export type SortMode = 'trust-desc' | 'trust-asc' | 'newest' | 'oldest' | 'random';

export type SignerBackend = 'nip07' | 'nip46' | 'readonly' | null;

export interface ContentToken {
  start: number;
  end: number;
  type: 'url' | 'nostr' | 'hashtag';
  value: string;
}

export interface Conversation {
  partnerPubkey: string;
  lastMessage: string;
  lastTimestamp: number;
  unread: number;
}

export interface DMMessage {
  id: string;
  fromMe: boolean;
  content: string;
  timestamp: number;
}

export type MediaType = 'image' | 'video' | 'youtube' | 'vimeo' | 'link';

export interface ParsedContent {
  type: 'text' | 'image' | 'video' | 'youtube' | 'vimeo' | 'link' | 'nostr-mention' | 'hashtag';
  value: string;
  extra?: string;
}
