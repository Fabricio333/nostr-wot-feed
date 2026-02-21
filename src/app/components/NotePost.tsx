import React, { useState, useEffect } from 'react';
import { MessageSquare, Repeat2, Heart, Shield } from 'lucide-react';
import { NoteActionsMenu } from './NoteActionsMenu';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router';
import { useProfileStore } from '@/stores/profileStore';
import { Profiles } from '@/services/profiles';
import { Actions } from '@/services/actions';
import { ParentNotes } from '@/services/parentNotes';
import { Mute } from '@/services/mute';
import { parseContent } from '@/services/content';
import { timeAgo, truncateNpub, pubkeyColor, trustColor } from '@/utils/helpers';
import type { Note, ParsedContent as ParsedContentType } from '@/types/nostr';

export function NotePost({ note, parentTick }: { note: Note; parentTick: number }) {
  const navigate = useNavigate();
  const profile = Profiles.get(note.pubkey);
  const { updateTick } = useProfileStore();
  const [liked, setLiked] = useState(false);
  const [reposted, setReposted] = useState(false);
  const [muted, setMuted] = useState(Mute.isMuted(note.pubkey));

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

  // Reply context
  const parentNote = note.replyTo ? ParentNotes.get(note.replyTo) : null;
  const parentProfile = parentNote ? Profiles.get(parentNote.pubkey) : null;
  const parentName = parentProfile?.displayName || parentProfile?.name || (parentNote ? truncateNpub(parentNote.pubkey) : null);

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (liked) return;
    const result = await Actions.like(note.id, note.pubkey);
    if (result.success) setLiked(true);
  };

  const handleRepost = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (reposted) return;
    const result = await Actions.repost(note.id, note.pubkey);
    if (result.success) setReposted(true);
  };

  const handleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    Mute.toggle(note.pubkey);
    setMuted(!muted);
  };

  const handleNoteClick = () => {
    navigate(`/note/${note.id}`);
  };

  return (
    <article
      className="p-4 hover:bg-zinc-900/30 transition-colors cursor-pointer border-b border-zinc-800"
      onClick={handleNoteClick}
    >
      <div className="flex gap-3">
        <Link
          to={`/profile/${note.pubkey}`}
          className="flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
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
          <div className="flex items-start justify-between">
            <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
              <Link
                to={`/profile/${note.pubkey}`}
                className="font-bold hover:underline truncate text-white"
                onClick={(e) => e.stopPropagation()}
              >
                {displayName}
              </Link>
              <span className="text-zinc-500 text-sm truncate">{handle}</span>
              <span className="text-zinc-500 text-sm">· {timeAgo(note.created_at)}</span>
              {note.trusted && (
                <TrustIndicator distance={note.distance} score={note.trustScore} paths={note.paths} />
              )}
            </div>
            <NoteActionsMenu
              noteId={note.id}
              pubkey={note.pubkey}
              content={note.content}
              isMuted={muted}
              onMuteToggle={handleMute}
            />
          </div>

          {/* Reply context — clickable to open parent thread */}
          {note.replyTo && parentNote && (
            <Link
              to={`/note/${note.replyTo}`}
              className="block mt-1 mb-2 text-sm border-l-2 border-zinc-700 pl-3 hover:border-purple-500 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-zinc-500">
                ↩ Replying to{' '}
                <span className="text-purple-400">@{parentName}</span>
              </span>
              <p className="text-zinc-600 truncate text-xs mt-0.5">
                {parentNote.content.slice(0, 120)}
              </p>
            </Link>
          )}

          {/* Reply indicator when parent hasn't loaded yet */}
          {note.replyTo && !parentNote && (
            <Link
              to={`/note/${note.replyTo}`}
              className="block mt-1 mb-2 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              ↩ Reply
            </Link>
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
          <div className="mt-3 flex gap-6 text-zinc-500">
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

export function ContentDisplay({ parts }: { parts: ParsedContentType[] }) {
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
                onClick={(e) => e.stopPropagation()}
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
              <a
                key={i}
                href={part.value}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
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

function ActionButton({ icon: Icon, count, active, color, onClick, title }: any) {
  const colorMap: any = {
    blue: 'hover:text-blue-500',
    green: 'hover:text-green-500',
    pink: 'hover:text-pink-500',
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(e);
  };

  return (
    <button
      className={cn(
        "flex items-center gap-1 group transition-colors p-2 -ml-2 rounded-full hover:bg-zinc-800",
        active ? (color === 'pink' ? 'text-pink-500' : color === 'green' ? 'text-green-500' : 'text-blue-500') : "text-zinc-500",
        colorMap[color]
      )}
      onClick={handleClick}
      title={title}
    >
      <div className="relative">
        <Icon size={18} fill={active ? "currentColor" : "none"} />
      </div>
      {count !== undefined && <span className="text-xs group-hover:font-medium">{count}</span>}
    </button>
  );
}
