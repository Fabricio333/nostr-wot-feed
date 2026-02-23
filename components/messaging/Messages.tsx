'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Search, PenSquare, Loader2, Shield, ShieldOff } from 'lucide-react';
import { useDMStore } from '@/stores/dmStore';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { useFeedStore } from '@/stores/feedStore';
import { Profiles } from '@/lib/content/profiles';
import { Follows } from '@/lib/nostr/follows';
import { PartnerAvatar } from '@/components/profile/PartnerAvatar';
import { ConversationRow } from '@/components/messaging/ConversationRow';

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

  const [tab, setTab] = useState<'trusted' | 'untrusted'>('trusted');

  // Filter conversations by search
  const filtered = conversations.filter((conv) => {
    if (!search.trim()) return true;
    const profile = Profiles.get(conv.partnerPubkey);
    const name = profile?.displayName || profile?.name || '';
    return name.toLowerCase().includes(search.toLowerCase());
  });

  // Split into trusted (in WoT) and untrusted
  const trustedConversations = useMemo(
    () => filtered.filter((conv) => conv.isTrusted),
    [filtered]
  );
  const untrustedConversations = useMemo(
    () => filtered.filter((conv) => !conv.isTrusted),
    [filtered]
  );

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

      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        <button
          onClick={() => setTab('trusted')}
          className="flex-1 relative py-3 text-sm font-medium transition-colors flex items-center justify-center gap-1.5"
        >
          <Shield size={14} className={tab === 'trusted' ? 'text-purple-400' : 'text-zinc-500'} />
          <span className={tab === 'trusted' ? 'text-white' : 'text-zinc-500'}>
            Web of Trust
          </span>
          {trustedConversations.length > 0 && (
            <span className={`text-xs ml-1 ${tab === 'trusted' ? 'text-zinc-400' : 'text-zinc-600'}`}>
              {trustedConversations.length}
            </span>
          )}
          {tab === 'trusted' && (
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-purple-500 rounded-full" />
          )}
        </button>
        <button
          onClick={() => setTab('untrusted')}
          className="flex-1 relative py-3 text-sm font-medium transition-colors flex items-center justify-center gap-1.5"
        >
          <ShieldOff size={14} className={tab === 'untrusted' ? 'text-zinc-300' : 'text-zinc-500'} />
          <span className={tab === 'untrusted' ? 'text-white' : 'text-zinc-500'}>
            Not in WoT
          </span>
          {untrustedConversations.length > 0 && (
            <span className={`text-xs ml-1 ${tab === 'untrusted' ? 'text-zinc-400' : 'text-zinc-600'}`}>
              {untrustedConversations.length}
            </span>
          )}
          {tab === 'untrusted' && (
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-zinc-500 rounded-full" />
          )}
        </button>
      </div>

      {/* Conversation list */}
      {tab === 'trusted' && trustedConversations.length > 0 && (
        <div className="flex flex-col">
          {trustedConversations.map((conv) => (
            <ConversationRow key={conv.partnerPubkey} conv={conv} />
          ))}
        </div>
      )}
      {tab === 'trusted' && trustedConversations.length === 0 && initialized && conversations.length > 0 && (
        <div className="text-center py-12 text-zinc-500">
          <Shield size={24} className="mx-auto mb-2 text-zinc-600" />
          <p className="text-sm">No messages from trusted contacts</p>
        </div>
      )}
      {tab === 'untrusted' && untrustedConversations.length > 0 && (
        <div className="flex flex-col">
          {untrustedConversations.map((conv) => (
            <ConversationRow key={conv.partnerPubkey} conv={conv} />
          ))}
        </div>
      )}
      {tab === 'untrusted' && untrustedConversations.length === 0 && initialized && conversations.length > 0 && (
        <div className="text-center py-12 text-zinc-500">
          <ShieldOff size={24} className="mx-auto mb-2 text-zinc-600" />
          <p className="text-sm">No messages outside your Web of Trust</p>
        </div>
      )}

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
