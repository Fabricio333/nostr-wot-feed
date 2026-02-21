import { create } from 'zustand';
import type { NostrEvent, Note } from '@/types/nostr';
import { WoT } from '@/services/wot';
import { Profiles } from '@/services/profiles';
import { ParentNotes } from '@/services/parentNotes';
import { Follows } from '@/services/follows';
import { processEvent, filterNotes, sortNotes } from '@/services/feed';
import { Bookmarks } from '@/services/bookmarks';
import { getSettings } from '@/services/settings';

const PAGE_SIZE = 20;

export type FeedMode = 'following' | 'global';

// Seeded PRNG (mulberry32)
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface FeedStore {
  notes: Note[];
  notesById: Map<string, Note>;
  seenIds: Set<string>;
  authors: Set<string>;
  totalReceived: number;
  displayLimit: number;
  eoseReceived: boolean;
  initialRenderDone: boolean;
  pendingCount: number;
  pendingEvents: NostrEvent[];
  showingBookmarks: boolean;
  feedMode: FeedMode;
  followsTick: number;
  relayStatus: 'connecting' | 'connected' | 'eose' | 'disconnected';
  wotStatus: { hasExtension: boolean };
  wotScoringDone: boolean;
  shuffleSeed: number;

  addEvent: (event: NostrEvent) => void;
  setEose: () => void;
  setRelayStatus: (status: FeedStore['relayStatus']) => void;
  setWotStatus: (status: { hasExtension: boolean }) => void;
  setFeedMode: (mode: FeedMode) => void;
  bumpFollowsTick: () => void;
  loadMore: () => void;
  refresh: () => void;
  toggleBookmarks: () => void;
  scoreAllNotes: () => Promise<void>;

  getFilteredNotes: () => Note[];
}

export const useFeedStore = create<FeedStore>((set, get) => ({
  notes: [],
  notesById: new Map(),
  seenIds: new Set(),
  authors: new Set(),
  totalReceived: 0,
  displayLimit: PAGE_SIZE,
  eoseReceived: false,
  initialRenderDone: false,
  pendingCount: 0,
  pendingEvents: [],
  showingBookmarks: false,
  feedMode: 'following' as FeedMode,
  followsTick: 0,
  relayStatus: 'connecting',
  wotStatus: { hasExtension: false },
  wotScoringDone: false,
  shuffleSeed: Date.now(),

  addEvent: (event: NostrEvent) => {
    const state = get();
    if (state.seenIds.has(event.id)) return;

    const newSeenIds = new Set(state.seenIds);
    newSeenIds.add(event.id);
    const newAuthors = new Set(state.authors);
    newAuthors.add(event.pubkey);

    // Request profile (non-blocking, batched)
    Profiles.request(event.pubkey);

    // After initial render, buffer live events instead of adding to notes[]
    if (state.initialRenderDone) {
      set({
        seenIds: newSeenIds,
        authors: newAuthors,
        pendingEvents: [...state.pendingEvents, event],
        pendingCount: state.pendingCount + 1,
        totalReceived: state.totalReceived + 1,
      } as any);
      return;
    }

    // Process event immediately with whatever WoT data is cached
    const note = processEvent(event);
    if (note.replyTo) ParentNotes.request(note.replyTo);

    const newNotes = [...state.notes, note];
    const newNotesById = new Map(state.notesById);
    newNotesById.set(note.id, note);

    const maxNotes = getSettings().maxNotes;
    let finalNotes = newNotes;
    let finalNotesById = newNotesById;
    if (finalNotes.length > maxNotes) {
      finalNotes.sort((a, b) => b.combinedScore - a.combinedScore);
      finalNotes = finalNotes.slice(0, maxNotes);
      finalNotesById = new Map();
      for (const n of finalNotes) finalNotesById.set(n.id, n);
    }

    set({
      notes: finalNotes,
      notesById: finalNotesById,
      seenIds: newSeenIds,
      authors: newAuthors,
      totalReceived: state.totalReceived + 1,
    } as any);
  },

  setEose: () => {
    set({
      eoseReceived: true,
      initialRenderDone: true,
      displayLimit: PAGE_SIZE,
    });
  },

  setRelayStatus: (status) => set({ relayStatus: status }),

  setWotStatus: (status) => set({ wotStatus: status }),

  loadMore: () => {
    const state = get();
    const filtered = state.getFilteredNotes();
    if (state.displayLimit >= filtered.length) return;
    set({ displayLimit: state.displayLimit + PAGE_SIZE });
  },

  refresh: () => {
    const state = get();
    const pending = state.pendingEvents;

    if (pending.length > 0) {
      // Process buffered events into notes
      let newNotes = [...state.notes];
      const newNotesById = new Map(state.notesById);

      for (const event of pending) {
        const note = processEvent(event);
        if (note.replyTo) ParentNotes.request(note.replyTo);
        newNotes.push(note);
        newNotesById.set(note.id, note);
      }

      const maxNotes = getSettings().maxNotes;
      if (newNotes.length > maxNotes) {
        newNotes.sort((a, b) => b.combinedScore - a.combinedScore);
        newNotes = newNotes.slice(0, maxNotes);
      }

      set({
        notes: newNotes,
        notesById: newNotesById,
        pendingEvents: [],
        pendingCount: 0,
        displayLimit: PAGE_SIZE,
        shuffleSeed: Date.now(),
      } as any);
    } else {
      set({
        pendingCount: 0,
        displayLimit: PAGE_SIZE,
        shuffleSeed: Date.now(),
      });
    }
  },

  setFeedMode: (mode: FeedMode) => {
    set({ feedMode: mode, displayLimit: PAGE_SIZE, shuffleSeed: Date.now() });
  },

  bumpFollowsTick: () => {
    set((state) => ({ followsTick: state.followsTick + 1 }));
  },

  toggleBookmarks: () => {
    set((state) => ({ showingBookmarks: !state.showingBookmarks }));
  },

  scoreAllNotes: async () => {
    const state = get();
    const allPubkeys = [...state.authors];

    if (allPubkeys.length > 0) {
      await WoT.scoreBatch(allPubkeys);
    }

    // Re-process all notes with updated trust data
    const current = get();
    const updatedNotes = current.notes.map((note) => {
      const trust = WoT.cache.get(note.pubkey);
      if (!trust) return note;

      const settings = getSettings();
      const trustWeight = settings.trustWeight;
      const recencyWeight = 1 - trustWeight;
      const maxAge = settings.timeWindow * 60 * 60;
      const now = Math.floor(Date.now() / 1000);
      const ageSeconds = now - note.created_at;
      const recencyScore = Math.max(0, 1 - ageSeconds / maxAge);
      const combinedScore = trust.score * trustWeight + recencyScore * recencyWeight;

      return {
        ...note,
        trustScore: trust.score,
        distance: trust.distance,
        trusted: trust.trusted,
        paths: trust.paths,
        combinedScore,
      };
    });

    const updatedById = new Map<string, Note>();
    for (const n of updatedNotes) updatedById.set(n.id, n);

    set({
      notes: updatedNotes,
      notesById: updatedById,
      wotScoringDone: true,
    } as any);
  },

  getFilteredNotes: () => {
    const state = get();
    const settings = getSettings();

    // Pre-filter by feed mode
    let pool = state.notes;
    if (state.feedMode === 'following') {
      const followSet = Follows.following;
      pool = pool.filter((n) => followSet.has(n.pubkey));
    }

    const filtered = filterNotes(pool, {
      trustedOnly: state.feedMode === 'global' ? settings.trustedOnly : false,
      maxHops: settings.maxHops,
      trustThreshold: state.feedMode === 'global' ? settings.trustThreshold : 0,
      showBookmarks: state.showingBookmarks,
      bookmarkIds: state.showingBookmarks
        ? new Set(Bookmarks.list.keys())
        : undefined,
    });

    // For following tab, sort by newest
    if (state.feedMode === 'following') {
      return sortNotes(filtered, 'newest');
    }

    // For global tab, apply weighted shuffle with stable seed
    const rng = mulberry32(state.shuffleSeed);
    const shuffled = filtered.map((note) => ({
      note,
      priority: note.combinedScore + rng() * 0.3,
    }));
    shuffled.sort((a, b) => b.priority - a.priority);
    return shuffled.map((s) => s.note);
  },
}));
