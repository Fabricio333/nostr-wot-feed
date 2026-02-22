import { create } from 'zustand';
import type { NostrEvent, Note } from '@/types/nostr';
import { WoT } from '@/services/wot';
import { Profiles } from '@/services/profiles';
import { ParentNotes } from '@/services/parentNotes';
import { Follows } from '@/services/follows';
import { Relay } from '@/services/relay';
import { processEvent, filterNotes, sortNotes } from '@/services/feed';
import { Bookmarks } from '@/services/bookmarks';
import { getSettings } from '@/services/settings';

const PAGE_SIZE = 20;
const FETCH_COOLDOWN_MS = 2000;
const BATCH_FLUSH_INTERVAL = 150; // ms between batch flushes
const BATCH_MIN_SIZE = 5; // flush when buffer reaches this size
const MAX_LOOKBACK_DAYS = 30;

// ── sessionStorage cache for seenIds ──
// seenIds prevents duplicate notes across pagination, live events, and page
// reloads within a single browser tab session. Uses sessionStorage (not
// localStorage) so IDs clear when the tab closes—no stale data across sessions.
// MAX_CACHED_IDS (5000) caps the Set size to prevent unbounded memory growth.
// Persistence: saved on beforeunload + a 30-second interval as a safety net.
// Dedup flow: addEvent() checks both the store's seenIds and the module-level
// bufferSeenIds (used during initial batched streaming before EOSE).
const SEEN_IDS_KEY = 'wot-feed-seen-ids';
const MAX_CACHED_IDS = 5000;

function loadCachedSeenIds(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SEEN_IDS_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      return new Set(arr.slice(-MAX_CACHED_IDS));
    }
  } catch { /* ignore */ }
  return new Set();
}

function saveCachedSeenIds(ids: Set<string>): void {
  try {
    const arr = [...ids].slice(-MAX_CACHED_IDS);
    sessionStorage.setItem(SEEN_IDS_KEY, JSON.stringify(arr));
  } catch { /* quota exceeded */ }
}

// sessionStorage save listeners are set up after the store is created (bottom of file)

export type FeedMode = 'following' | 'global';

// ── Module-level event batching ──
// During initial streaming (before EOSE), events are batched so the UI
// renders in groups of ~10 instead of one-by-one.
let eventBuffer: NostrEvent[] = [];
let bufferSeenIds = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (eventBuffer.length >= BATCH_MIN_SIZE) {
    if (flushTimer) clearTimeout(flushTimer);
    flushEventBuffer();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flushEventBuffer, BATCH_FLUSH_INTERVAL);
  }
}

function flushEventBuffer() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (eventBuffer.length === 0) return;

  const events = eventBuffer;
  eventBuffer = [];

  const state = useFeedStore.getState();
  const newNotes = [...state.notes];
  const newNotesById = new Map(state.notesById);
  const newSeenIds = new Set(state.seenIds);
  const newAuthors = new Set(state.authors);

  // Merge buffer dedup set into store
  for (const id of bufferSeenIds) newSeenIds.add(id);
  bufferSeenIds = new Set();

  for (const event of events) {
    newAuthors.add(event.pubkey);
    Profiles.request(event.pubkey);
    const note = processEvent(event);
    if (note.replyTo) ParentNotes.request(note.replyTo);
    newNotes.push(note);
    newNotesById.set(note.id, note);
  }

  const maxNotes = getSettings().maxNotes;
  let finalNotes = newNotes;
  let finalNotesById = newNotesById;
  if (finalNotes.length > maxNotes) {
    finalNotes.sort((a, b) => b.combinedScore - a.combinedScore);
    finalNotes = finalNotes.slice(0, maxNotes);
    finalNotesById = new Map();
    for (const n of finalNotes) finalNotesById.set(n.id, n);
  }

  useFeedStore.setState({
    notes: finalNotes,
    notesById: finalNotesById,
    seenIds: newSeenIds,
    authors: newAuthors,
    totalReceived: state.totalReceived + events.length,
  } as any);
}

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
  newNotesSinceScroll: number;
  showingBookmarks: boolean;
  feedMode: FeedMode;
  followsTick: number;
  relayStatus: 'connecting' | 'connected' | 'eose' | 'disconnected';
  wotStatus: { hasExtension: boolean };
  wotScoringDone: boolean;
  shuffleSeed: number;

  // Pagination state
  loadingMore: boolean;
  hasMoreNotes: boolean;
  fetchCooldownUntil: number;
  isScrolledDown: boolean;

  addEvent: (event: NostrEvent) => void;
  setEose: () => void;
  setRelayStatus: (status: FeedStore['relayStatus']) => void;
  setWotStatus: (status: { hasExtension: boolean }) => void;
  setFeedMode: (mode: FeedMode) => void;
  bumpFollowsTick: () => void;
  loadMore: () => void;
  fetchMore: () => Promise<void>;
  resetNewNotesSinceScroll: () => void;
  revealNewNotes: () => void;
  setIsScrolledDown: (scrolled: boolean) => void;
  pullRefresh: () => Promise<void>;
  toggleBookmarks: () => void;
  scoreAllNotes: () => Promise<void>;

  getFilteredNotes: () => Note[];
}

export const useFeedStore = create<FeedStore>((set, get) => ({
  notes: [],
  notesById: new Map(),
  seenIds: loadCachedSeenIds(),
  authors: new Set(),
  totalReceived: 0,
  displayLimit: PAGE_SIZE,
  eoseReceived: false,
  initialRenderDone: false,
  newNotesSinceScroll: 0,
  showingBookmarks: false,
  feedMode: 'following' as FeedMode,
  followsTick: 0,
  relayStatus: 'connecting',
  wotStatus: { hasExtension: false },
  wotScoringDone: false,
  shuffleSeed: Date.now(),

  loadingMore: false,
  hasMoreNotes: true,
  fetchCooldownUntil: 0,
  isScrolledDown: false,

  addEvent: (event: NostrEvent) => {
    const state = get();
    // Dedup against both store and batch buffer
    if (state.seenIds.has(event.id) || bufferSeenIds.has(event.id)) return;

    // After initial render, insert new notes directly into the feed
    if (state.initialRenderDone) {
      const newSeenIds = new Set(state.seenIds);
      newSeenIds.add(event.id);
      const newAuthors = new Set(state.authors);
      newAuthors.add(event.pubkey);
      Profiles.request(event.pubkey);

      const note = processEvent(event);
      if (note.replyTo) ParentNotes.request(note.replyTo);

      const newNotes = [note, ...state.notes];
      const newNotesById = new Map(state.notesById);
      newNotesById.set(note.id, note);

      // Enforce maxNotes cap
      const maxNotes = getSettings().maxNotes;
      let finalNotes = newNotes;
      let finalNotesById = newNotesById;
      if (finalNotes.length > maxNotes) {
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
        // When at the top, auto-expand so new notes appear immediately.
        // When scrolled down, only bump the counter for the FAB.
        ...(state.isScrolledDown
          ? { newNotesSinceScroll: state.newNotesSinceScroll + 1 }
          : { displayLimit: state.displayLimit + 1 }),
      } as any);

      // Background: score unknown pubkeys and update the note with trust data
      if (!WoT.cache.has(event.pubkey)) {
        WoT.scoreBatch([event.pubkey]).then(() => {
          const s = get();
          const trust = WoT.cache.get(event.pubkey);
          if (!trust) return;
          const existing = s.notesById.get(event.id);
          if (!existing) return;

          const settings = getSettings();
          const trustWeight = settings.trustWeight;
          const recencyWeight = 1 - trustWeight;
          const maxAge = settings.timeWindow * 60 * 60;
          const nowTs = Math.floor(Date.now() / 1000);
          const ageSeconds = nowTs - existing.created_at;
          const recencyScore = Math.max(0, 1 - ageSeconds / maxAge);
          const combinedScore = trust.score * trustWeight + recencyScore * recencyWeight;

          const updated = {
            ...existing,
            trustScore: trust.score,
            distance: trust.distance,
            trusted: trust.trusted,
            paths: trust.paths,
            combinedScore,
          };

          const updatedNotes = s.notes.map((n) => (n.id === event.id ? updated : n));
          const updatedById = new Map(s.notesById);
          updatedById.set(event.id, updated);
          set({ notes: updatedNotes, notesById: updatedById } as any);
        });
      }

      return;
    }

    // During initial streaming: batch events for group rendering
    bufferSeenIds.add(event.id);
    eventBuffer.push(event);
    scheduleFlush();
  },

  setEose: () => {
    // Flush any remaining batched events before marking EOSE
    flushEventBuffer();
    set({
      eoseReceived: true,
      initialRenderDone: true,
    });
  },

  setRelayStatus: (status) => set({ relayStatus: status }),

  setWotStatus: (status) => set({ wotStatus: status }),

  /**
   * Bump the display limit to show more already-loaded notes.
   * If we've shown everything, trigger a relay fetch for older notes.
   */
  loadMore: () => {
    const state = get();
    const filtered = state.getFilteredNotes();
    if (state.displayLimit < filtered.length) {
      // Still have loaded notes to display
      set({ displayLimit: state.displayLimit + PAGE_SIZE });
    } else if (!state.loadingMore && state.hasMoreNotes) {
      // Ran out of loaded notes — fetch more from relays
      state.fetchMore();
    }
  },

  /**
   * Fetch older notes from relays. Throttled to avoid relay saturation.
   */
  fetchMore: async () => {
    const state = get();
    if (state.loadingMore || !state.hasMoreNotes) return;

    // Throttle: enforce cooldown between fetches
    const now = Date.now();
    if (now < state.fetchCooldownUntil) return;

    set({ loadingMore: true, fetchCooldownUntil: now + FETCH_COOLDOWN_MS });

    // Find the oldest note timestamp as cursor
    const oldest = state.notes.reduce(
      (min, n) => Math.min(min, n.created_at),
      Infinity
    );

    if (oldest === Infinity) {
      set({ loadingMore: false, hasMoreNotes: false });
      return;
    }

    // Fetch from relay based on feed mode
    let events: NostrEvent[];
    if (state.feedMode === 'following') {
      const pubkeys = Array.from(Follows.following);
      events = await Relay.fetchOlderFollowingNotes(pubkeys, oldest);
    } else {
      events = await Relay.fetchOlderNotes(oldest);
    }

    if (events.length === 0) {
      // Auto-extend time window by 7 days and retry
      const nowTs = Math.floor(Date.now() / 1000);
      const extendedSince = oldest - 7 * 24 * 60 * 60;

      // Safety cap: don't look back more than MAX_LOOKBACK_DAYS
      if (nowTs - extendedSince > MAX_LOOKBACK_DAYS * 86400) {
        set({ loadingMore: false, hasMoreNotes: false });
        return;
      }

      let extendedEvents: NostrEvent[];
      if (state.feedMode === 'following') {
        const pubkeys = Array.from(Follows.following);
        extendedEvents = await Relay.fetchOlderFollowingNotes(pubkeys, oldest, 25, extendedSince);
      } else {
        extendedEvents = await Relay.fetchOlderNotes(oldest, 25, extendedSince);
      }

      if (extendedEvents.length === 0) {
        set({ loadingMore: false, hasMoreNotes: false });
        return;
      }
      events = extendedEvents;
    }

    // Bulk add new events
    const current = get();
    const newNotes = [...current.notes];
    const newNotesById = new Map(current.notesById);
    const newSeenIds = new Set(current.seenIds);
    const newAuthors = new Set(current.authors);
    let addedCount = 0;

    for (const event of events) {
      if (newSeenIds.has(event.id)) continue;
      newSeenIds.add(event.id);
      newAuthors.add(event.pubkey);
      Profiles.request(event.pubkey);

      const note = processEvent(event);
      if (note.replyTo) ParentNotes.request(note.replyTo);
      newNotes.push(note);
      newNotesById.set(note.id, note);
      addedCount++;
    }

    set({
      notes: newNotes,
      notesById: newNotesById,
      seenIds: newSeenIds,
      authors: newAuthors,
      loadingMore: false,
      hasMoreNotes: addedCount > 0,
      // Don't bump displayLimit — let loadMore reveal them via scroll
    } as any);

    // Background: score new authors that aren't cached yet
    const unscoredPubkeys = [...new Set(events.map((e) => e.pubkey))].filter(
      (p) => !WoT.cache.has(p)
    );
    if (unscoredPubkeys.length > 0) {
      WoT.scoreBatch(unscoredPubkeys).then(() => {
        // Re-score the newly added notes with trust data
        const s = get();
        const settings = getSettings();
        const trustWeight = settings.trustWeight;
        const recencyWeight = 1 - trustWeight;
        const maxAge = settings.timeWindow * 60 * 60;
        const nowTs = Math.floor(Date.now() / 1000);

        const updatedNotes = s.notes.map((note) => {
          const trust = WoT.cache.get(note.pubkey);
          if (!trust || note.trusted) return note;
          const ageSeconds = nowTs - note.created_at;
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
        set({ notes: updatedNotes, notesById: updatedById } as any);
      });
    }
  },

  resetNewNotesSinceScroll: () => set({ newNotesSinceScroll: 0 }),

  revealNewNotes: () => {
    const state = get();
    set({
      displayLimit: state.displayLimit + state.newNotesSinceScroll,
      newNotesSinceScroll: 0,
    });
  },

  setIsScrolledDown: (scrolled: boolean) => set({ isScrolledDown: scrolled }),

  pullRefresh: async () => {
    // Re-establish relay subscriptions to fetch fresh notes
    set({
      initialRenderDone: false,
      eoseReceived: false,
      wotScoringDone: false,
      displayLimit: PAGE_SIZE,
      shuffleSeed: Date.now(),
      hasMoreNotes: true,
    });
    Relay.reconnect();
  },

  setFeedMode: (mode: FeedMode) => {
    set({
      feedMode: mode,
      displayLimit: PAGE_SIZE,
      shuffleSeed: Date.now(),
      hasMoreNotes: true,
    });
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

    // WoT filtering for global feed:
    // - Only apply trust filters AFTER scoring is done, otherwise all notes
    //   have trusted=false and the filter would show nothing.
    // - Before scoring: show all notes sorted by newest (temporary view).
    // - After scoring: apply full WoT filtering and trust-weighted sorting.
    const isGlobal = state.feedMode === 'global';
    const canApplyTrust = isGlobal && state.wotScoringDone;

    const filtered = filterNotes(pool, {
      trustedOnly: canApplyTrust ? settings.trustedOnly : false,
      maxHops: settings.maxHops,
      trustThreshold: canApplyTrust ? settings.trustThreshold : 0,
      showBookmarks: state.showingBookmarks,
      bookmarkIds: state.showingBookmarks
        ? new Set(Bookmarks.list.keys())
        : undefined,
    });

    // For following tab, sort by newest
    if (state.feedMode === 'following') {
      return sortNotes(filtered, 'newest');
    }

    // Global tab before scoring: sort by newest as placeholder
    if (!state.wotScoringDone) {
      return sortNotes(filtered, 'newest');
    }

    // Global tab after scoring: respect sortMode setting
    if (settings.sortMode && settings.sortMode !== 'trust-desc') {
      return sortNotes(filtered, settings.sortMode);
    }

    // Default: trust-weighted shuffle with stable seed
    const rng = mulberry32(state.shuffleSeed);
    const shuffled = filtered.map((note) => ({
      note,
      priority: note.combinedScore + rng() * 0.3,
    }));
    shuffled.sort((a, b) => b.priority - a.priority);
    return shuffled.map((s) => s.note);
  },
}));

// Persist seenIds to sessionStorage
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    saveCachedSeenIds(useFeedStore.getState().seenIds);
  });
  setInterval(() => {
    saveCachedSeenIds(useFeedStore.getState().seenIds);
  }, 30000);
}
