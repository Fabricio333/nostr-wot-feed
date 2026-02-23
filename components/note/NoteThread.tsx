'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Link } from '@/i18n/navigation';
import { ArrowLeft, Loader2, MessageSquare } from 'lucide-react';
import { useRelayPool } from '@/lib/nostr/relayProvider';
import { Profiles } from '@/lib/content/profiles';
import { WoT } from '@/lib/wot/wot';
import { ParentNotes } from '@/lib/content/parentNotes';
import { processEvent, filterNotes } from '@/lib/wot/feed';
import { getSettings } from '@/lib/storage/settings';
import { getReplyToId } from '@/utils/nip10';
import { NotePost } from '@/components/note/NotePost';
import { useFeedStore } from '@/stores/feedStore';
import { useProfileStore } from '@/stores/profileStore';
import type { Note, NostrEvent } from '@/types/nostr';

export function NoteThread({ id }: { id?: string }) {
  const { notesById } = useFeedStore();
  const { updateTick } = useProfileStore();
  const { query } = useRelayPool();
  const [targetNote, setTargetNote] = useState<Note | null>(null);
  const [parentChain, setParentChain] = useState<Note[]>([]);
  const [replies, setReplies] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingReplies, setLoadingReplies] = useState(true);
  const [filteredCount, setFilteredCount] = useState(0);
  const targetRef = useRef<HTMLDivElement>(null);

  // Fetch the target note
  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setLoadingReplies(true);
    setParentChain([]);
    setReplies([]);

    // Check if we already have it in the feed store
    const cached = notesById.get(id);
    if (cached) {
      setTargetNote(cached);
      setLoading(false);
      fetchParentChain(cached);
      fetchReplies(id);
      return;
    }

    // Fetch from relays
    query({ ids: [id] }, {
      onUpdate: (events) => {
        if (events.length > 0) {
          const note = processEvent(events[0]);
          Profiles.request(note.pubkey);
          WoT.scoreBatch([note.pubkey]);
          setTargetNote(note);
        }
      },
    }).then((events) => {
      if (events.length > 0) {
        const note = processEvent(events[0]);
        Profiles.request(note.pubkey);
        WoT.scoreBatch([note.pubkey]);
        setTargetNote(note);
        fetchParentChain(note);
      }
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });

    fetchReplies(id);
  }, [id]);


  // Scroll to target note once parent chain loads
  useEffect(() => {
    if (parentChain.length > 0 && targetRef.current) {
      targetRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [parentChain.length]);

  async function fetchParentChain(note: Note) {
    const chain: Note[] = [];
    let currentReplyTo = note.replyTo;

    // Walk up the reply chain (max 10 levels to avoid infinite loops)
    let depth = 0;
    while (currentReplyTo && depth < 10) {
      depth++;
      // Check local cache first
      const cachedNote = notesById.get(currentReplyTo);
      if (cachedNote) {
        chain.unshift(cachedNote);
        currentReplyTo = cachedNote.replyTo;
        continue;
      }

      // Fetch from relay (covers both ParentNotes cache hit and miss)
      try {
        const events = await query({ ids: [currentReplyTo] });
        if (events.length > 0) {
          const parentNote = processEvent(events[0]);
          Profiles.request(parentNote.pubkey);
          chain.unshift(parentNote);
          currentReplyTo = parentNote.replyTo;
        } else {
          break;
        }
      } catch {
        break;
      }
    }

    setParentChain(chain);
  }

  function processReplies(events: NostrEvent[], noteId: string) {
    // Filter to only direct replies (where the reply-to points to this note)
    const directReplies = events.filter((ev) => {
      const replyTo = getReplyToId(ev.tags);
      return replyTo === noteId;
    });

    // Sort by oldest first (chronological)
    directReplies.sort((a, b) => a.created_at - b.created_at);

    const replyNotes = directReplies.map((ev) => {
      Profiles.request(ev.pubkey);
      return processEvent(ev);
    });

    // Re-process with trust data
    const scoredReplies = replyNotes.map((note) => {
      const trust = WoT.cache.get(note.pubkey);
      if (!trust) return note;
      return { ...note, trustScore: trust.score, distance: trust.distance, trusted: trust.trusted, paths: trust.paths };
    });

    const settings = getSettings();
    const filtered = filterNotes(scoredReplies, {
      trustedOnly: settings.trustedOnly,
      maxHops: settings.maxHops,
      trustThreshold: settings.trustThreshold,
    });

    setFilteredCount(scoredReplies.length - filtered.length);
    setReplies(filtered);
  }

  async function fetchReplies(noteId: string) {
    try {
      const events: NostrEvent[] = await query(
        { kinds: [1], '#e': [noteId], limit: 50 },
        {
          onUpdate: (allEvents) => {
            processReplies(allEvents as NostrEvent[], noteId);
          },
        }
      );

      // Score authors and filter by WoT
      const pubkeys = [...new Set((events as NostrEvent[]).map((ev) => ev.pubkey))];
      if (pubkeys.length > 0) {
        await WoT.scoreBatch(pubkeys);
      }

      processReplies(events, noteId);
    } catch {
      // ignore
    }
    setLoadingReplies(false);
  }

  return (
    <div className="bg-black min-h-screen text-white pb-24 md:pb-0">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-zinc-800 p-4 flex items-center gap-3">
        <Link href="/" className="p-1 -ml-1 hover:bg-zinc-800 rounded-full transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-lg font-bold">Thread</h1>
      </header>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-zinc-400">
          <Loader2 className="animate-spin" size={20} />
          <span>Loading note...</span>
        </div>
      )}

      {/* Not found */}
      {!loading && !targetNote && (
        <div className="text-center py-16 text-zinc-500">
          <p className="text-lg mb-2">Note not found</p>
          <p className="text-sm">This note may have been deleted or is unavailable from connected relays.</p>
          <Link href="/" className="text-purple-400 text-sm hover:text-purple-300 mt-4 inline-block">
            Back to feed
          </Link>
        </div>
      )}

      {targetNote && (
        <div className="max-w-xl mx-auto">
          {/* Parent chain */}
          {parentChain.length > 0 && (
            <div className="border-l-2 border-zinc-700 ml-7">
              {parentChain.map((note) => (
                <div key={note.id} className="relative">
                  <div className="absolute left-0 top-1/2 w-3 h-px bg-zinc-700" />
                  <NotePost note={note} />
                </div>
              ))}
            </div>
          )}

          {/* Target note — highlighted */}
          <div ref={targetRef} className="ring-1 ring-purple-500/30 bg-purple-500/5">
            <NotePost note={targetNote} />
          </div>

          {/* Replies section */}
          <div className="border-t border-zinc-800">
            <div className="px-4 py-3 flex items-center gap-2 text-zinc-400 text-sm">
              <MessageSquare size={16} />
              <span>
                {loadingReplies
                  ? 'Loading replies...'
                  : replies.length > 0
                  ? `${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}${filteredCount > 0 ? ` (${filteredCount} filtered by WoT)` : ''}`
                  : 'No replies yet'}
              </span>
            </div>

            {loadingReplies && (
              <div className="flex items-center justify-center gap-2 py-6 text-zinc-500">
                <Loader2 className="animate-spin" size={16} />
              </div>
            )}

            {/* Reply list */}
            <div className="divide-y divide-zinc-800 border-l-2 border-zinc-700 ml-7">
              {replies.map((reply) => (
                <div key={reply.id} className="relative">
                  <div className="absolute left-0 top-6 w-3 h-px bg-zinc-700" />
                  <NotePost note={reply} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
