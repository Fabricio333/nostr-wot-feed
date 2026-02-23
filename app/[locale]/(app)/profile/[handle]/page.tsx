import type { Metadata } from 'next';
import { fetchProfileByNpub } from '@/lib/nostr/serverFetch';
import { Profile } from '@/components/profile/Profile';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const profile = await fetchProfileByNpub(handle);
  if (!profile) return { title: 'Profile — Nostr WTF' };

  const name = profile.display_name || profile.name || 'Nostr user';
  const bio = (profile.about || '').slice(0, 200);

  return {
    title: `${name} — Nostr WTF`,
    description: bio || `${name}'s profile on Nostr WTF`,
    openGraph: {
      title: `${name} — Nostr WTF`,
      description: bio || `${name}'s profile on Nostr WTF`,
      ...(profile.picture ? { images: [profile.picture] } : {}),
    },
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  return <Profile handle={handle} />;
}
