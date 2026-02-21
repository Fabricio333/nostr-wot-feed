import type { NostrEvent } from '@/types/nostr';
import { Relay } from './relay';

class FollowsService {
  private _following = new Set<string>();
  private _loaded = false;
  private _loading = false;
  onUpdate: (() => void) | null = null;

  get following(): Set<string> {
    return this._following;
  }

  get loaded(): boolean {
    return this._loaded;
  }

  isFollowing(pubkey: string): boolean {
    return this._following.has(pubkey);
  }

  async load(myPubkey: string): Promise<void> {
    if (this._loading || !myPubkey) return;
    this._loading = true;

    const pool = Relay.pool;
    if (!pool) {
      this._loading = false;
      return;
    }

    try {
      const urls = Relay.getUrls();
      const events = await pool.querySync(
        urls,
        { kinds: [3], authors: [myPubkey], limit: 1 } as any
      );

      if (events.length > 0) {
        // Use the most recent kind 3 event
        const latest = events.reduce((a: NostrEvent, b: NostrEvent) =>
          a.created_at > b.created_at ? a : b
        );

        this._following.clear();
        for (const tag of latest.tags) {
          if (tag[0] === 'p' && tag[1]) {
            this._following.add(tag[1]);
          }
        }
      }

      this._loaded = true;
      this.onUpdate?.();
    } catch (e) {
      console.warn('[Follows] Failed to load follow list:', e);
      this._loaded = true;
      this.onUpdate?.();
    } finally {
      this._loading = false;
    }
  }

  clear(): void {
    this._following.clear();
    this._loaded = false;
    this._loading = false;
  }
}

export const Follows = new FollowsService();
