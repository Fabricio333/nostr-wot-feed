import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Search, Hash, Loader2, X, Image as ImageIcon } from 'lucide-react';
import Masonry, { ResponsiveMasonry } from 'react-responsive-masonry';
import { cn } from '@/lib/utils';
import { Relay } from '@/services/relay';
import { Profiles } from '@/services/profiles';
import { WoT } from '@/services/wot';
import { parseContent } from '@/services/content';
import { processEvent } from '@/services/feed';
import { useFeedStore } from '@/stores/feedStore';
import { useProfileStore } from '@/stores/profileStore';
import { truncateNpub, trustColor } from '@/utils/helpers';
import { nip19 } from 'nostr-tools';
import { NotePost } from '@/app/components/NotePost';
import type { Note, NostrEvent } from '@/types/nostr';

const TRENDING_TAGS = ['bitcoin', 'nostr', 'zap', 'art', 'photography', 'music', 'dev'];
const GRID_PAGE_SIZE = 30;

export function Explore() {
  const navigate = useNavigate();
  const { updateTick } = useProfileStore();

  // Search state
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<'none' | 'hashtag' | 'profile'>('none');
  const [searchResults, setSearchResults] = useState<Note[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Media grid state — derived from feedStore
  const notes = useFeedStore((s) => s.notes);
  const [gridLimit, setGridLimit] = useState(GRID_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const displayedIdsRef = useRef<Set<string>>(new Set());

  // Filter notes with images for the media grid
  const mediaNotes = useMemo(() => {
    const result: Note[] = [];
    const seen = displayedIdsRef.current;

    // Sort by combined score (trust + recency)
    const sorted = [...notes].sort((a, b) => b.combinedScore - a.combinedScore);

    for (const note of sorted) {
      if (result.length >= gridLimit) break;
      const parsed = parseContent(note.content);
      const hasImage = parsed.some((p) => p.type === 'image');
      if (!hasImage) continue;
      // Deduplicate: track what we've shown
      seen.add(note.id);
      result.push(note);
    }

    return result;
  }, [notes, gridLimit]);

  // Reset displayed IDs cache when notes change substantially
  useEffect(() => {
    displayedIdsRef.current = new Set(mediaNotes.map((n) => n.id));
  }, [mediaNotes]);

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
        { kinds: [1], '#t': [tag.toLowerCase()], limit: 50 } as any
      );

      const resultNotes = (events as NostrEvent[]).map((ev) => {
        Profiles.request(ev.pubkey);
        return processEvent(ev);
      });

      // Score authors
      const pubkeys = [...new Set(resultNotes.map((n) => n.pubkey))];
      if (pubkeys.length > 0) {
        await WoT.scoreBatch(pubkeys);
      }

      resultNotes.sort((a, b) => b.created_at - a.created_at);
      setSearchResults(resultNotes);
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
    WoT.scoreBatch([pubkey]);

    const pool = Relay.pool;
    if (!pool) { setSearchLoading(false); return; }

    try {
      const events = await pool.querySync(
        Relay.getUrls(),
        { kinds: [1], authors: [pubkey], limit: 50 }
      );

      const resultNotes = (events as NostrEvent[]).map((ev) => processEvent(ev));
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

  // Total media notes available (to know if there are more to load)
  const totalMediaCount = useMemo(() => {
    return notes.filter((n) => parseContent(n.content).some((p) => p.type === 'image')).length;
  }, [notes]);

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
                <NotePost key={note.id} note={note} parentTick={0} />
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

          {/* Media Discovery Grid */}
          <div className="p-2">
            {mediaNotes.length === 0 ? (
              <div className="text-center py-16 text-zinc-500">
                <ImageIcon size={32} className="mx-auto mb-3 text-zinc-600" />
                <p>No media notes yet</p>
                <p className="text-sm mt-1">Media from notes will appear here as the feed loads</p>
              </div>
            ) : (
              <ResponsiveMasonry columnsCountBreakPoints={{ 0: 2, 768: 3 }}>
                <Masonry gutter="6px">
                  {mediaNotes.map((note) => (
                    <MediaGridItem key={note.id} note={note} />
                  ))}
                </Masonry>
              </ResponsiveMasonry>
            )}
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
  const profile = Profiles.get(note.pubkey);
  const parsed = parseContent(note.content);
  const firstImage = parsed.find((p) => p.type === 'image');
  if (!firstImage) return null;

  return (
    <div
      className="relative group cursor-pointer rounded-lg overflow-hidden"
      style={{ animation: 'note-enter 0.4s ease-out both' }}
      onClick={() => navigate(`/note/${note.id}`)}
    >
      <img
        src={firstImage.value}
        alt=""
        className="w-full object-cover"
        loading="lazy"
      />
      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
        <div className="flex items-center gap-2">
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
          {note.trusted && (
            <span className="text-xs" style={{ color: trustColor(note.trustScore) }}>
              {Math.round(note.trustScore * 100)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
