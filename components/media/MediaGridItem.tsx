'use client';

import React from 'react';
import { Shield } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useProfileStore } from '@/stores/profileStore';
import { useLightboxStore } from '@/stores/lightboxStore';
import { Profiles } from '@/lib/content/profiles';
import { parseContent } from '@/lib/content/content';
import { truncateNpub, trustColor } from '@/utils/helpers';
import type { Note } from '@/types/nostr';

export function MediaGridItem({ note }: { note: Note }) {
  const router = useRouter();
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
        onClick={() => router.push(`/note/${note.id}`)}
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
