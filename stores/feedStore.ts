import { create } from 'zustand';
import type { NostrEvent, Note } from '@/types/nostr';
import { WoT } from '@/lib/wot/wot';
import { Profiles } from '@/lib/content/profiles';
import { ParentNotes } from '@/lib/content/parentNotes';
import { Follows } from '@/lib/nostr/follows';
import { Relay } from '@/lib/nostr/relay';
import { processEvent, filterNotes, sortNotes } from '@/lib/wot/feed';
import { Bookmarks } from '@/lib/content/bookmarks';
import { getSettings } from '@/lib/storage/settings';
import { DB } from '@/lib/storage/db';
import { EventBuffer, type FlushReason } from '@/lib/nostr/eventBuffer';

const PAGE_SIZE = 20;
const FETCH_COOLDOWN_MS = 2000;
const MAX_LOOKBACK_DAYS = 30;

export type FeedMode = 'following' | 'global';

// Track which pubkeys came from following subscription so we can tag DB writes correctly
const _followingPubkeys = new Set<string>();
export function markFollowingPubkeys(pubkeys: string[]): void {
  for (const pk of pubkeys) _followingPubkeys.add(pk);
}

// ── Module-level animation tracking ──
// Each note only animates its entry once. Prevents replay on re-sort or re-mount.
const animatedNoteIds = new Set<string>();

export function shouldAnimate(noteId: string): boolean {
  if (animatedNoteIds.has(noteId)) return false;
  animatedNoteIds.add(noteId);
  if (animatedNoteIds.size > 5000) {
    const iter = animatedNoteIds.values();
    for (let i = 0; i < 1000; i++) {
      const val = iter.next().value;
      if (val) animatedNoteIds.delete(val);
    }
  }
  return true;
}

// ── Module-level filtered notes cache ──
let _filteredCache: Note[] | null = null;
let _filteredCacheKey = '';

// ── EventBuffer flush handler ──
// Called synchronously by EventBuffer on flush triggers.
// Processes events and merges into store immediately (verification is optional and async-safe).
function handleBufferFlush(events: NostrEvent[], _reason: FlushReason): void {
  if (events.length === 0) return;

  const state = useFeedStore.getState();
  const newNotes = [...state.notes];
  const newNotesById = new Map(state.notesById);
  const newSeenIds = new Set(state.seenIds);
  const newAuthors = new Set(state.authors);
  const newIds: string[] = [];

  for (const event of events) {
    if (newSeenIds.has(event.id)) continue;
    newSeenIds.add(event.id);
    newIds.push(event.id);
    newAuthors.add(event.pubkey);
    Profiles.request(event.pubkey);

    const note = processEvent(event);
    if (note.replyTo) ParentNotes.request(note.replyTo);
    newNotes.push(note);
    newNotesById.set(note.id, note);
  }

  if (newIds.length === 0) return;

  // Persist to IndexedDB in background (safe — no-ops if DB not ready)
  try {
    DB.addSeenIds(newIds);
    DB.queueEventWrite(events.filter(e => newIds.includes(e.id)).map(e => ({
      id: e.id, pubkey: e.pubkey, kind: e.kind, created_at: e.created_at,
      content: e.content, tags: e.tags, sig: e.sig,
      feedType: _followingPubkeys.has(e.pubkey) ? 'following' as const : 'global' as const,
      storedAt: Math.floor(Date.now() / 1000),
    })));
  } catch {
    // DB not initialized yet — skip persistence, events are in memory
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
  frozenOrder: string[];

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
  seenIds: new Set<string>(),
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
  frozenOrder: [],

  loadingMore: false,
  hasMoreNotes: true,
  fetchCooldownUntil: 0,
  isScrolledDown: false,

  addEvent: (event: NostrEvent) => {
    const state = get();
    // Dedup against both store and event buffer
    if (state.seenIds.has(event.id) || EventBuffer.hasSeen(event.id)) return;

    // After initial render, insert new notes directly into the feed
    if (state.initialRenderDone) {
      const newSeenIds = new Set(state.seenIds);
      newSeenIds.add(event.id);
      const newAuthors = new Set(state.authors);
      newAuthors.add(event.pubkey);
      Profiles.request(event.pubkey);

      // Persist to IndexedDB in background (safe — no-ops if DB not ready)
      try {
        DB.addSeenIds([event.id]);
        DB.queueEventWrite([{
          id: event.id, pubkey: event.pubkey, kind: event.kind, created_at: event.created_at,
          content: event.content, tags: event.tags, sig: event.sig,
          feedType: _followingPubkeys.has(event.pubkey) ? 'following' as const : 'global' as const,
          storedAt: Math.floor(Date.now() / 1000),
        }]);
      } catch {
        // DB not initialized yet
      }

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

    // During initial streaming: add to EventBuffer for batched rendering
    EventBuffer.add(event);
  },

  setEose: () => {
    // Flush remaining buffered events and stop the buffer (events go direct after EOSE)
    EventBuffer.flushAndStop();
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
   * Fetch older notes. Checks IndexedDB cache first, then falls back to relays.
   * Throttled to avoid relay saturation.
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

    // Step 1: Try IndexedDB cache first
    const feedType = state.feedMode === 'following' ? 'following' as const : 'global' as const;
    try {
      const cachedEvents = await DB.getEventsByFeed(feedType, 25, oldest);
      if (cachedEvents.length > 0) {
        const current = get();
        const newNotes = [...current.notes];
        const newNotesById = new Map(current.notesById);
        const newSeenIds = new Set(current.seenIds);
        const newAuthors = new Set(current.authors);
        let addedCount = 0;

        for (const cached of cachedEvents) {
          if (newSeenIds.has(cached.id)) continue;
          newSeenIds.add(cached.id);
          newAuthors.add(cached.pubkey);
          Profiles.request(cached.pubkey);

          const event: NostrEvent = {
            id: cached.id, pubkey: cached.pubkey, kind: cached.kind,
            created_at: cached.created_at, content: cached.content,
            tags: cached.tags, sig: cached.sig,
          };
          const note = processEvent(event);
          if (note.replyTo) ParentNotes.request(note.replyTo);
          newNotes.push(note);
          newNotesById.set(note.id, note);
          addedCount++;
        }

        if (addedCount > 0) {
          set({
            notes: newNotes, notesById: newNotesById, seenIds: newSeenIds,
            authors: newAuthors, loadingMore: false, hasMoreNotes: true,
          } as any);
          return;
        }
      }
    } catch {
      // IndexedDB read failed, fall through to relay
    }

    // Step 2: Fetch from relays
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

    // Persist fetched events to IndexedDB for cache-first pagination
    DB.addSeenIds(events.filter(e => !state.seenIds.has(e.id)).map(e => e.id));
    DB.queueEventWrite(events.filter(e => !state.seenIds.has(e.id)).map(e => ({
      id: e.id, pubkey: e.pubkey, kind: e.kind, created_at: e.created_at,
      content: e.content, tags: e.tags, sig: e.sig,
      feedType, storedAt: Math.floor(Date.now() / 1000),
    })));

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
    animatedNoteIds.clear();
    _filteredCache = null;
    _filteredCacheKey = '';
    EventBuffer.reset();
    set({
      initialRenderDone: false,
      eoseReceived: false,
      wotScoringDone: false,
      displayLimit: PAGE_SIZE,
      shuffleSeed: Date.now(),
      hasMoreNotes: true,
      frozenOrder: [],
    });
    Relay.reconnect();
  },

  setFeedMode: (mode: FeedMode) => {
    _filteredCache = null;
    _filteredCacheKey = '';
    set({
      feedMode: mode,
      displayLimit: PAGE_SIZE,
      shuffleSeed: Date.now(),
      hasMoreNotes: true,
      frozenOrder: [],
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

    // Capture the current chronological order BEFORE scoring changes anything.
    // This is the order the user has been reading — we preserve it.
    const current = get();
    const preScorePool = current.feedMode === 'following'
      ? current.notes.filter(n => Follows.following.has(n.pubkey))
      : current.notes;
    const frozenOrder = sortNotes(preScorePool, 'newest').map(n => n.id);

    // Re-process all notes with updated trust data
    const settings = getSettings();
    const trustWeight = settings.trustWeight;
    const recencyWeight = 1 - trustWeight;
    const maxAge = settings.timeWindow * 60 * 60;
    const now = Math.floor(Date.now() / 1000);

    const updatedNotes = current.notes.map((note) => {
      const trust = WoT.cache.get(note.pubkey);
      if (!trust) return note;

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

    // Invalidate filtered cache
    _filteredCache = null;
    _filteredCacheKey = '';

    set({
      notes: updatedNotes,
      notesById: updatedById,
      wotScoringDone: true,
      frozenOrder,
    } as any);
  },

  getFilteredNotes: () => {
    const state = get();
    const settings = getSettings();

    // Module-level cache: avoid recomputing on renders where nothing changed
    const cacheKey = `${state.notes.length}-${state.feedMode}-${state.wotScoringDone}-${state.shuffleSeed}-${state.followsTick}-${state.showingBookmarks}`;
    if (_filteredCacheKey === cacheKey && _filteredCache) {
      return _filteredCache;
    }

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

    let result: Note[];

    // For following tab, sort by newest
    if (state.feedMode === 'following') {
      result = sortNotes(filtered, 'newest');
    }
    // Global tab before scoring: sort by newest as placeholder
    else if (!state.wotScoringDone) {
      result = sortNotes(filtered, 'newest');
    }
    // Global tab after scoring with explicit sort mode
    else if (settings.sortMode && settings.sortMode !== 'trust-desc') {
      result = sortNotes(filtered, settings.sortMode);
    }
    // Global tab after scoring: stable order using frozenOrder
    else if (state.frozenOrder.length > 0) {
      const frozenSet = new Set(state.frozenOrder);
      const filteredMap = new Map(filtered.map(n => [n.id, n]));

      // Preserved-order notes (that survived filtering)
      const preserved: Note[] = [];
      for (const id of state.frozenOrder) {
        const note = filteredMap.get(id);
        if (note) preserved.push(note);
      }

      // New notes (arrived after scoring) — rank by trust
      const newNotes = filtered.filter(n => !frozenSet.has(n.id));
      const rng = mulberry32(state.shuffleSeed);
      const ranked = newNotes
        .map(note => ({ note, priority: note.combinedScore + rng() * 0.3 }))
        .sort((a, b) => b.priority - a.priority)
        .map(s => s.note);

      result = [...preserved, ...ranked];
    }
    // Fallback: trust-weighted shuffle
    else {
      const rng = mulberry32(state.shuffleSeed);
      const shuffled = filtered.map((note) => ({
        note,
        priority: note.combinedScore + rng() * 0.3,
      }));
      shuffled.sort((a, b) => b.priority - a.priority);
      result = shuffled.map((s) => s.note);
    }

    // Cache the result
    _filteredCache = result;
    _filteredCacheKey = cacheKey;
    return result;
  },
}));

// ── Cache-first startup ──
// Load cached events from IndexedDB for instant render before relay connects.
export async function loadCachedFeed(feedMode: FeedMode): Promise<void> {
  const feedType = feedMode === 'following' ? 'following' as const : 'global' as const;
  try {
    let cachedEvents = await DB.getEventsByFeed(feedType, 30);
    // If following cache is empty, try global cache (following notes may be stored there)
    if (cachedEvents.length === 0 && feedMode === 'following') {
      cachedEvents = await DB.getEventsByFeed('global', 30);
    }
    if (cachedEvents.length === 0) return;

    const state = useFeedStore.getState();
    const newNotes = [...state.notes];
    const newNotesById = new Map(state.notesById);
    const newSeenIds = new Set(state.seenIds);
    const newAuthors = new Set(state.authors);

    for (const cached of cachedEvents) {
      if (newSeenIds.has(cached.id)) continue;
      newSeenIds.add(cached.id);
      newAuthors.add(cached.pubkey);
      Profiles.request(cached.pubkey);

      const event: NostrEvent = {
        id: cached.id, pubkey: cached.pubkey, kind: cached.kind,
        created_at: cached.created_at, content: cached.content,
        tags: cached.tags, sig: cached.sig,
      };
      const note = processEvent(event);
      if (note.replyTo) ParentNotes.request(note.replyTo);
      newNotes.push(note);
      newNotesById.set(note.id, note);
    }

    useFeedStore.setState({
      notes: newNotes,
      notesById: newNotesById,
      seenIds: newSeenIds,
      authors: newAuthors,
    } as any);
  } catch {
    // IndexedDB read failed, no cached data
  }
}

// ── EventBuffer initialization ──
// Called from Feed.tsx before relay is initialized.
export function initEventBuffer(): void {
  EventBuffer.init(handleBufferFlush);
}

// ── IndexedDB seenIds hydration ──
// Hydrate seenIds from IndexedDB on startup. Also migrates legacy sessionStorage data.
export async function hydrateSeenIds(): Promise<void> {
  const dbIds = await DB.loadSeenIds();

  // Migrate legacy sessionStorage seenIds if present
  try {
    const raw = sessionStorage.getItem('wot-feed-seen-ids');
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      for (const id of arr) dbIds.add(id);
      DB.addSeenIds(arr);
      sessionStorage.removeItem('wot-feed-seen-ids');
    }
  } catch { /* ignore */ }

  if (dbIds.size > 0) {
    useFeedStore.setState({ seenIds: dbIds } as any);
  }
}

// Flush pending DB writes on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    DB.flush();
  });
}
