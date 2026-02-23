import type { Profile, NostrEvent } from '@/types/nostr';
import type { DBProfile } from '@/types/db';
import { Relay } from '@/lib/nostr/relay';
import { QueryBatcher } from '@/lib/nostr/queryBatcher';
import { DB } from '@/lib/storage/db';

const PROFILE_STALE_MS = 30 * 60 * 1000; // 30 minutes

class ProfileService {
  cache = new Map<string, Profile>();
  private _lastFetched = new Map<string, number>();
  private _pendingPubkeys = new Set<string>();
  private _fetchTimer: ReturnType<typeof setTimeout> | null = null;
  private _nip05Cache = new Map<string, boolean>();
  onUpdate: ((pubkeys: string[]) => void) | null = null;

  /** Initialize from IndexedDB cache for instant profile display on reload */
  async init(): Promise<void> {
    const cached = await DB.getAllProfiles();
    for (const p of cached) {
      this.cache.set(p.pubkey, {
        name: p.name,
        displayName: p.displayName,
        picture: p.picture,
        banner: p.banner,
        about: p.about,
        nip05: p.nip05,
      });
      this._lastFetched.set(p.pubkey, p.lastFetched);
    }
  }

  get(pubkey: string): Profile | null {
    return this.cache.get(pubkey) || null;
  }

  /**
   * Request a profile. Always serves cached data immediately (via get()).
   * If the cached entry is stale (>30 min), queues a background refetch —
   * once the relay responds, onUpdate fires and the UI re-renders with fresh data.
   */
  request(pubkey: string): void {
    if (this._pendingPubkeys.has(pubkey)) return;

    // Skip refetch if fresh (< 30 min old)
    const lastFetched = this._lastFetched.get(pubkey);
    if (lastFetched && Date.now() - lastFetched < PROFILE_STALE_MS) {
      return;
    }

    // Queue background refetch (cached data is still served via get() in the meantime)
    this._pendingPubkeys.add(pubkey);
    if (!this._fetchTimer) {
      this._fetchTimer = setTimeout(() => this._fetchBatch(), 50);
    }
  }

  private async _fetchBatch(): Promise<void> {
    this._fetchTimer = null;
    if (this._pendingPubkeys.size === 0) return;

    const pubkeys = [...this._pendingPubkeys];
    this._pendingPubkeys.clear();

    const events = await QueryBatcher.query(Relay.getUrls(), {
      kinds: [0],
      authors: pubkeys,
    }, {
      onUpdate: (allEvents) => {
        this._processProfileEvents(allEvents);
      },
    });

    this._processProfileEvents(events);
  }

  private _processProfileEvents(events: NostrEvent[]): void {
    const latest = new Map<string, NostrEvent>();
    for (const ev of events) {
      const existing = latest.get(ev.pubkey);
      if (!existing || ev.created_at > existing.created_at) {
        latest.set(ev.pubkey, ev);
      }
    }

    const updatedPubkeys: string[] = [];
    const toStore: DBProfile[] = [];
    const now = Date.now();

    for (const [pk, ev] of latest) {
      try {
        const meta = JSON.parse(ev.content);
        const profile: Profile = {
          name: meta.name || meta.display_name || '',
          displayName: meta.display_name || meta.name || '',
          picture: meta.picture || '',
          banner: meta.banner || '',
          about: meta.about || '',
          nip05: meta.nip05 || '',
        };
        this.cache.set(pk, profile);
        this._lastFetched.set(pk, now);
        updatedPubkeys.push(pk);

        toStore.push({
          pubkey: pk,
          ...profile,
          lastFetched: now,
        });
      } catch {
        // invalid JSON
      }
    }

    // Persist to IndexedDB in background
    if (toStore.length > 0) {
      DB.putProfiles(toStore).catch(() => {});
    }

    if (updatedPubkeys.length > 0) {
      this.onUpdate?.(updatedPubkeys);
    }
  }

  /** Directly update a profile in the local cache (e.g. after publishing kind 0) */
  updateLocal(pubkey: string, profile: Profile): void {
    this.cache.set(pubkey, profile);
    this._lastFetched.set(pubkey, Date.now());
    DB.putProfiles([{ pubkey, ...profile, lastFetched: Date.now() }]).catch(() => {});
    this.onUpdate?.([pubkey]);
  }

  /** Force re-fetch from relays, ignoring staleness. Used after manual profile edits. */
  forceRefresh(pubkey: string): void {
    this._lastFetched.delete(pubkey);
    this._pendingPubkeys.add(pubkey);
    if (!this._fetchTimer) {
      this._fetchTimer = setTimeout(() => this._fetchBatch(), 50);
    }
  }

  /** Lazy NIP-05 verification — only call when profile card is visible */
  async resolveNip05(pubkey: string, nip05: string): Promise<boolean> {
    if (this._nip05Cache.has(pubkey)) return this._nip05Cache.get(pubkey)!;

    if (!nip05 || !nip05.includes('@')) {
      this._nip05Cache.set(pubkey, false);
      return false;
    }

    try {
      const [name, domain] = nip05.split('@');
      const resp = await fetch(`https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`);
      const data = await resp.json();
      const verified = data.names?.[name] === pubkey;
      this._nip05Cache.set(pubkey, verified);
      return verified;
    } catch {
      this._nip05Cache.set(pubkey, false);
      return false;
    }
  }
}

export const Profiles = new ProfileService();
