export interface DBEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
  sig: string;
  // Denormalized trust data (populated after WoT scoring)
  trustScore?: number;
  distance?: number;
  trusted?: boolean;
  paths?: number;
  combinedScore?: number;
  // Metadata
  feedType: 'global' | 'following';
  storedAt: number;
}

export interface DBProfile {
  pubkey: string;
  name: string;
  displayName: string;
  picture: string;
  banner: string;
  about: string;
  nip05: string;
  lastFetched: number;
}

export interface DBRelayStats {
  url: string;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number;
  lastConnected: number;
  consecutiveFailures: number;
}

export interface DBSeenId {
  id: string;
}
