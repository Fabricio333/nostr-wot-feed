'use client';

import React from 'react';
import { User } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useProfileStore } from '@/stores/profileStore';
import { Profiles } from '@/lib/content/profiles';
import { truncateNpub, pubkeyColor } from '@/utils/helpers';

export function PartnerAvatar({ pubkey, showOnline }: { pubkey: string; showOnline?: boolean }) {
  const profile = Profiles.get(pubkey);
  const { updateTick } = useProfileStore();
  const name = profile?.displayName || profile?.name || truncateNpub(pubkey);
  const avatarUrl = profile?.picture || '';
  const fallbackColor = pubkeyColor(pubkey);

  return (
    <Link href={`/profile/${pubkey}`} className="flex flex-col items-center gap-1 min-w-[64px]">
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
