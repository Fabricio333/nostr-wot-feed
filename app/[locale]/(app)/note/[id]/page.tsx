import type { Metadata } from 'next';
import { fetchNoteById, fetchProfileByPubkey } from '@/lib/nostr/serverFetch';
import { NoteThread } from '@/components/note/NoteThread';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const note = await fetchNoteById(id);
  if (!note) return { title: 'Note — Nostr WTF' };

  const profile = await fetchProfileByPubkey(note.pubkey);
  const authorName =
    profile?.display_name || profile?.name || 'Nostr user';
  const content = note.content.slice(0, 200);

  return {
    title: `${authorName} on Nostr WTF`,
    description: content,
    openGraph: {
      title: `${authorName} on Nostr WTF`,
      description: content,
      type: 'article',
    },
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <NoteThread id={id} />;
}
