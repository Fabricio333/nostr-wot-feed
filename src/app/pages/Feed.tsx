import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, Loader2, Users, Globe } from 'lucide-react';
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
import { loadSettings } from '@/services/settings';
import { NotePost } from '@/app/components/NotePost';

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
    addEvent,
    setEose,
    setRelayStatus,
    setWotStatus,
    setFeedMode,
    bumpFollowsTick,
    getFilteredNotes,
    loadMore,
    refresh,
    scoreAllNotes,
  } = useFeedStore();
  const { updateTick } = useProfileStore();
  const { pubkey: myPubkey } = useAuthStore();
  const { hasExtension: wotExtDetected } = useWoTStore();
  const [parentTick, setParentTick] = useState(0);
  const initRef = React.useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

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

  const isLoading = !eoseReceived
    || (feedMode === 'following' && followingLoading)
    || (feedMode === 'global' && !wotScoringDone);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <div className="bg-black min-h-screen text-white pb-24 md:pb-0">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-zinc-800">
        <div className="px-4 pt-3 pb-0 flex justify-between items-center">
          <h1 className="text-xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">Nostr WTF</h1>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span>{filteredNotes.length} notes</span>
            <span className="text-zinc-700">|</span>
            <span>{authors.size} authors</span>
            <StatusPill status={relayStatus} />
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

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-8 text-zinc-400">
          <Loader2 className="animate-spin" size={20} />
          <span>
            {!eoseReceived
              ? `Loading feed from relays... (${totalReceived} received)`
              : feedMode === 'global' && !wotScoringDone
              ? 'Scoring trust...'
              : 'Loading notes from people you follow...'}
          </span>
        </div>
      )}

      {/* Notes list */}
      <div className="max-w-xl mx-auto divide-y divide-zinc-800">
        {displayedNotes.map((note) => (
          <NotePost key={note.id} note={note} parentTick={parentTick} />
        ))}
      </div>

      {/* Empty state */}
      {eoseReceived && !followingLoading && filteredNotes.length === 0 && (feedMode !== 'global' || wotScoringDone) && (
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

      {/* Infinite scroll sentinel */}
      {displayLimit < filteredNotes.length && (
        <div ref={sentinelRef} className="py-4 text-center">
          <Loader2 className="animate-spin mx-auto text-zinc-600" size={20} />
        </div>
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

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    connecting: 'bg-yellow-500',
    connected: 'bg-green-500',
    eose: 'bg-green-500',
    disconnected: 'bg-red-500',
  };
  return (
    <span className={cn('w-2 h-2 rounded-full inline-block', colors[status] || 'bg-zinc-500')} />
  );
}
