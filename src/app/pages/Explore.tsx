import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { Search, Hash, Loader2, X, Image as ImageIcon, Shield } from 'lucide-react';
import Masonry, { ResponsiveMasonry } from 'react-responsive-masonry';
import { cn } from '@/lib/utils';
import { Relay } from '@/services/relay';
import { Profiles } from '@/services/profiles';
import { WoT } from '@/services/wot';
import { parseContent } from '@/services/content';
import { processEvent, filterNotes, sortNotes } from '@/services/feed';
import { getSettings } from '@/services/settings';
import { useFeedStore } from '@/stores/feedStore';
import { useProfileStore } from '@/stores/profileStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { truncateNpub, trustColor } from '@/utils/helpers';
import { nip19 } from 'nostr-tools';
import { NotePost } from '@/app/components/NotePost';
import type { Note, NostrEvent } from '@/types/nostr';
import { useLightboxStore } from '@/stores/lightboxStore';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

const TRENDING_TAGS = ['bitcoin', 'nostr', 'zap', 'art', 'photography', 'music', 'dev'];
const GRID_PAGE_SIZE = 30;
const EXPLORE_FETCH_LIMIT = 300;

export function Explore() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { updateTick } = useProfileStore();
  const settings = useSettingsStore();

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

    const pool = Relay.pool;
    if (!pool) {
      setExploreFetching(false);
      return;
    }

    try {
      const urls = Relay.getUrls();
      const s = getSettings();
      const since = Math.floor(Date.now() / 1000) - s.timeWindow * 60 * 60;

      const events = await pool.querySync(
        urls,
        { kinds: [1], since, limit: EXPLORE_FETCH_LIMIT } as any
      ) as NostrEvent[];

      // Score all authors
      const pubkeys = [...new Set(events.map((e) => e.pubkey))];
      if (pubkeys.length > 0) {
        await WoT.scoreBatch(pubkeys);
      }

      // Process and enrich with trust data
      const processed = events.map((ev) => {
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
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || searchType !== 'none') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setGridLimit((prev) => prev + GRID_PAGE_SIZE);
        }
      },
      { threshold: 0 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [searchType]);

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
      setSearchParams({}, { replace: true });
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

    const pool = Relay.pool;
    if (!pool) { setSearchLoading(false); return; }

    try {
      const events = await pool.querySync(
        Relay.getUrls(),
        { kinds: [1], '#t': [tag.toLowerCase()], limit: 100 } as any
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

    const pool = Relay.pool;
    if (!pool) { setSearchLoading(false); return; }

    try {
      const events = await pool.querySync(
        Relay.getUrls(),
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

          {/* Infinite scroll sentinel */}
          {gridLimit < totalMediaCount && (
            <div ref={sentinelRef} className="py-4 text-center">
              <Loader2 className="animate-spin mx-auto text-zinc-600" size={20} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MediaGridItem({ note }: { note: Note }) {
  const navigate = useNavigate();
  const { updateTick } = useProfileStore();
  const openLightbox = useLightboxStore((s) => s.open);
  const profile = Profiles.get(note.pubkey);
  const parsed = parseContent(note.content);
  const allImages = parsed.filter((p) => p.type === 'image');
  const firstImage = allImages[0];
  if (!firstImage) return null;

  const lightboxItems = allImages.map((img) => ({ type: 'image' as const, src: img.value }));
  const pct = Math.round(note.trustScore * 100);
  const color = trustColor(note.trustScore);

  return (
    <div
      className="relative group rounded-lg overflow-hidden"
      style={{ animation: 'note-enter 0.4s ease-out both' }}
    >
      {/* Image — opens lightbox */}
      <img
        src={firstImage.value}
        alt=""
        className="w-full object-cover cursor-zoom-in"
        loading="lazy"
        onClick={() => openLightbox(lightboxItems, 0)}
      />

      {/* Trust badge — always visible (top-right) */}
      {note.trusted && (
        <div
          className="absolute top-1.5 right-1.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-black/70 text-[10px] font-medium backdrop-blur-sm"
          style={{ color }}
        >
          <Shield size={9} />
          {pct}%
        </div>
      )}

      {/* Hover overlay — full author + trust details, click navigates to thread */}
      <div
        className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2 cursor-pointer"
        onClick={() => navigate(`/note/${note.id}`)}
      >
        {/* Author row */}
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-full overflow-hidden bg-zinc-700 flex-shrink-0">
            {profile?.picture ? (
              <img src={profile.picture} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full" />
            )}
          </div>
          <span className="text-white text-xs truncate">
            {profile?.displayName || profile?.name || truncateNpub(note.pubkey)}
          </span>
        </div>

        {/* Trust details */}
        {note.trusted && (
          <div
            className="flex items-center gap-1 text-[10px] font-medium"
            style={{ color }}
          >
            <Shield size={10} />
            <span>{pct}%</span>
            <span className="text-zinc-500">·</span>
            <span>{note.distance}h</span>
            {note.paths > 0 && (
              <>
                <span className="text-zinc-500">·</span>
                <span>{note.paths}p</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
