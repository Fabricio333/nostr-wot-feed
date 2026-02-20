import React, { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Repeat2, Heart, Share, Shield, Loader2, Users, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link } from 'react-router';
import { useFeedStore } from '@/stores/feedStore';
import type { FeedMode } from '@/stores/feedStore';
import { useProfileStore } from '@/stores/profileStore';
import { useAuthStore } from '@/stores/authStore';
import { useWoTStore } from '@/stores/wotStore';
import { Relay } from '@/services/relay';
import { WoT } from '@/services/wot';
import { Profiles } from '@/services/profiles';
import { Actions } from '@/services/actions';
import { ParentNotes } from '@/services/parentNotes';
import { Follows } from '@/services/follows';
import { loadSettings } from '@/services/settings';
import { parseContent } from '@/services/content';
import { timeAgo, truncateNpub, pubkeyColor, trustColor } from '@/utils/helpers';
import type { Note, ParsedContent as ParsedContentType } from '@/types/nostr';

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
    addEvent,
    setEose,
    setRelayStatus,
    setWotStatus,
    setFeedMode,
    bumpFollowsTick,
    getFilteredNotes,
    loadMore,
    refresh,
  } = useFeedStore();
  const { updateTick } = useProfileStore();
  const { pubkey: myPubkey } = useAuthStore();
  const { hasExtension: wotExtDetected } = useWoTStore();
  const [parentTick, setParentTick] = useState(0);
  const initRef = React.useRef(false);

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

  const [followingLoading, setFollowingLoading] = useState(false);
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
          Relay.subscribeFollowing(
            pubkeys,
            (event) => addEvent(event),
            () => setFollowingLoading(false)
          );
        }
      };
      Follows.load(myPubkey);
    }
  }, [myPubkey, eoseReceived]);

  const filteredNotes = getFilteredNotes();
  const displayedNotes = filteredNotes.slice(0, displayLimit);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      loadMore();
    }
  }, [loadMore]);

  return (
    <div className="bg-black min-h-screen text-white pb-24 md:pb-0" onScroll={handleScroll}>
      {/* Header */}
      <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-zinc-800">
        <div className="px-4 pt-3 pb-0 flex justify-between items-center">
          <h1 className="text-xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">Nostr WoT</h1>
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
      {(!eoseReceived || (feedMode === 'following' && followingLoading)) && (
        <div className="flex items-center justify-center gap-2 py-8 text-zinc-400">
          <Loader2 className="animate-spin" size={20} />
          <span>
            {!eoseReceived
              ? `Loading feed from relays... (${totalReceived} received)`
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
      {eoseReceived && !followingLoading && filteredNotes.length === 0 && (
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

      {/* Load more indicator */}
      {displayLimit < filteredNotes.length && (
        <div className="text-center py-4">
          <button
            onClick={loadMore}
            className="text-purple-400 text-sm hover:text-purple-300"
          >
            Load more ({filteredNotes.length - displayLimit} remaining)
          </button>
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

function NotePost({ note, parentTick }: { note: Note; parentTick: number }) {
  const profile = Profiles.get(note.pubkey);
  const { updateTick } = useProfileStore();
  const [liked, setLiked] = useState(false);
  const [reposted, setReposted] = useState(false);

  // Request profile if not cached
  useEffect(() => {
    if (!profile) {
      Profiles.request(note.pubkey);
    }
  }, [note.pubkey, profile]);

  const displayName = profile?.displayName || profile?.name || truncateNpub(note.pubkey);
  const handle = profile?.name ? `@${profile.name}` : truncateNpub(note.pubkey);
  const avatarUrl = profile?.picture || '';
  const fallbackColor = pubkeyColor(note.pubkey);

  const parsed = parseContent(note.content);
  const images = parsed.filter((p) => p.type === 'image');
  const videos = parsed.filter((p) => p.type === 'video');
  const youtubes = parsed.filter((p) => p.type === 'youtube');
  const hasMedia = images.length > 0 || videos.length > 0 || youtubes.length > 0;

  // Reply context
  const parentNote = note.replyTo ? ParentNotes.get(note.replyTo) : null;
  const parentProfile = parentNote ? Profiles.get(parentNote.pubkey) : null;
  const parentName = parentProfile?.displayName || parentProfile?.name || (parentNote ? truncateNpub(parentNote.pubkey) : null);

  const handleLike = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (liked) return;
    const result = await Actions.like(note.id, note.pubkey);
    if (result.success) setLiked(true);
  };

  const handleRepost = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (reposted) return;
    const result = await Actions.repost(note.id, note.pubkey);
    if (result.success) setReposted(true);
  };

  return (
    <article className="p-4 hover:bg-zinc-900/30 transition-colors cursor-pointer border-b border-zinc-800">
      <div className="flex gap-3">
        <Link to={`/profile/${note.pubkey}`} className="flex-shrink-0">
          <div
            className="w-10 h-10 rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center"
            style={!avatarUrl ? { backgroundColor: fallbackColor } : undefined}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-white text-sm font-bold">
                {displayName.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <Link to={`/profile/${note.pubkey}`} className="font-bold hover:underline truncate text-white">
              {displayName}
            </Link>
            <span className="text-zinc-500 text-sm truncate">{handle}</span>
            <span className="text-zinc-500 text-sm">· {timeAgo(note.created_at)}</span>
            {note.trusted && (
              <TrustIndicator distance={note.distance} score={note.trustScore} paths={note.paths} />
            )}
          </div>

          {/* Reply context */}
          {note.replyTo && parentNote && (
            <div className="mt-1 mb-2 text-sm border-l-2 border-zinc-700 pl-3">
              <span className="text-zinc-500">
                ↩ Replying to{' '}
                <Link to={`/profile/${parentNote.pubkey}`} className="text-purple-400 hover:underline">
                  @{parentName}
                </Link>
              </span>
              <p className="text-zinc-600 truncate text-xs mt-0.5">
                {parentNote.content.slice(0, 120)}
              </p>
            </div>
          )}

          {/* Reply indicator when parent hasn't loaded yet */}
          {note.replyTo && !parentNote && (
            <div className="mt-1 mb-2 text-xs text-zinc-600">
              ↩ Reply
            </div>
          )}

          {/* Note content */}
          <div className="mt-1 text-[15px] leading-relaxed text-zinc-100 whitespace-pre-wrap">
            <ContentDisplay parts={parsed.filter((p) => p.type !== 'image' && p.type !== 'video' && p.type !== 'youtube')} />
          </div>

          {/* Media */}
          {images.length > 0 && (
            <div className={cn("mt-2 rounded-xl overflow-hidden", images.length > 1 ? "grid grid-cols-2 gap-0.5" : "")}>
              {images.slice(0, 4).map((img, idx) => (
                <img key={idx} src={img.value} alt="" className="w-full max-h-96 object-cover" loading="lazy" />
              ))}
            </div>
          )}
          {videos.length > 0 && (
            <div className="mt-2 rounded-xl overflow-hidden">
              <video src={videos[0].value} controls className="w-full max-h-96" preload="metadata" />
            </div>
          )}
          {youtubes.length > 0 && youtubes[0].extra && (
            <div className="mt-2 rounded-xl overflow-hidden aspect-video">
              <iframe
                src={`https://www.youtube.com/embed/${youtubes[0].extra}`}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}

          {/* Actions */}
          <div className="mt-3 flex justify-between max-w-sm text-zinc-500">
            <ActionButton icon={MessageSquare} color="blue" />
            <ActionButton
              icon={Repeat2}
              active={reposted}
              color="green"
              onClick={handleRepost}
            />
            <ActionButton
              icon={Heart}
              active={liked}
              color="pink"
              onClick={handleLike}
            />
            <ActionButton icon={Share} />
          </div>
        </div>
      </div>
    </article>
  );
}

function TrustIndicator({ distance, score, paths }: { distance: number; score: number; paths: number }) {
  const color = trustColor(score);
  const pct = Math.round(score * 100);

  return (
    <span
      className="flex items-center gap-1 text-xs whitespace-nowrap"
      style={{ color }}
      title={`Trust: ${pct}% · ${distance} hop${distance > 1 ? 's' : ''} · ${paths} path${paths !== 1 ? 's' : ''}`}
    >
      <Shield size={12} />
      <span>{pct}%</span>
      <span className="text-zinc-600">·</span>
      <span>{distance}h</span>
      {paths > 0 && (
        <>
          <span className="text-zinc-600">·</span>
          <span>{paths}p</span>
        </>
      )}
    </span>
  );
}

function ContentDisplay({ parts }: { parts: ParsedContentType[] }) {
  return (
    <>
      {parts.map((part, i) => {
        switch (part.type) {
          case 'text':
            return <span key={i}>{part.value}</span>;
          case 'link':
            return (
              <a
                key={i}
                href={part.value}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:underline break-all"
              >
                {part.value.replace(/^https?:\/\//, '').slice(0, 50)}
              </a>
            );
          case 'hashtag':
            return (
              <span key={i} className="text-purple-400 hover:underline cursor-pointer">
                {part.value}
              </span>
            );
          case 'nostr-mention':
            return (
              <span key={i} className="text-purple-400 cursor-pointer hover:underline">
                {part.value}
              </span>
            );
          case 'youtube':
            return (
              <a key={i} href={part.value} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">
                [YouTube]
              </a>
            );
          default:
            return <span key={i}>{part.value}</span>;
        }
      })}
    </>
  );
}

function ActionButton({ icon: Icon, count, active, color, onClick }: any) {
  const colorMap: any = {
    blue: 'hover:text-blue-500',
    green: 'hover:text-green-500',
    pink: 'hover:text-pink-500',
  };

  return (
    <button
      className={cn(
        "flex items-center gap-1 group transition-colors p-2 -ml-2 rounded-full hover:bg-zinc-800",
        active ? (color === 'pink' ? 'text-pink-500' : color === 'green' ? 'text-green-500' : 'text-blue-500') : "text-zinc-500",
        colorMap[color]
      )}
      onClick={onClick}
    >
      <div className="relative">
        <Icon size={18} fill={active ? "currentColor" : "none"} />
      </div>
      {count !== undefined && <span className="text-xs group-hover:font-medium">{count}</span>}
    </button>
  );
}
