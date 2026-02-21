import type { NostrEvent, TrendingHashtag, TrendingPost } from '@/types/nostr';
import { Profiles } from './profiles';
import { Relay } from './relay';
import { WoT } from './wot';
import { Mute } from './mute';

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const LOOKBACK_SECONDS = 4 * 60 * 60; // 4 hours of notes for better sample
const TOP_HASHTAGS = 5;
const TOP_POSTS = 5;

class TrendingService {
  private _refreshTimer: ReturnType<typeof setInterval> | null = null;
  private _lastFetchedAt: number = 0;
  private _fetching = false;
  private _started = false;

  hashtags: TrendingHashtag[] = [];
  posts: TrendingPost[] = [];

  onUpdate: (() => void) | null = null;

  async start(): Promise<void> {
    if (this._started) return;
    this._started = true;

    await this.refresh();

    this._refreshTimer = setInterval(() => {
      this.refresh();
    }, REFRESH_INTERVAL_MS);
  }

  async refresh(): Promise<void> {
    if (this._fetching) return;
    const pool = Relay.pool;
    if (!pool) return;
    this._fetching = true;

    const urls = Relay.getUrls();
    if (urls.length === 0) {
      this._fetching = false;
      return;
    }

    try {
      const now = Math.floor(Date.now() / 1000);
      const since = now - LOOKBACK_SECONDS;

      // Fetch kind 1 (text notes) from the lookback window
      const notes = await pool.querySync(
        urls,
        { kinds: [1], since, limit: 500 } as any
      ) as NostrEvent[];

      // Fetch kind 7 (reactions) for the same window
      const reactions = await pool.querySync(
        urls,
        { kinds: [7], since, limit: 1000 } as any
      ) as NostrEvent[];

      // Filter out muted authors
      const filteredNotes = notes.filter((n) => !Mute.isMuted(n.pubkey));

      // Score all unique authors for WoT
      const allPubkeys = [...new Set(filteredNotes.map((n) => n.pubkey))];
      if (allPubkeys.length > 0) {
        await WoT.scoreBatch(allPubkeys);
      }

      // Only count hashtags/posts from WoT-trusted authors (if any trust data exists)
      const trustedNotes = filteredNotes.filter((n) => {
        const trust = WoT.cache.get(n.pubkey);
        // If no WoT data at all (no extension, no oracle), include everyone
        if (!trust) return true;
        return trust.trusted;
      });

      // Use trusted notes for hashtags, fall back to all filtered if no trusted notes
      const hashtagSource = trustedNotes.length > 0 ? trustedNotes : filteredNotes;
      this.hashtags = this._calculateTrendingHashtags(hashtagSource);
      this.posts = this._calculateTrendingPosts(trustedNotes.length > 0 ? trustedNotes : filteredNotes, reactions);

      // Pre-fetch profiles for trending post authors
      for (const post of this.posts) {
        Profiles.request(post.pubkey);
      }

      this._lastFetchedAt = Date.now();
      this.onUpdate?.();
    } catch (err) {
      console.warn('[Trending] refresh failed:', err);
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

    // Count reactions per note (kind 7 references target via 'e' tag)
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

    // Count replies (kind 1 notes referencing another note via 'e' tag)
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
