import type { Profile, NostrEvent } from '@/types/nostr';
import { Relay } from './relay';

class ProfileService {
  cache = new Map<string, Profile>();
  private _pendingPubkeys = new Set<string>();
  private _fetchTimer: ReturnType<typeof setTimeout> | null = null;
  onUpdate: ((pubkeys: string[]) => void) | null = null;

  get(pubkey: string): Profile | null {
    return this.cache.get(pubkey) || null;
  }

  request(pubkey: string): void {
    if (this.cache.has(pubkey) || this._pendingPubkeys.has(pubkey)) return;
    this._pendingPubkeys.add(pubkey);
    if (!this._fetchTimer) {
      this._fetchTimer = setTimeout(() => this._fetchBatch(), 250);
    }
  }

  private async _fetchBatch(): Promise<void> {
    this._fetchTimer = null;
    if (this._pendingPubkeys.size === 0) return;

    const pubkeys = [...this._pendingPubkeys];
    this._pendingPubkeys.clear();

    const pool = Relay.pool;
    if (!pool) return;

    const events = await pool.querySync(Relay.getUrls(), {
      kinds: [0],
      authors: pubkeys,
    });

    const latest = new Map<string, NostrEvent>();
    for (const ev of events) {
      const existing = latest.get(ev.pubkey);
      if (!existing || ev.created_at > existing.created_at) {
        latest.set(ev.pubkey, ev);
      }
    }

    const updatedPubkeys: string[] = [];
    for (const [pk, ev] of latest) {
      try {
        const meta = JSON.parse(ev.content);
        this.cache.set(pk, {
          name: meta.name || meta.display_name || '',
          displayName: meta.display_name || meta.name || '',
          picture: meta.picture || '',
          about: meta.about || '',
          nip05: meta.nip05 || '',
        });
        updatedPubkeys.push(pk);
      } catch {
        // invalid JSON
      }
    }

    if (updatedPubkeys.length > 0) {
      this.onUpdate?.(updatedPubkeys);
    }
  }
}

export const Profiles = new ProfileService();
