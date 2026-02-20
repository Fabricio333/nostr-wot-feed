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
  showingBookmarks: boolean;
  feedMode: FeedMode;
  followsTick: number;
  relayStatus: 'connecting' | 'connected' | 'eose' | 'disconnected';
  wotStatus: { hasExtension: boolean };

  addEvent: (event: NostrEvent) => Promise<void>;
  setEose: () => void;
  setRelayStatus: (status: FeedStore['relayStatus']) => void;
  setWotStatus: (status: { hasExtension: boolean }) => void;
  setFeedMode: (mode: FeedMode) => void;
  bumpFollowsTick: () => void;
  loadMore: () => void;
  refresh: () => void;
  toggleBookmarks: () => void;

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
  showingBookmarks: false,
  feedMode: 'following' as FeedMode,
  followsTick: 0,
  relayStatus: 'connecting',
  wotStatus: { hasExtension: false },

  addEvent: async (event: NostrEvent) => {
    const state = get();
    if (state.seenIds.has(event.id)) return;

    const newSeenIds = new Set(state.seenIds);
    newSeenIds.add(event.id);
    const newAuthors = new Set(state.authors);
    newAuthors.add(event.pubkey);

    // Request profile (non-blocking, batched)
    Profiles.request(event.pubkey);

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

    const updates: Partial<FeedStore> = {
      notes: finalNotes,
      notesById: finalNotesById,
      seenIds: newSeenIds,
      authors: newAuthors,
      totalReceived: state.totalReceived + 1,
    };

    if (state.initialRenderDone) {
      updates.pendingCount = state.pendingCount + 1;
    }

    set(updates as any);

    // Score WoT asynchronously — update note trust data when ready
    if (!WoT.cache.has(event.pubkey)) {
      WoT.scoreBatch([event.pubkey]).then(() => {
        const trust = WoT.cache.get(event.pubkey);
        if (trust && (trust.trusted || trust.score > 0)) {
          const current = get();
          const existing = current.notesById.get(note.id);
          if (existing) {
            const updated: Note = {
              ...existing,
              trustScore: trust.score,
              distance: trust.distance,
              trusted: trust.trusted,
              paths: trust.paths,
            };
            const updatedNotes = current.notes.map((n) =>
              n.id === note.id ? updated : n
            );
            const updatedById = new Map(current.notesById);
            updatedById.set(note.id, updated);
            set({ notes: updatedNotes, notesById: updatedById } as any);
          }
        }
      });
    }
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
    set({
      pendingCount: 0,
      displayLimit: PAGE_SIZE,
    });
  },

  setFeedMode: (mode: FeedMode) => {
    set({ feedMode: mode, displayLimit: PAGE_SIZE });
  },

  bumpFollowsTick: () => {
    set((state) => ({ followsTick: state.followsTick + 1 }));
  },

  toggleBookmarks: () => {
    set((state) => ({ showingBookmarks: !state.showingBookmarks }));
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

    const sortMode = state.feedMode === 'following' ? 'newest' : settings.sortMode;
    return sortNotes(filtered, sortMode);
  },
}));
