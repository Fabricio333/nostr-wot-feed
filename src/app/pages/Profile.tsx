import React, { useEffect, useState } from 'react';
import { Link as LinkIcon, Shield, User, Loader2 } from 'lucide-react';
import { useParams, Link } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { useWoTStore } from '@/stores/wotStore';
import { Profiles } from '@/services/profiles';
import { WoT } from '@/services/wot';
import { Relay } from '@/services/relay';
import { parseContent } from '@/services/content';
import { truncateNpub, pubkeyColor, timeAgo, trustColor } from '@/utils/helpers';
import { nip19 } from 'nostr-tools';
import type { NostrEvent, ParsedContent } from '@/types/nostr';
import { cn } from '@/lib/utils';

export function Profile() {
  const { handle } = useParams();
  const { pubkey: myPubkey } = useAuthStore();
  const { updateTick } = useProfileStore();
  const { cacheTick } = useWoTStore();
  const [activeTab, setActiveTab] = useState<'posts' | 'replies' | 'media'>('posts');
  const [userNotes, setUserNotes] = useState<NostrEvent[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Determine which pubkey to show
  let viewPubkey = myPubkey;
  if (handle) {
    try {
      if (handle.startsWith('npub1')) {
        const decoded = nip19.decode(handle);
        if (decoded.type === 'npub') viewPubkey = decoded.data;
      } else if (/^[0-9a-f]{64}$/i.test(handle)) {
        viewPubkey = handle;
      }
    } catch {
      // ignore decode errors
    }
  }

  // Request profile data
  useEffect(() => {
    if (viewPubkey) {
      Profiles.request(viewPubkey);
      WoT.scoreBatch([viewPubkey]);
    }
  }, [viewPubkey]);

  // Fetch user's notes
  useEffect(() => {
    if (!viewPubkey || !Relay.pool) return;
    setLoadingNotes(true);
    Relay.pool.querySync(Relay.getUrls(), {
      kinds: [1],
      authors: [viewPubkey],
      limit: 50,
    }).then((events) => {
      events.sort((a, b) => b.created_at - a.created_at);
      setUserNotes(events);
      setLoadingNotes(false);
    }).catch(() => {
      setLoadingNotes(false);
    });
  }, [viewPubkey]);

  const profile = viewPubkey ? Profiles.get(viewPubkey) : null;
  const trust = viewPubkey ? WoT.cache.get(viewPubkey) : null;
  const isOwnProfile = viewPubkey === myPubkey;

  const displayName = profile?.displayName || profile?.name || (viewPubkey ? truncateNpub(viewPubkey) : 'Unknown');
  const handleStr = profile?.name ? `@${profile.name}` : (viewPubkey ? truncateNpub(viewPubkey) : '@unknown');
  const fallbackColor = viewPubkey ? pubkeyColor(viewPubkey) : '#666';

  let npubDisplay = '';
  if (viewPubkey) {
    try {
      npubDisplay = nip19.npubEncode(viewPubkey);
    } catch {
      npubDisplay = viewPubkey;
    }
  }

  // Filter notes by tab
  const filteredNotes = userNotes.filter((note) => {
    const hasReply = note.tags.some((t) => t[0] === 'e');
    const images = parseContent(note.content).filter((p) => p.type === 'image');
    if (activeTab === 'posts') return !hasReply;
    if (activeTab === 'replies') return hasReply;
    if (activeTab === 'media') return images.length > 0;
    return true;
  });

  return (
    <div className="bg-black min-h-screen text-white pb-20 md:pb-0">
      <div className="relative">
        {/* Cover Image */}
        <div
          className="h-32 md:h-48"
          style={{ background: `linear-gradient(135deg, ${fallbackColor}, ${pubkeyColor((viewPubkey || '').split('').reverse().join(''))})` }}
        />

        {/* Profile Info */}
        <div className="px-4">
          <div className="relative -mt-16 mb-4 flex justify-between items-end">
            <div className="w-32 h-32 rounded-full border-4 border-black overflow-hidden bg-zinc-800 flex items-center justify-center"
              style={!profile?.picture ? { backgroundColor: fallbackColor } : undefined}
            >
              {profile?.picture ? (
                <img src={profile.picture} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                <User size={48} className="text-white/60" />
              )}
            </div>
            {isOwnProfile ? (
              <button className="px-4 py-2 bg-transparent border border-zinc-600 rounded-full font-bold hover:bg-zinc-900 transition-colors">
                Edit Profile
              </button>
            ) : (
              <button className="px-4 py-2 bg-white text-black rounded-full font-bold hover:bg-zinc-200 transition-colors">
                Follow
              </button>
            )}
          </div>

          <div className="mb-6">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{displayName}</h1>
              {trust?.trusted && (
                <span
                  className="flex items-center gap-1 text-sm"
                  style={{ color: trustColor(trust.score) }}
                  title={`Trust: ${Math.round(trust.score * 100)}% · ${trust.distance} hop${trust.distance > 1 ? 's' : ''} · ${trust.paths} path${trust.paths !== 1 ? 's' : ''}`}
                >
                  <Shield size={16} />
                  {Math.round(trust.score * 100)}%
                </span>
              )}
            </div>
            <p className="text-zinc-500">{handleStr}</p>

            {profile?.about && (
              <p className="mt-4 text-zinc-100 whitespace-pre-wrap">{profile.about}</p>
            )}

            <div className="flex flex-wrap gap-4 mt-4 text-zinc-500 text-sm">
              {profile?.nip05 && (
                <div className="flex items-center gap-1">
                  <LinkIcon size={16} />
                  <span className="text-purple-400">{profile.nip05}</span>
                </div>
              )}
            </div>

            {/* Npub */}
            {npubDisplay && (
              <div className="mt-3 p-2 bg-zinc-900 rounded-lg text-xs text-zinc-500 font-mono truncate cursor-pointer hover:text-zinc-300"
                onClick={() => navigator.clipboard.writeText(npubDisplay)}
                title="Click to copy npub"
              >
                {npubDisplay}
              </div>
            )}

            {/* Trust details */}
            {trust && trust.trusted && (
              <div className="mt-4 p-3 bg-zinc-900 rounded-xl text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Trust Score</span>
                  <span className="font-medium" style={{ color: trustColor(trust.score) }}>
                    {Math.round(trust.score * 100)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Trust Distance</span>
                  <span className="font-medium" style={{ color: trustColor(trust.score) }}>
                    {trust.distance} hop{trust.distance > 1 ? 's' : ''}
                  </span>
                </div>
                {trust.paths > 0 && (
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Trust Paths</span>
                    <span className="font-medium" style={{ color: trustColor(trust.score) }}>
                      {trust.paths}
                    </span>
                  </div>
                )}
                {/* Visual score bar */}
                <div className="mt-2 h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.round(trust.score * 100)}%`,
                      backgroundColor: trustColor(trust.score),
                    }}
                  />
                </div>
              </div>
            )}

            {/* Untrusted indicator */}
            {trust && !trust.trusted && (
              <div className="mt-4 p-3 bg-zinc-900 rounded-xl text-sm">
                <div className="flex items-center gap-2">
                  <Shield size={16} className="text-red-400" />
                  <span className="text-red-400 font-medium">Not in your Web of Trust</span>
                </div>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="flex border-b border-zinc-800">
            <TabButton active={activeTab === 'posts'} label="Posts" onClick={() => setActiveTab('posts')} />
            <TabButton active={activeTab === 'replies'} label="Replies" onClick={() => setActiveTab('replies')} />
            <TabButton active={activeTab === 'media'} label="Media" onClick={() => setActiveTab('media')} />
          </div>

          {/* Notes */}
          {loadingNotes && (
            <div className="flex items-center justify-center gap-2 py-8 text-zinc-400">
              <Loader2 className="animate-spin" size={20} />
              <span>Loading posts...</span>
            </div>
          )}

          {!loadingNotes && filteredNotes.length === 0 && (
            <div className="py-8 text-center text-zinc-500">
              <p>No {activeTab} yet</p>
            </div>
          )}

          <div className="divide-y divide-zinc-800">
            {filteredNotes.map((note) => (
              <ProfileNote key={note.id} note={note} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileNote({ note }: { note: NostrEvent }) {
  const profile = Profiles.get(note.pubkey);
  const { updateTick } = useProfileStore();
  const displayName = profile?.displayName || profile?.name || truncateNpub(note.pubkey);
  const parsed = parseContent(note.content);
  const images = parsed.filter((p) => p.type === 'image');

  return (
    <article className="p-4 hover:bg-zinc-900/30 transition-colors">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-bold text-sm text-white">{displayName}</span>
        <span className="text-zinc-500 text-sm">· {timeAgo(note.created_at)}</span>
      </div>
      <div className="text-[15px] leading-relaxed text-zinc-100 whitespace-pre-wrap">
        {parsed.filter((p) => p.type !== 'image' && p.type !== 'video').map((part, i) => {
          if (part.type === 'link') {
            return (
              <a key={i} href={part.value} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline break-all">
                {part.value.replace(/^https?:\/\//, '').slice(0, 50)}
              </a>
            );
          }
          if (part.type === 'hashtag') {
            return <span key={i} className="text-purple-400">{part.value}</span>;
          }
          return <span key={i}>{part.value}</span>;
        })}
      </div>
      {images.length > 0 && (
        <div className="mt-2 rounded-xl overflow-hidden">
          <img src={images[0].value} alt="" className="w-full max-h-64 object-cover" loading="lazy" />
        </div>
      )}
    </article>
  );
}

function TabButton({ active, label, onClick }: { active?: boolean; label: string; onClick?: () => void }) {
  return (
    <div
      className="flex-1 text-center cursor-pointer hover:bg-zinc-900/50 transition-colors"
      onClick={onClick}
    >
      <div className={`py-4 font-medium relative ${active ? 'text-white' : 'text-zinc-500'}`}>
        {label}
        {active && (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-blue-500 rounded-full"></div>
        )}
      </div>
    </div>
  );
}
