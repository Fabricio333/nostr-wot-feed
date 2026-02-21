import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Search, PenSquare, Loader2, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDMStore } from '@/stores/dmStore';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { useFeedStore } from '@/stores/feedStore';
import { Profiles } from '@/services/profiles';
import { Follows } from '@/services/follows';
import { timeAgo, truncateNpub, pubkeyColor } from '@/utils/helpers';

export function Messages() {
  const { pubkey: myPubkey } = useAuthStore();
  const { conversations, loading, initialized, init } = useDMStore();
  const { updateTick } = useProfileStore();
  const { notes } = useFeedStore();
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (myPubkey && !initialized) {
      init(myPubkey);
    }
  }, [myPubkey, initialized]);

  // Filter conversations by search
  const filtered = conversations.filter((conv) => {
    if (!search.trim()) return true;
    const profile = Profiles.get(conv.partnerPubkey);
    const name = profile?.displayName || profile?.name || '';
    return name.toLowerCase().includes(search.toLowerCase());
  });

  // Active in last 5 minutes — users from my follows who published recently
  const fiveMinAgo = Math.floor(Date.now() / 1000) - 5 * 60;
  const recentActivePubkeys = new Set<string>();
  for (const note of notes) {
    if (note.created_at >= fiveMinAgo && note.pubkey !== myPubkey && Follows.following.has(note.pubkey)) {
      recentActivePubkeys.add(note.pubkey);
    }
  }
  const activeNowList = [...recentActivePubkeys].slice(0, 10);

  return (
    <div className="bg-black min-h-screen text-white pb-20 md:pb-0">
      <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-zinc-800 p-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Messages</h1>
        <button className="p-2 -mr-2 text-zinc-400 hover:text-white transition-colors">
          <PenSquare size={24} />
        </button>
      </header>

      <div className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
          <input
            type="text"
            placeholder="Search messages..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-900 rounded-lg py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:ring-1 focus:ring-zinc-700"
          />
        </div>
      </div>

      {/* Loading state */}
      {loading && !initialized && (
        <div className="flex items-center justify-center gap-2 py-8 text-zinc-400">
          <Loader2 className="animate-spin" size={20} />
          <span>Loading messages...</span>
        </div>
      )}

      {/* Active in last 5 minutes */}
      {activeNowList.length > 0 && (
        <div className="mt-2">
          <h2 className="px-4 text-xs font-semibold text-zinc-500 mb-2 uppercase tracking-wider">Active in the last 5 mins</h2>
          <div className="flex gap-4 px-4 overflow-x-auto pb-4 no-scrollbar">
            {activeNowList.map((pk) => (
              <PartnerAvatar key={pk} pubkey={pk} showOnline />
            ))}
          </div>
        </div>
      )}

      {/* Conversation list */}
      <div className="flex flex-col">
        {filtered.map((conv) => (
          <ConversationRow key={conv.partnerPubkey} conv={conv} />
        ))}
      </div>

      {/* Empty state */}
      {initialized && conversations.length === 0 && (
        <div className="text-center py-16 text-zinc-500">
          <p className="text-lg mb-2">No messages yet</p>
          <p className="text-sm">Direct messages will appear here</p>
        </div>
      )}

      {/* Read-only notice */}
      {myPubkey === null && (
        <div className="text-center py-16 text-zinc-500">
          <p className="text-sm">Log in to view messages</p>
        </div>
      )}
    </div>
  );
}

function PartnerAvatar({ pubkey, showOnline }: { pubkey: string; showOnline?: boolean }) {
  const profile = Profiles.get(pubkey);
  const { updateTick } = useProfileStore();
  const name = profile?.displayName || profile?.name || truncateNpub(pubkey);
  const avatarUrl = profile?.picture || '';
  const fallbackColor = pubkeyColor(pubkey);

  return (
    <Link to={`/profile/${pubkey}`} className="flex flex-col items-center gap-1 min-w-[64px]">
      <div className="relative">
        <div
          className="w-14 h-14 rounded-full overflow-hidden border-2 border-black flex items-center justify-center"
          style={!avatarUrl ? { backgroundColor: fallbackColor } : undefined}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
          ) : (
            <User size={24} className="text-white/60" />
          )}
        </div>
        {showOnline && (
          <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-black" />
        )}
      </div>
      <span className="text-xs text-zinc-400 truncate w-full text-center">
        {(name.split(' ')[0] || name).slice(0, 8)}
      </span>
    </Link>
  );
}

function ConversationRow({ conv }: { conv: { partnerPubkey: string; lastMessage: string; lastTimestamp: number; unread: number } }) {
  const profile = Profiles.get(conv.partnerPubkey);
  const { updateTick } = useProfileStore();
  const name = profile?.displayName || profile?.name || truncateNpub(conv.partnerPubkey);
  const avatarUrl = profile?.picture || '';
  const fallbackColor = pubkeyColor(conv.partnerPubkey);

  return (
    <Link
      to={`/messages/${conv.partnerPubkey}`}
      className="flex items-center gap-4 p-4 hover:bg-zinc-900/50 active:bg-zinc-900 transition-colors"
    >
      <div className="relative">
        <div
          className="w-12 h-12 rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center"
          style={!avatarUrl ? { backgroundColor: fallbackColor } : undefined}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
          ) : (
            <User size={20} className="text-white/60" />
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline mb-0.5">
          <h3 className={cn("font-medium truncate", conv.unread > 0 ? "text-white" : "text-zinc-200")}>
            {name}
          </h3>
          <span className={cn("text-xs", conv.unread > 0 ? "text-blue-500 font-semibold" : "text-zinc-500")}>
            {timeAgo(conv.lastTimestamp)}
          </span>
        </div>
        <p className={cn("text-sm truncate pr-4", conv.unread > 0 ? "text-white font-medium" : "text-zinc-500")}>
          {conv.unread > 0 && <span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-2"></span>}
          {conv.lastMessage}
        </p>
      </div>
    </Link>
  );
}
