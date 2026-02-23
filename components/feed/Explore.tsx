'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import { Search, Hash, Loader2, X, Image as ImageIcon } from 'lucide-react';
import Masonry, { ResponsiveMasonry } from 'react-responsive-masonry';
import { cn } from '@/lib/utils';
import { useRelayPool } from '@/lib/nostr/relayProvider';
import { Profiles } from '@/lib/content/profiles';
import { WoT } from '@/lib/wot/wot';
import { parseContent } from '@/lib/content/content';
import { processEvent, filterNotes, sortNotes } from '@/lib/wot/feed';
import { getSettings } from '@/lib/storage/settings';
import { useFeedStore } from '@/stores/feedStore';
import { useProfileStore } from '@/stores/profileStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { nip19 } from 'nostr-tools';
import { NotePost } from '@/components/note/NotePost';
import { MediaGridItem } from '@/components/media/MediaGridItem';
import type { Note, NostrEvent } from '@/types/nostr';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

const TRENDING_TAGS = ['bitcoin', 'nostr', 'zap', 'art', 'photography', 'music', 'dev'];
const GRID_PAGE_SIZE = 30;
const EXPLORE_FETCH_LIMIT = 300;

export function Explore() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { updateTick } = useProfileStore();
  const settings = useSettingsStore();
  const { query: relayQuery, queryImmediate } = useRelayPool();

  // Search state
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<'none' | 'hashtag' | 'profile'>('none');
  const [searchResults, setSearchResults] = useState<Note[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const initialSearchDone = useRef(false);

  // Media grid state
  const feedNotes = useFeedStore((s) => s.notes);
  const wotScoringDone = useFeedStore((s) => s.wotScoringDone);
  const [exploreNotes, setExploreNotes] = useState<Note[]>([]);
  const [exploreFetching, setExploreFetching] = useState(false);
  const [gridLimit, setGridLimit] = useState(GRID_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef(false);
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  // Pull-to-refresh
  const getScrollContainer = useCallback(() => scrollContainerRef.current, []);

  const handleRefresh = useCallback(async () => {
    fetchedRef.current = false;
    await fetchExploreMedia();
  }, []);

  const { pullDistance, isRefreshing, threshold: pullThreshold } = usePullToRefresh({
    onRefresh: handleRefresh,
    getScrollContainer,
  });

  // Find scroll container on mount
  useEffect(() => {
    const main = document.querySelector('main');
    if (main) scrollContainerRef.current = main;
  }, []);

  // Merge feed notes + dedicated explore notes, deduped
  const allNotes = useMemo(() => {
    const byId = new Map<string, Note>();
    for (const n of feedNotes) byId.set(n.id, n);
    for (const n of exploreNotes) byId.set(n.id, n);
    return Array.from(byId.values());
  }, [feedNotes, exploreNotes]);

  // Filter media notes through WoT
  const mediaNotes = useMemo(() => {
    const filtered = filterNotes(allNotes, {
      trustedOnly: settings.trustedOnly,
      maxHops: settings.maxHops,
      trustThreshold: settings.trustThreshold,
    });

    // Sort by trust score (highest first), then recency as tiebreaker
    const sorted = [...filtered].sort((a, b) => {
      if (b.trustScore !== a.trustScore) return b.trustScore - a.trustScore;
      return b.created_at - a.created_at;
    });

    // Extract only notes with images
    const result: Note[] = [];
    for (const note of sorted) {
      if (result.length >= gridLimit) break;
      const parsed = parseContent(note.content);
      if (parsed.some((p) => p.type === 'image')) {
        result.push(note);
      }
    }
    return result;
  }, [allNotes, gridLimit, settings.trustedOnly, settings.maxHops, settings.trustThreshold]);

  // Total media notes available (with WoT filtering applied)
  const totalMediaCount = useMemo(() => {
    const filtered = filterNotes(allNotes, {
      trustedOnly: settings.trustedOnly,
      maxHops: settings.maxHops,
      trustThreshold: settings.trustThreshold,
    });
    return filtered.filter((n) => parseContent(n.content).some((p) => p.type === 'image')).length;
  }, [allNotes, settings.trustedOnly, settings.maxHops, settings.trustThreshold]);

  // Fetch dedicated explore media from relays
  const fetchExploreMedia = useCallback(async () => {
    if (fetchedRef.current || exploreFetching) return;
    fetchedRef.current = true;
    setExploreFetching(true);

    try {
      const s = getSettings();
      const since = Math.floor(Date.now() / 1000) - s.timeWindow * 60 * 60;

      const enrichEvents = (evts: NostrEvent[]) => {
        return evts.map((ev) => {
          Profiles.request(ev.pubkey);
          const note = processEvent(ev);
          const trust = WoT.cache.get(ev.pubkey);
          if (trust) {
            return {
              ...note,
              trustScore: trust.score,
              distance: trust.distance,
              trusted: trust.trusted,
              paths: trust.paths,
            };
          }
          return note;
        });
      };

      const events = await relayQuery(
        { kinds: [1], since, limit: EXPLORE_FETCH_LIMIT },
        {
          onUpdate: (allEvents) => {
            setExploreNotes(enrichEvents(allEvents as NostrEvent[]));
          },
        }
      ) as NostrEvent[];

      // Score all authors
      const pubkeys = [...new Set(events.map((e) => e.pubkey))];
      if (pubkeys.length > 0) {
        await WoT.scoreBatch(pubkeys);
      }

      // Process and enrich with trust data
      const processed = enrichEvents(events);
      setExploreNotes(processed);
    } catch {
      // fetch failed silently
    }
    setExploreFetching(false);
  }, []);

  // Fetch explore media on mount once WoT scoring is done or after a short delay
  useEffect(() => {
    if (fetchedRef.current) return;
    if (wotScoringDone) {
      fetchExploreMedia();
    } else {
      // Fallback: fetch after 3s even if scoring isn't done yet
      const timer = setTimeout(() => fetchExploreMedia(), 3000);
      return () => clearTimeout(timer);
    }
  }, [wotScoringDone, fetchExploreMedia]);

  // Infinite scroll for media grid
  // Re-observe whenever gridLimit or totalMediaCount changes (sentinel may remount)
  const hasMoreMedia = gridLimit < totalMediaCount;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || searchType !== 'none' || !hasMoreMedia) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setGridLimit((prev) => prev + GRID_PAGE_SIZE);
        }
      },
      { threshold: 0, rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [searchType, hasMoreMedia, gridLimit]);

  // Auto-search from URL query param (e.g. /explore?q=%23bitcoin)
  useEffect(() => {
    if (initialSearchDone.current) return;
    const q = searchParams.get('q');
    if (q) {
      initialSearchDone.current = true;
      setQuery(q);
      if (q.startsWith('#') && q.length > 1) {
        searchByHashtag(q.slice(1));
      }
      // Clear the param so back navigation doesn't re-trigger
      router.replace(pathname);
    }
  }, [searchParams]);

  // Search handlers
  const handleSearch = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('#')) {
      searchByHashtag(trimmed.slice(1));
    } else if (trimmed.startsWith('npub1')) {
      try {
        const decoded = nip19.decode(trimmed);
        if (decoded.type === 'npub') {
          searchByProfile(decoded.data as string);
        }
      } catch {
        // invalid npub, treat as hashtag
        searchByHashtag(trimmed);
      }
    } else if (/^[0-9a-f]{64}$/i.test(trimmed)) {
      searchByProfile(trimmed);
    } else if (trimmed.includes('@') && /^[^@]+@[^@]+\.[^@]+$/.test(trimmed)) {
      // NIP-05 address: user@domain.com
      searchByNip05(trimmed);
    } else {
      // Treat plain text as hashtag search
      searchByHashtag(trimmed);
    }
  }, [query]);

  const searchByHashtag = async (tag: string) => {
    setSearchType('hashtag');
    setSearchLoading(true);
    setSearchResults([]);

    try {
      const events = await queryImmediate(
        { kinds: [1], '#t': [tag.toLowerCase()], limit: 100 },
        {
          onUpdate: (allEvents) => {
            const notes = (allEvents as NostrEvent[]).map((ev) => {
              Profiles.request(ev.pubkey);
              return processEvent(ev);
            });
            const filtered = filterNotes(notes, {
              trustedOnly: settings.trustedOnly,
              maxHops: settings.maxHops,
              trustThreshold: settings.trustThreshold,
            });
            setSearchResults(sortNotes(filtered, settings.sortMode));
          },
        }
      );

      // Score all authors first so processEvent picks up trust data
      const pubkeys = [...new Set((events as NostrEvent[]).map((ev) => ev.pubkey))];
      if (pubkeys.length > 0) {
        await WoT.scoreBatch(pubkeys);
      }

      // Now process events (trust scores are in cache)
      const resultNotes = (events as NostrEvent[]).map((ev) => {
        Profiles.request(ev.pubkey);
        return processEvent(ev);
      });

      // Filter by WoT settings and sort by trust
      const filtered = filterNotes(resultNotes, {
        trustedOnly: settings.trustedOnly,
        maxHops: settings.maxHops,
        trustThreshold: settings.trustThreshold,
      });
      const sorted = sortNotes(filtered, settings.sortMode);

      setSearchResults(sorted);
    } catch {
      // search failed silently
    }
    setSearchLoading(false);
  };

  const searchByNip05 = async (address: string) => {
    setSearchType('profile');
    setSearchLoading(true);
    setSearchResults([]);

    const [name, domain] = address.split('@');
    if (!name || !domain) { setSearchLoading(false); return; }

    try {
      const resp = await fetch(
        `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`
      );
      if (!resp.ok) throw new Error('NIP-05 lookup failed');
      const data = await resp.json();
      const pubkey = data?.names?.[name] || data?.names?.[name.toLowerCase()];
      if (!pubkey) {
        setSearchLoading(false);
        return;
      }
      // Delegate to profile search with resolved pubkey
      await searchByProfile(pubkey);
    } catch {
      setSearchLoading(false);
    }
  };

  const searchByProfile = async (pubkey: string) => {
    setSearchType('profile');
    setSearchLoading(true);
    setSearchResults([]);

    Profiles.request(pubkey);
    await WoT.scoreBatch([pubkey]);

    try {
      const events = await queryImmediate(
        { kinds: [1], authors: [pubkey], limit: 50 }
      );

      const resultNotes = (events as NostrEvent[]).map((ev) => processEvent(ev));
      // Profile search: sort newest first (single author, trust is the same)
      resultNotes.sort((a, b) => b.created_at - a.created_at);
      setSearchResults(resultNotes);
    } catch {
      // search failed silently
    }
    setSearchLoading(false);
  };

  const clearSearch = () => {
    setQuery('');
    setSearchType('none');
    setSearchResults([]);
  };

  const isLoading = exploreFetching && mediaNotes.length === 0;

  return (
    <div className="bg-black min-h-screen text-white pb-24 md:pb-0">
      {/* Header with search */}
      <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-zinc-800 p-4">
        <h1 className="text-xl font-bold mb-3">Explore</h1>
        <form onSubmit={(e) => { e.preventDefault(); handleSearch(); }} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search #hashtag, npub, or user@domain..."
              className="w-full pl-9 pr-8 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500 text-sm"
            />
            {query && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </form>
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

      {/* Search Results */}
      {searchType !== 'none' && (
        <div className="max-w-xl mx-auto">
          {searchLoading && (
            <div className="flex items-center justify-center gap-2 py-8 text-zinc-400">
              <Loader2 className="animate-spin" size={20} />
              <span>Searching...</span>
            </div>
          )}
          {!searchLoading && searchResults.length === 0 && (
            <div className="text-center py-8 text-zinc-500">No results found</div>
          )}
          {!searchLoading && searchResults.length > 0 && (
            <div className="divide-y divide-zinc-800">
              {searchResults.map((note) => (
                <NotePost key={note.id} note={note} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Trending tags + Media Grid (when not searching) */}
      {searchType === 'none' && (
        <>
          {/* Trending hashtag chips */}
          <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-zinc-800">
            {TRENDING_TAGS.map((tag) => (
              <button
                key={tag}
                onClick={() => {
                  setQuery(`#${tag}`);
                  searchByHashtag(tag);
                }}
                className="flex items-center gap-1 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-full text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                <Hash size={12} className="text-purple-400" />
                {tag}
              </button>
            ))}
          </div>

          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-12 text-zinc-400">
              <Loader2 className="animate-spin" size={20} />
              <span>Discovering trusted media...</span>
            </div>
          )}

          {/* Media Discovery Grid */}
          <div className="p-2">
            {!isLoading && mediaNotes.length === 0 ? (
              <div className="text-center py-16 text-zinc-500">
                <ImageIcon size={32} className="mx-auto mb-3 text-zinc-600" />
                <p>No trusted media found</p>
                <p className="text-sm mt-1">Media from WoT-trusted authors will appear here</p>
              </div>
            ) : mediaNotes.length > 0 ? (
              <ResponsiveMasonry columnsCountBreakPoints={{ 0: 2, 768: 3 }}>
                <Masonry gutter="6px">
                  {mediaNotes.map((note) => (
                    <MediaGridItem key={note.id} note={note} />
                  ))}
                </Masonry>
              </ResponsiveMasonry>
            ) : null}
          </div>

          {/* Infinite scroll sentinel — always rendered so observer can attach */}
          {mediaNotes.length > 0 && (
            <div ref={sentinelRef} className="py-4 text-center">
              {hasMoreMedia ? (
                <Loader2 className="animate-spin mx-auto text-zinc-600" size={20} />
              ) : (
                <p className="text-xs text-zinc-600">No more media</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
