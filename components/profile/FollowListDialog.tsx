'use client';

import React, { useEffect } from 'react';
import { Link } from '@/i18n/navigation';
import { User } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useProfileStore } from '@/stores/profileStore';
import { Profiles } from '@/lib/content/profiles';
import { truncateNpub, pubkeyColor } from '@/utils/helpers';
import { nip19 } from 'nostr-tools';

interface FollowListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  pubkeys: string[];
  loading?: boolean;
}

export function FollowListDialog({
  open,
  onOpenChange,
  title,
  pubkeys,
  loading = false,
}: FollowListDialogProps) {
  const { updateTick } = useProfileStore();

  useEffect(() => {
    if (open && pubkeys.length > 0) {
      for (const pk of pubkeys) {
        Profiles.request(pk);
      }
    }
  }, [open, pubkeys]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">{title}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          {loading ? (
            <div className="space-y-3 p-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="w-10 h-10 rounded-full bg-zinc-800" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-4 w-24 bg-zinc-800" />
                    <Skeleton className="h-3 w-16 bg-zinc-800" />
                  </div>
                </div>
              ))}
            </div>
          ) : pubkeys.length === 0 ? (
            <div className="py-8 text-center text-zinc-500">
              <p>No users to show</p>
            </div>
          ) : (
            <div className="space-y-1 p-2">
              {pubkeys.map((pk) => (
                <FollowListItem key={pk} pubkey={pk} onClose={() => onOpenChange(false)} />
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function FollowListItem({ pubkey, onClose }: { pubkey: string; onClose: () => void }) {
  const profile = Profiles.get(pubkey);
  const { updateTick } = useProfileStore();
  const displayName = profile?.displayName || profile?.name || truncateNpub(pubkey);
  const handle = profile?.name ? `@${profile.name}` : truncateNpub(pubkey);
  const fallbackColor = pubkeyColor(pubkey);

  let npub = '';
  try {
    npub = nip19.npubEncode(pubkey);
  } catch {
    npub = pubkey;
  }

  return (
    <Link
      href={`/profile/${npub}`}
      onClick={onClose}
      className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-800 transition-colors"
    >
      <div
        className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0"
        style={!profile?.picture ? { backgroundColor: fallbackColor } : undefined}
      >
        {profile?.picture ? (
          <img src={profile.picture} alt={displayName} className="w-full h-full object-cover" />
        ) : (
          <User size={18} className="text-white/60" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm text-white truncate">{displayName}</div>
        <div className="text-xs text-zinc-500 truncate">{handle}</div>
      </div>
    </Link>
  );
}
