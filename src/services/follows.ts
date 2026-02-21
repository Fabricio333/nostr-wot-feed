import type { NostrEvent, UnsignedEvent } from '@/types/nostr';
import { Signer } from './signer';
import { Relay } from './relay';

class FollowsService {
  private _following = new Set<string>();
  private _rawTags: string[][] = [];
  private _loaded = false;
  private _loading = false;
  private _listeners = new Set<() => void>();

  // Backward-compat: kept so existing code that sets onUpdate still works
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

  addListener(fn: () => void): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  private _notify(): void {
    this.onUpdate?.();
    for (const fn of this._listeners) fn();
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
        const latest = events.reduce((a: NostrEvent, b: NostrEvent) =>
          a.created_at > b.created_at ? a : b
        );

        this._following.clear();
        this._rawTags = [];
        for (const tag of latest.tags) {
          if (tag[0] === 'p' && tag[1]) {
            this._following.add(tag[1]);
            this._rawTags.push([...tag]);
          }
        }
      }

      this._loaded = true;
      this._notify();
    } catch (e) {
      console.warn('[Follows] Failed to load follow list:', e);
      this._loaded = true;
      this._notify();
    } finally {
      this._loading = false;
    }
  }

  async follow(pubkey: string): Promise<boolean> {
    if (this._following.has(pubkey)) return true;
    if (!Signer.isLoggedIn() || Signer.isReadOnly()) return false;

    this._following.add(pubkey);
    this._rawTags.push(['p', pubkey]);
    this._notify();

    const success = await this._publishToRelay();
    if (!success) {
      this._following.delete(pubkey);
      this._rawTags = this._rawTags.filter(t => t[1] !== pubkey);
      this._notify();
    }
    return success;
  }

  async unfollow(pubkey: string): Promise<boolean> {
    if (!this._following.has(pubkey)) return true;
    if (!Signer.isLoggedIn() || Signer.isReadOnly()) return false;

    this._following.delete(pubkey);
    const removedTag = this._rawTags.find(t => t[1] === pubkey);
    this._rawTags = this._rawTags.filter(t => t[1] !== pubkey);
    this._notify();

    const success = await this._publishToRelay();
    if (!success) {
      this._following.add(pubkey);
      if (removedTag) this._rawTags.push(removedTag);
      this._notify();
    }
    return success;
  }

  private async _publishToRelay(): Promise<boolean> {
    if (!Signer.isLoggedIn() || Signer.isReadOnly()) return false;

    try {
      const event: UnsignedEvent = {
        kind: 3,
        content: '',
        tags: this._rawTags,
        created_at: Math.floor(Date.now() / 1000),
      };
      const signed = await Signer.signEvent(event);
      await Relay.publishEvent(signed);
      return true;
    } catch (e) {
      console.warn('[Follows] Failed to publish contact list:', e);
      return false;
    }
  }

  async fetchFollowers(pubkey: string): Promise<string[]> {
    const pool = Relay.pool;
    if (!pool) return [];

    try {
      const urls = Relay.getUrls();
      const events = await pool.querySync(
        urls,
        { kinds: [3], '#p': [pubkey] } as any
      );

      const seen = new Set<string>();
      const followers: string[] = [];
      // Keep only the latest kind 3 per author
      const latestByAuthor = new Map<string, NostrEvent>();
      for (const ev of events) {
        const prev = latestByAuthor.get(ev.pubkey);
        if (!prev || ev.created_at > prev.created_at) {
          latestByAuthor.set(ev.pubkey, ev);
        }
      }
      // Only include authors whose latest contact list still references this pubkey
      for (const [author, ev] of latestByAuthor) {
        if (author === pubkey) continue;
        const stillFollows = ev.tags.some(t => t[0] === 'p' && t[1] === pubkey);
        if (stillFollows && !seen.has(author)) {
          seen.add(author);
          followers.push(author);
        }
      }
      return followers;
    } catch {
      return [];
    }
  }

  async fetchContactList(pubkey: string): Promise<string[]> {
    const pool = Relay.pool;
    if (!pool) return [];

    try {
      const urls = Relay.getUrls();
      const events = await pool.querySync(
        urls,
        { kinds: [3], authors: [pubkey], limit: 1 } as any
      );

      if (events.length === 0) return [];

      const latest = events.reduce((a: NostrEvent, b: NostrEvent) =>
        a.created_at > b.created_at ? a : b
      );

      const pubkeys: string[] = [];
      for (const tag of latest.tags) {
        if (tag[0] === 'p' && tag[1]) {
          pubkeys.push(tag[1]);
        }
      }
      return pubkeys;
    } catch {
      return [];
    }
  }

  clear(): void {
    this._following.clear();
    this._rawTags = [];
    this._loaded = false;
    this._loading = false;
  }
}

export const Follows = new FollowsService();
