import type { NostrEvent, Note, SortMode } from '@/types/nostr';
import { getSettings } from './settings';
import { WoT } from './wot';
import { Mute } from './mute';
import { getReplyToId } from '@/utils/nip10';

export function processEvent(event: NostrEvent): Note {
  const trust = WoT.cache.get(event.pubkey) || {
    score: 0,
    distance: Infinity,
    trusted: false,
    paths: 0,
  };

  const settings = getSettings();
  const trustWeight = settings.trustWeight;
  const recencyWeight = 1 - trustWeight;
  const maxAge = settings.timeWindow * 60 * 60;

  const now = Math.floor(Date.now() / 1000);
  const ageSeconds = now - event.created_at;
  const recencyScore = Math.max(0, 1 - ageSeconds / maxAge);
  const combinedScore = trust.score * trustWeight + recencyScore * recencyWeight;

  const replyTo = getReplyToId(event.tags || []);

  return {
    id: event.id,
    pubkey: event.pubkey,
    content: event.content,
    created_at: event.created_at,
    tags: event.tags || [],
    trustScore: trust.score,
    distance: trust.distance,
    trusted: trust.trusted,
    paths: trust.paths,
    combinedScore,
    replyTo,
  };
}

export function filterNotes(
  notes: Note[],
  options: {
    trustedOnly: boolean;
    maxHops: number;
    trustThreshold: number;
    showBookmarks?: boolean;
    bookmarkIds?: Set<string>;
  }
): Note[] {
  if (options.showBookmarks && options.bookmarkIds) {
    return notes.filter((n) => options.bookmarkIds!.has(n.id));
  }

  return notes.filter((n) => {
    if (Mute.isMuted(n.pubkey)) return false;
    if (options.trustedOnly) {
      if (!n.trusted || n.distance > options.maxHops) return false;
    }
    if (options.trustThreshold > 0 && n.trustScore * 100 < options.trustThreshold)
      return false;
    return true;
  });
}

export function sortNotes(notes: Note[], mode: SortMode): Note[] {
  const sorted = [...notes];
  switch (mode) {
    case 'trust-desc':
      return sorted.sort((a, b) => {
        if (a.trusted !== b.trusted) return a.trusted ? -1 : 1;
        return b.combinedScore - a.combinedScore;
      });
    case 'trust-asc':
      return sorted.sort((a, b) => {
        if (a.trusted !== b.trusted) return a.trusted ? 1 : -1;
        return a.combinedScore - b.combinedScore;
      });
    case 'newest':
      return sorted.sort((a, b) => b.created_at - a.created_at);
    case 'oldest':
      return sorted.sort((a, b) => a.created_at - b.created_at);
    case 'random':
      for (let i = sorted.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      }
      return sorted;
    default:
      return sorted;
  }
}
