import type { NostrEvent, TrendingHashtag, TrendingPost } from '@/types/nostr';
import { Profiles } from './profiles';

const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const SERVER_POLL_MS = 5 * 60 * 1000; // Poll server every 5 minutes
const CLIENT_FALLBACK_MS = 60 * 60 * 1000; // 1 hour for client-side fallback
const LOOKBACK_SECONDS = 4 * 60 * 60;
const TOP_HASHTAGS = 5;
const TOP_POSTS = 5;

class TrendingService {
  private _refreshTimer: ReturnType<typeof setInterval> | null = null;
  private _lastFetchedAt: number = 0;
  private _fetching = false;
  private _started = false;
  private _serverAvailable = true;

  hashtags: TrendingHashtag[] = [];
  posts: TrendingPost[] = [];

  onUpdate: (() => void) | null = null;

  async start(): Promise<void> {
    if (this._started) return;
    this._started = true;

    await this.refresh();

    this._refreshTimer = setInterval(() => {
      this.refresh();
    }, SERVER_POLL_MS);
  }

  async refresh(): Promise<void> {
    if (this._fetching) return;
    this._fetching = true;

    try {
      const resp = await fetch(`${SERVER_URL}/api/trending`, {
        signal: AbortSignal.timeout(5000),
      });

      if (resp.ok) {
        const data = await resp.json();
        this.hashtags = data.hashtags || [];
        this.posts = data.posts || [];
        this._lastFetchedAt = data.lastUpdated || Date.now();
        this._serverAvailable = true;

        // Pre-fetch profiles for trending post authors
        for (const post of this.posts) {
          Profiles.request(post.pubkey);
        }

        this.onUpdate?.();
        return;
      }
    } catch {
      console.warn('[Trending] Server unavailable, falling back to client computation');
      this._serverAvailable = false;
    } finally {
      this._fetching = false;
    }

    // Fallback: compute client-side if server is unreachable
    await this._refreshClientSide();
  }

  /**
   * Original client-side trending computation, kept as a fallback
   * when the server API is unavailable.
   */
  private async _refreshClientSide(): Promise<void> {
    // Dynamic imports to avoid loading relay/wot modules when server is available
    const { Relay } = await import('./relay');
    const { WoT } = await import('./wot');
    const { Mute } = await import('./mute');

    // Wait for relay pool to be ready (up to 10 seconds)
    let pool = Relay.pool;
    if (!pool) {
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1000));
        pool = Relay.pool;
        if (pool) break;
      }
      if (!pool) return;
    }

    const urls = Relay.getUrls();
    if (urls.length === 0) return;

    this._fetching = true;

    try {
      const now = Math.floor(Date.now() / 1000);
      const since = now - LOOKBACK_SECONDS;

      const notes = await pool!.querySync(
        urls,
        { kinds: [1], since, limit: 500 } as any
      ) as NostrEvent[];

      const reactions = await pool!.querySync(
        urls,
        { kinds: [7], since, limit: 1000 } as any
      ) as NostrEvent[];

      const filteredNotes = notes.filter((n) => !Mute.isMuted(n.pubkey));

      const allPubkeys = [...new Set(filteredNotes.map((n) => n.pubkey))];
      if (allPubkeys.length > 0) {
        await WoT.scoreBatch(allPubkeys);
      }

      const trustedNotes = filteredNotes.filter((n) => {
        const trust = WoT.cache.get(n.pubkey);
        if (!trust) return false;
        return trust.trusted && trust.distance <= 3;
      });

      const source = trustedNotes.length > 0 ? trustedNotes : filteredNotes;
      this.hashtags = this._calculateTrendingHashtags(source);
      this.posts = this._calculateTrendingPosts(source, reactions);

      for (const post of this.posts) {
        Profiles.request(post.pubkey);
      }

      this._lastFetchedAt = Date.now();
      this.onUpdate?.();
    } catch (err) {
      console.warn('[Trending] Client-side refresh also failed:', err);
    } finally {
      this._fetching = false;
    }
  }

  get lastFetchedAt(): number {
    return this._lastFetchedAt;
  }

  get isFetching(): boolean {
    return this._fetching;
  }

  get isUsingServer(): boolean {
    return this._serverAvailable;
  }

  private _calculateTrendingHashtags(notes: NostrEvent[]): TrendingHashtag[] {
    const tagCounts = new Map<string, number>();

    for (const note of notes) {
      const seen = new Set<string>();
      for (const tag of note.tags) {
        if (tag[0] === 't' && tag[1]) {
          const normalized = tag[1].toLowerCase().trim();
          if (normalized && !seen.has(normalized)) {
            seen.add(normalized);
            tagCounts.set(normalized, (tagCounts.get(normalized) || 0) + 1);
          }
        }
      }
    }

    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_HASHTAGS);
  }

  private _calculateTrendingPosts(
    notes: NostrEvent[],
    reactions: NostrEvent[]
  ): TrendingPost[] {
    const noteMap = new Map<string, NostrEvent>();
    for (const note of notes) {
      noteMap.set(note.id, note);
    }

    const reactionCounts = new Map<string, number>();
    for (const reaction of reactions) {
      for (const tag of reaction.tags) {
        if (tag[0] === 'e' && tag[1]) {
          const targetId = tag[1];
          if (noteMap.has(targetId)) {
            reactionCounts.set(targetId, (reactionCounts.get(targetId) || 0) + 1);
          }
        }
      }
    }

    const replyCounts = new Map<string, number>();
    for (const note of notes) {
      for (const tag of note.tags) {
        if (tag[0] === 'e' && tag[1]) {
          const parentId = tag[1];
          if (noteMap.has(parentId)) {
            replyCounts.set(parentId, (replyCounts.get(parentId) || 0) + 1);
          }
        }
      }
    }

    const scored: TrendingPost[] = [];
    for (const [id, note] of noteMap) {
      const reactionCount = reactionCounts.get(id) || 0;
      const replyCount = replyCounts.get(id) || 0;
      const totalInteractions = reactionCount + replyCount;

      if (totalInteractions > 0) {
        scored.push({
          id,
          pubkey: note.pubkey,
          content: note.content,
          created_at: note.created_at,
          reactionCount,
          replyCount,
          totalInteractions,
        });
      }
    }

    return scored
      .sort((a, b) => b.totalInteractions - a.totalInteractions)
      .slice(0, TOP_POSTS);
  }

  destroy(): void {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    this._started = false;
  }
}

export const Trending = new TrendingService();
