import { SimplePool } from 'nostr-tools';
import { RELAY_URLS } from '@/constants/nostr';

const pool = new SimplePool();

export async function fetchNoteById(id: string) {
  try {
    const events = await pool.querySync(RELAY_URLS, { ids: [id], kinds: [1] } as any);
    return events[0] || null;
  } catch {
    return null;
  }
}

export async function fetchProfileByPubkey(pubkey: string) {
  try {
    const events = await pool.querySync(RELAY_URLS, { authors: [pubkey], kinds: [0] } as any);
    if (events[0]) return JSON.parse(events[0].content);
    return null;
  } catch {
    return null;
  }
}

export async function fetchProfileByNpub(npub: string) {
  try {
    const { nip19 } = await import('nostr-tools');
    const decoded = nip19.decode(npub);
    if (decoded.type === 'npub') {
      return fetchProfileByPubkey(decoded.data as string);
    }
    return null;
  } catch {
    return null;
  }
}
