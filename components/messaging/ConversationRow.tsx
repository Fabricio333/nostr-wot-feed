'use client';

import React from 'react';
import { User } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { useProfileStore } from '@/stores/profileStore';
import { Profiles } from '@/lib/content/profiles';
import { timeAgo, truncateNpub, pubkeyColor } from '@/utils/helpers';

export function ConversationRow({ conv }: { conv: { partnerPubkey: string; lastMessage: string; lastTimestamp: number; unread: number } }) {
  const profile = Profiles.get(conv.partnerPubkey);
  const { updateTick } = useProfileStore();
  const name = profile?.displayName || profile?.name || truncateNpub(conv.partnerPubkey);
  const avatarUrl = profile?.picture || '';
  const fallbackColor = pubkeyColor(conv.partnerPubkey);

  return (
    <Link
      href={`/messages/${conv.partnerPubkey}`}
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
