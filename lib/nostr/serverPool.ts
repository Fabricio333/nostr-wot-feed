import { SimplePool } from 'nostr-tools';
import { RELAY_URLS } from '@/constants/nostr';
import {
  NOTE_FETCH_LIMIT,
  REACTION_FETCH_LIMIT,
  LOOKBACK_SECONDS,
} from '@/constants/trending';

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

const pool = new SimplePool();

export async function fetchRecentNotes(): Promise<NostrEvent[]> {
  const now = Math.floor(Date.now() / 1000);
  const since = now - LOOKBACK_SECONDS;
  const notes = await pool.querySync(RELAY_URLS, {
    kinds: [1],
    since,
    limit: NOTE_FETCH_LIMIT,
  } as any);
  return notes as unknown as NostrEvent[];
}

export async function fetchRecentReactions(): Promise<NostrEvent[]> {
  const now = Math.floor(Date.now() / 1000);
  const since = now - LOOKBACK_SECONDS;
  const reactions = await pool.querySync(RELAY_URLS, {
    kinds: [7],
    since,
    limit: REACTION_FETCH_LIMIT,
  } as any);
  return reactions as unknown as NostrEvent[];
}
