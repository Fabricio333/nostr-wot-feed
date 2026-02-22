import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { Shield, Loader2, Users, Globe, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFeedStore, hydrateSeenIds, initEventBuffer, loadCachedFeed, markFollowingPubkeys } from '@/stores/feedStore';
import type { FeedMode } from '@/stores/feedStore';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { useWoTStore } from '@/stores/wotStore';
import { Relay } from '@/services/relay';
import { WoT } from '@/services/wot';
import { Profiles } from '@/services/profiles';
import { Follows } from '@/services/follows';
import { Mute } from '@/services/mute';
import { loadSettings } from '@/services/settings';
import { DB } from '@/services/db';
import { RelayStats } from '@/services/relayStats';
import { Verifier } from '@/services/verifier';
import { NotePost } from '@/app/components/NotePost';
import { WoTLogo } from '@/app/components/WoTLogo';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useScrollRestoration } from '@/hooks/useScrollRestoration';

export function Feed() {
  const {
    notes,
    totalReceived,
    authors,
    eoseReceived,
    relayStatus,
    newNotesSinceScroll,
    displayLimit,
    feedMode,
    followsTick,
    wotScoringDone,
    loadingMore,
    hasMoreNotes,
    isScrolledDown,
    addEvent,
    setEose,
    setRelayStatus,
    setWotStatus,
    setFeedMode,
    setIsScrolledDown,
    bumpFollowsTick,
    getFilteredNotes,
    loadMore,
    fetchMore,
    resetNewNotesSinceScroll,
    revealNewNotes,
    pullRefresh,
    scoreAllNotes,
  } = useFeedStore();
  const { pubkey: myPubkey } = useAuthStore();
  const { hasExtension: wotExtDetected } = useWoTStore();
  const [relayTick, setRelayTick] = useState(0);
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);
  const initRef = React.useRef(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  // Track per-relay connection changes for the status display
  useEffect(() => {
    Relay.onRelayStatusChange = () => setRelayTick((t) => t + 1);
    return () => { Relay.onRelayStatusChange = null; };
  }, []);

  const connectedRelays = Relay.getConnectedCount();
  const totalRelays = Relay.getUrls().length;

  // Find the scroll container (<main> in Layout.tsx) and track scroll position
  const getScrollContainer = useCallback(() => scrollContainerRef.current, []);

  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    scrollContainerRef.current = main;
    setScrollParent(main); // Trigger re-render so Virtuoso gets the ref

    const onScroll = () => {
      const scrolled = main.scrollTop > 300;
      setIsScrolledDown(scrolled);
      if (main.scrollTop < 50) {
        revealNewNotes();
      }
    };

    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, [setIsScrolledDown, revealNewNotes]);

  // Scroll position restoration across navigation
  useScrollRestoration(`feed-${feedMode}`, scrollContainerRef);

  // Pull-to-refresh
  const { pullDistance, isRefreshing, threshold: pullThreshold } = usePullToRefresh({
    onRefresh: pullRefresh,
    getScrollContainer,
  });

  const scrollToTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    revealNewNotes();
  }, [revealNewNotes]);

  // If no pubkey (read-only), default to global feed
  useEffect(() => {
    if (!myPubkey && feedMode === 'following') {
      setFeedMode('global');
    }
  }, [myPubkey, feedMode, setFeedMode]);

  // Stable refs for callbacks (avoids stale closures in init)
  const addEventRef = useRef(addEvent);
  const setEoseRef = useRef(setEose);
  const setRelayStatusRef = useRef(setRelayStatus);
  const setWotStatusRef = useRef(setWotStatus);
  addEventRef.current = addEvent;
  setEoseRef.current = setEose;
  setRelayStatusRef.current = setRelayStatus;
  setWotStatusRef.current = setWotStatus;

  // Initialize all services on mount
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const initAll = async () => {
      loadSettings();

      // Initialize IndexedDB first (required by other services)
      await DB.init();

      // Initialize services that depend on DB in parallel
      await Promise.all([
        RelayStats.init(),
        Profiles.init(),
        hydrateSeenIds(),
        DB.pruneOldEvents(7),
      ]);

      // Sync profile store with the service cache loaded from IndexedDB
      useProfileStore.getState().syncFromService();

      // Load cached feed for instant render before relay connects
      const currentFeedMode = useFeedStore.getState().feedMode;
      await loadCachedFeed(currentFeedMode);

      // Initialize Web Worker for signature verification
      Verifier.init();

      // Initialize EventBuffer before relay (events arrive after relay.init)
      initEventBuffer();

      // Init WoT with retry for extension detection (fire and forget)
      (async () => {
        let result = await WoT.init();
        if (!result.hasExtension) {
          for (const delay of [500, 1500, 3000]) {
            await new Promise((r) => setTimeout(r, delay));
            result = await WoT.init();
            if (result.hasExtension) break;
          }
        }
        setWotStatusRef.current(result);
        useWoTStore.getState().setHasExtension(result.hasExtension);
      })();

      // Init relay — events start flowing after this
      Relay.init(
        (event) => addEventRef.current(event),
        (status) => {
          if (status === 'eose') {
            setEoseRef.current();
          }
          setRelayStatusRef.current(status === 'eose' ? 'eose' : status);
        }
      );
    };

    initAll();
  }, []);

  // After EOSE, batch-score all notes and load mute list
  // Reset scoring guard when eoseReceived goes false (pull-to-refresh)
  const scoringRef = React.useRef(false);
  useEffect(() => {
    if (!eoseReceived) {
      scoringRef.current = false;
    }
  }, [eoseReceived]);

  useEffect(() => {
    if (eoseReceived && !scoringRef.current) {
      scoringRef.current = true;
      (async () => {
        await Mute.loadFromRelay();
        await scoreAllNotes();
      })();
    }
  }, [eoseReceived, scoreAllNotes]);

  // Start with loading=true when user has pubkey (follows will need to load)
  const [followingLoading, setFollowingLoading] = useState(!!myPubkey);
  const followSubRef = React.useRef(false);

  // Load follow list when logged in and relay is connected
  useEffect(() => {
    if (myPubkey && eoseReceived && !Follows.loaded) {
      setFollowingLoading(true);
      const unsub = Follows.addListener(() => {
        bumpFollowsTick();
        // Once follows are loaded, subscribe to their notes
        if (Follows.loaded && !followSubRef.current) {
          followSubRef.current = true;
          const pubkeys = Array.from(Follows.following);
          if (pubkeys.length === 0) {
            setFollowingLoading(false);
            return;
          }
          // Mark following pubkeys so DB writes get the correct feedType
          markFollowingPubkeys(pubkeys);
          Relay.subscribeFollowing(
            pubkeys,
            (event) => addEvent(event),
            () => setFollowingLoading(false)
          );
        }
      });
      Follows.load(myPubkey).catch(() => {
        setFollowingLoading(false);
      });
      return () => unsub();
    } else if (!myPubkey) {
      setFollowingLoading(false);
    }
  }, [myPubkey, eoseReceived]);

  const filteredNotes = useMemo(
    () => getFilteredNotes(),
    [notes, feedMode, wotScoringDone, followsTick, getFilteredNotes]
  );
  const displayedNotes = useMemo(
    () => filteredNotes.slice(0, displayLimit),
    [filteredNotes, displayLimit]
  );

  // Show notes progressively — only show a full-screen blocker if we have zero notes
  const hasNotes = displayedNotes.length > 0;
  const isStreaming = !eoseReceived;
  const isWaitingForFollows = feedMode === 'following' && followingLoading;

  // Virtuoso endReached handler for infinite scroll
  const handleEndReached = useCallback(() => {
    loadMore();
  }, [loadMore]);

  return (
    <div className="bg-black min-h-screen text-white pb-24 md:pb-0">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-zinc-800">
        <div className="px-4 pt-3 pb-0 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <WoTLogo size={24} className="text-purple-400" />
            <h1 className="text-xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">Nostr WTF</h1>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span>{filteredNotes.length} notes</span>
            <span className="text-zinc-700">|</span>
            <span>{authors.size} authors</span>
            <StatusPill status={relayStatus} connected={connectedRelays} total={totalRelays} />
          </div>
        </div>

        {/* Feed mode tabs */}
        <FeedTabs mode={feedMode} onChange={setFeedMode} />
      </header>

      {/* Pull-to-refresh indicator */}
      <div
        className="overflow-hidden transition-[height] duration-200 ease-out"
        style={{ height: isRefreshing ? 48 : Math.min(pullDistance * 0.6, 48) }}
      >
        <div className="flex items-center justify-center h-12 text-zinc-400">
          <Loader2
            className={cn('transition-transform duration-200', isRefreshing && 'animate-spin')}
            size={20}
            style={{
              transform: !isRefreshing
                ? `rotate(${Math.min((pullDistance / pullThreshold) * 180, 180)}deg)`
                : undefined,
              opacity: isRefreshing ? 1 : Math.min(pullDistance / 30, 1),
            }}
          />
        </div>
      </div>

      {/* WoT extension status */}
      {eoseReceived && !wotExtDetected && (
        <div className="px-4 py-2 bg-yellow-900/20 text-yellow-400 text-xs text-center border-b border-zinc-800">
          <Shield size={12} className="inline mr-1" />
          WoT extension not detected — trust scores use oracle fallback.{' '}
          <a href="https://nostr-wot.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-yellow-300">
            Install extension
          </a>
        </div>
      )}

      {/* Initial loading: only show when we have ZERO notes */}
      {!hasNotes && (isStreaming || isWaitingForFollows) && (
        <div
          className="flex items-center justify-center gap-2 py-8 text-zinc-400"
          style={{ animation: 'fade-in 0.3s ease-out both' }}
        >
          <Loader2 className="animate-spin" size={20} />
          <span>
            {isStreaming
              ? `Connecting to relays... (${totalReceived} received)`
              : 'Loading notes from people you follow...'}
          </span>
        </div>
      )}

      {/* Streaming indicator: subtle bar while notes are still arriving */}
      {hasNotes && isStreaming && (
        <div
          className="px-4 py-1.5 text-xs text-zinc-500 text-center border-b border-zinc-800 flex items-center justify-center gap-2"
          style={{ animation: 'fade-in 0.3s ease-out both' }}
        >
          <Loader2 className="animate-spin" size={12} />
          <span>Loading more from relays... ({totalReceived} received)</span>
        </div>
      )}

      {/* WoT scoring indicator for global feed */}
      {feedMode === 'global' && eoseReceived && !wotScoringDone && (
        <div className="px-4 py-2 bg-purple-900/20 text-purple-300 text-xs text-center border-b border-zinc-800 flex items-center justify-center gap-2">
          <Shield size={12} />
          <Loader2 className="animate-spin" size={12} />
          <span>Scoring trust for {authors.size} authors...</span>
        </div>
      )}

      {/* Notes list — virtualized for performance */}
      {hasNotes && (
        <div className="max-w-xl mx-auto">
          {scrollParent ? (
            <Virtuoso
              ref={virtuosoRef}
              data={displayedNotes}
              customScrollParent={scrollParent}
              overscan={800}
              defaultItemHeight={200}
              endReached={handleEndReached}
              itemContent={(_index, note) => (
                <div className="border-b border-zinc-800">
                  <NotePost key={note.id} note={note} />
                </div>
              )}
              components={{
                Footer: () => (
                  <>
                    {loadingMore && (
                      <div className="py-4 text-center" style={{ animation: 'fade-in 0.2s ease-out both' }}>
                        <Loader2 className="animate-spin mx-auto text-zinc-600" size={20} />
                      </div>
                    )}
                    {!hasMoreNotes && !loadingMore && (
                      <div className="text-center py-6 text-zinc-600 text-sm">
                        You've seen it all
                      </div>
                    )}
                  </>
                ),
              }}
            />
          ) : (
            displayedNotes.map((note) => (
              <NotePost key={note.id} note={note} />
            ))
          )}
        </div>
      )}

      {/* Empty state — only after loading is definitively done */}
      {!hasNotes && eoseReceived && !followingLoading && !loadingMore && filteredNotes.length === 0 && (
        <div className="text-center py-16 text-zinc-500">
          {feedMode === 'following' ? (
            <>
              <Users size={32} className="mx-auto mb-3 text-zinc-600" />
              <p className="text-lg mb-2">No notes from people you follow</p>
              <p className="text-sm mb-4">
                You follow {Follows.following.size} accounts
              </p>
              <button
                onClick={() => setFeedMode('global')}
                className="text-purple-400 text-sm hover:text-purple-300"
              >
                Switch to Global WoT
              </button>
            </>
          ) : (
            <>
              <p className="text-lg mb-2">No notes match your filters</p>
              <p className="text-sm">Try adjusting your trust settings or time window</p>
            </>
          )}
        </div>
      )}

      {/* Scroll-to-top FAB when new notes arrive */}
      {newNotesSinceScroll > 0 && isScrolledDown && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-24 md:bottom-6 right-6 z-20 bg-purple-600 hover:bg-purple-500 text-white rounded-full px-4 py-2 shadow-lg flex items-center gap-2 transition-all text-sm"
        >
          <ArrowUp size={16} />
          {newNotesSinceScroll} new
        </button>
      )}
    </div>
  );
}

function FeedTabs({ mode, onChange }: { mode: FeedMode; onChange: (m: FeedMode) => void }) {
  return (
    <div className="flex">
      <button
        onClick={() => onChange('following')}
        className={cn(
          'flex-1 py-3 text-sm font-semibold text-center transition-colors relative',
          mode === 'following' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
        )}
      >
        <span className="flex items-center justify-center gap-1.5">
          <Users size={15} />
          Following
        </span>
        {mode === 'following' && (
          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-0.5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full" />
        )}
      </button>
      <button
        onClick={() => onChange('global')}
        className={cn(
          'flex-1 py-3 text-sm font-semibold text-center transition-colors relative',
          mode === 'global' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
        )}
      >
        <span className="flex items-center justify-center gap-1.5">
          <Globe size={15} />
          Global WoT
        </span>
        {mode === 'global' && (
          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-0.5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full" />
        )}
      </button>
    </div>
  );
}

function StatusPill({ status, connected, total }: { status: string; connected: number; total: number }) {
  const dotColor =
    connected === 0 ? 'bg-red-500' :
    connected < total ? 'bg-yellow-500' :
    'bg-green-500';

  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('w-2 h-2 rounded-full inline-block', dotColor)} />
      <span>{connected}/{total}</span>
    </span>
  );
}
