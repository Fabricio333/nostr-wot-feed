import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, Loader2, Users, Globe, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFeedStore } from '@/stores/feedStore';
import type { FeedMode } from '@/stores/feedStore';
import { useProfileStore } from '@/stores/profileStore';
import { useAuthStore } from '@/stores/authStore';
import { useWoTStore } from '@/stores/wotStore';
import { Relay } from '@/services/relay';
import { WoT } from '@/services/wot';
import { Profiles } from '@/services/profiles';
import { ParentNotes } from '@/services/parentNotes';
import { Follows } from '@/services/follows';
import { Mute } from '@/services/mute';
import { loadSettings, getSettings } from '@/services/settings';
import { NotePost } from '@/app/components/NotePost';
import { WoTLogo } from '@/app/components/WoTLogo';

export function Feed() {
  const {
    notes,
    totalReceived,
    authors,
    eoseReceived,
    relayStatus,
    pendingCount,
    displayLimit,
    feedMode,
    followsTick,
    wotScoringDone,
    loadingMore,
    hasMoreNotes,
    reachedTimeWindowEnd,
    addEvent,
    setEose,
    setRelayStatus,
    setWotStatus,
    setFeedMode,
    bumpFollowsTick,
    getFilteredNotes,
    loadMore,
    fetchMore,
    loadOlderPosts,
    refresh,
    scoreAllNotes,
  } = useFeedStore();
  const { updateTick } = useProfileStore();
  const { pubkey: myPubkey } = useAuthStore();
  const { hasExtension: wotExtDetected } = useWoTStore();
  const [parentTick, setParentTick] = useState(0);
  const [relayTick, setRelayTick] = useState(0);
  const initRef = React.useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const throttleRef = useRef(false);

  // Track per-relay connection changes for the status display
  useEffect(() => {
    const prev = Relay.onRelayStatusChange;
    Relay.onRelayStatusChange = () => {
      setRelayTick((t) => t + 1);
      prev?.();
    };
    return () => { Relay.onRelayStatusChange = prev; };
  }, []);

  const connectedRelays = Relay.getConnectedCount();
  const totalRelays = Relay.getUrls().length;

  // If no pubkey (read-only), default to global feed
  useEffect(() => {
    if (!myPubkey && feedMode === 'following') {
      setFeedMode('global');
    }
  }, [myPubkey, feedMode, setFeedMode]);

  // Initialize relay + WoT on mount
  useEffect(() => {
    // Guard against React strict mode double-mount
    if (initRef.current) return;
    initRef.current = true;

    loadSettings();

    // Init WoT with retry for extension detection
    const initWoT = async () => {
      let result = await WoT.init();
      if (!result.hasExtension) {
        // Retry after delays — extension may load after page
        for (const delay of [500, 1500, 3000]) {
          await new Promise((r) => setTimeout(r, delay));
          result = await WoT.init();
          if (result.hasExtension) break;
        }
      }
      setWotStatus(result);
      useWoTStore.getState().setHasExtension(result.hasExtension);
    };
    initWoT();

    // Wire parent notes updates
    ParentNotes.onUpdate = () => {
      setParentTick((t) => t + 1);
    };

    // Init relay
    Relay.init(
      (event) => {
        addEvent(event);
      },
      (status) => {
        if (status === 'eose') {
          setEose();
        }
        setRelayStatus(status === 'eose' ? 'eose' : status);
      }
    );

    // Don't destroy relay on cleanup — it's a singleton shared across the app
  }, []);

  // After EOSE, batch-score all notes and load mute list
  const scoringRef = React.useRef(false);
  useEffect(() => {
    if (eoseReceived && !scoringRef.current) {
      scoringRef.current = true;
      // Load mute list from relay
      Mute.loadFromRelay();
      // Batch score all notes
      scoreAllNotes();
    }
  }, [eoseReceived, scoreAllNotes]);

  // Start with loading=true when user has pubkey (follows will need to load)
  const [followingLoading, setFollowingLoading] = useState(!!myPubkey);
  const followSubRef = React.useRef(false);

  // Load follow list when logged in and relay is connected
  useEffect(() => {
    if (myPubkey && eoseReceived && !Follows.loaded) {
      setFollowingLoading(true);
      Follows.onUpdate = () => {
        bumpFollowsTick();
        // Once follows are loaded, subscribe to their notes
        if (Follows.loaded && !followSubRef.current) {
          followSubRef.current = true;
          const pubkeys = Array.from(Follows.following);
          if (pubkeys.length === 0) {
            setFollowingLoading(false);
            return;
          }
          Relay.subscribeFollowing(
            pubkeys,
            (event) => addEvent(event),
            () => setFollowingLoading(false)
          );
        }
      };
      Follows.load(myPubkey).catch(() => {
        setFollowingLoading(false);
      });
    } else if (!myPubkey) {
      setFollowingLoading(false);
    }
  }, [myPubkey, eoseReceived]);

  const filteredNotes = getFilteredNotes();
  const displayedNotes = filteredNotes.slice(0, displayLimit);

  // Show notes progressively — only show a full-screen blocker if we have zero notes
  const hasNotes = displayedNotes.length > 0;
  const isStreaming = !eoseReceived;
  const isWaitingForFollows = feedMode === 'following' && followingLoading;

  // Infinite scroll via IntersectionObserver with callback ref
  // Uses a callback ref so the observer is properly set up/torn down
  // when the sentinel element mounts/unmounts due to conditional rendering.
  const setSentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !throttleRef.current) {
          throttleRef.current = true;
          loadMore();
          setTimeout(() => { throttleRef.current = false; }, 800);
        }
      },
      { threshold: 0, rootMargin: '200px' }
    );
    observerRef.current.observe(node);
  }, [loadMore]);

  // Cleanup observer on unmount
  useEffect(() => {
    return () => observerRef.current?.disconnect();
  }, []);

  const settings = getSettings();

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

      {/* New notes banner */}
      {pendingCount > 0 && (
        <button
          onClick={refresh}
          className="w-full py-2 bg-purple-600/20 text-purple-400 text-sm font-medium hover:bg-purple-600/30 transition-colors border-b border-zinc-800"
        >
          {pendingCount} new note{pendingCount > 1 ? 's' : ''} — tap to show
        </button>
      )}

      {/* Initial loading: only show when we have ZERO notes */}
      {!hasNotes && (isStreaming || isWaitingForFollows) && (
        <div className="flex items-center justify-center gap-2 py-8 text-zinc-400">
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
        <div className="px-4 py-1.5 text-xs text-zinc-500 text-center border-b border-zinc-800 flex items-center justify-center gap-2">
          <Loader2 className="animate-spin" size={12} />
          <span>Loading more from relays... ({totalReceived} received)</span>
        </div>
      )}

      {/* WoT scoring indicator for global feed */}
      {feedMode === 'global' && eoseReceived && !wotScoringDone && (
        <div className="px-4 py-2 bg-purple-900/20 text-purple-300 text-xs text-center border-b border-zinc-800 flex items-center justify-center gap-2">
          <Shield size={12} />
          <Loader2 className="animate-spin" size={12} />
          <span>Scoring trust for {authors.size} authors — feed will re-sort when done</span>
        </div>
      )}

      {/* Notes list — rendered immediately as notes arrive */}
      <div className="max-w-xl mx-auto divide-y divide-zinc-800">
        {displayedNotes.map((note) => (
          <NotePost key={note.id} note={note} parentTick={parentTick} />
        ))}
      </div>

      {/* Empty state — only after loading is definitively done */}
      {eoseReceived && !followingLoading && !loadingMore && filteredNotes.length === 0 && (
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

      {/* Reached end of time window — offer to load older posts */}
      {reachedTimeWindowEnd && !loadingMore && hasNotes && (
        <div className="text-center py-6 px-4 border-t border-zinc-800">
          <Clock size={20} className="mx-auto mb-2 text-zinc-600" />
          <p className="text-zinc-500 text-sm mb-3">
            No more posts in the last {settings.timeWindow} hours
          </p>
          <button
            onClick={loadOlderPosts}
            className="px-4 py-2 bg-purple-600/20 text-purple-400 text-sm font-medium rounded-lg hover:bg-purple-600/30 transition-colors"
          >
            Load older posts
          </button>
        </div>
      )}

      {/* Loading more spinner (pagination in progress) */}
      {loadingMore && (
        <div className="py-4 text-center">
          <Loader2 className="animate-spin mx-auto text-zinc-600" size={20} />
        </div>
      )}

      {/* Infinite scroll sentinel — triggers loadMore / fetchMore */}
      {hasNotes && !loadingMore && !reachedTimeWindowEnd && hasMoreNotes && (
        <div ref={setSentinelRef} className="h-10" />
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
