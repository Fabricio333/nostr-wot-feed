import { fetchRecentNotes, fetchRecentReactions, type NostrEvent } from '@/lib/nostr/serverPool';
import { filterTrustedPubkeys } from '@/lib/wot/serverWot';
import { TOP_HASHTAGS, TOP_POSTS, REFRESH_INTERVAL_MS } from '@/constants/trending';

export interface TrendingHashtag {
  tag: string;
  count: number;
}

export interface TrendingPost {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  reactionCount: number;
  replyCount: number;
  totalInteractions: number;
}

export interface TrendingData {
  hashtags: TrendingHashtag[];
  posts: TrendingPost[];
  lastUpdated: number;
  noteCount: number;
  trustedAuthorCount: number;
}

let currentData: TrendingData = {
  hashtags: [],
  posts: [],
  lastUpdated: 0,
  noteCount: 0,
  trustedAuthorCount: 0,
};

let fetching = false;

export function getTrendingData(): TrendingData {
  return currentData;
}

export async function refreshTrending(): Promise<void> {
  if (fetching) return;
  fetching = true;

  try {
    console.log('[Trending] Starting refresh...');
    const [notes, reactions] = await Promise.all([
      fetchRecentNotes(),
      fetchRecentReactions(),
    ]);
    console.log(
      `[Trending] Fetched ${notes.length} notes, ${reactions.length} reactions`,
    );

    const allPubkeys = [...new Set(notes.map((n) => n.pubkey))];

    // Filter by WoT trust using nostr-wot-sdk oracle (anchored to reference pubkey)
    const trustedPubkeys = await filterTrustedPubkeys(allPubkeys);
    console.log(
      `[Trending] ${trustedPubkeys.size}/${allPubkeys.length} authors are WoT-trusted`,
    );

    const trustedNotes = notes.filter((n) => trustedPubkeys.has(n.pubkey));

    // Fall back to all notes if no trusted notes found
    const source = trustedNotes.length > 0 ? trustedNotes : notes;

    const hashtags = calculateTrendingHashtags(source);
    const posts = calculateTrendingPosts(source, reactions);

    currentData = {
      hashtags,
      posts,
      lastUpdated: Date.now(),
      noteCount: notes.length,
      trustedAuthorCount: trustedPubkeys.size,
    };

    console.log(
      `[Trending] Refresh complete: ${hashtags.length} hashtags, ${posts.length} posts`,
    );
  } catch (err) {
    console.error('[Trending] Refresh failed:', err);
  } finally {
    fetching = false;
  }
}

// Ported from src/services/trending.ts
function calculateTrendingHashtags(notes: NostrEvent[]): TrendingHashtag[] {
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

// Ported from src/services/trending.ts
function calculateTrendingPosts(
  notes: NostrEvent[],
  reactions: NostrEvent[],
): TrendingPost[] {
  const noteMap = new Map<string, NostrEvent>();
  for (const note of notes) {
    noteMap.set(note.id, note);
  }

  const reactionCounts = new Map<string, number>();
  for (const reaction of reactions) {
    for (const tag of reaction.tags) {
      if (tag[0] === 'e' && tag[1] && noteMap.has(tag[1])) {
        reactionCounts.set(tag[1], (reactionCounts.get(tag[1]) || 0) + 1);
      }
    }
  }

  const replyCounts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.tags) {
      if (tag[0] === 'e' && tag[1] && noteMap.has(tag[1])) {
        replyCounts.set(tag[1], (replyCounts.get(tag[1]) || 0) + 1);
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

let started = false;
export function ensureTrendingRefresh(): void {
  if (started) return;
  started = true;
  refreshTrending();
  setInterval(() => refreshTrending(), REFRESH_INTERVAL_MS);
}
