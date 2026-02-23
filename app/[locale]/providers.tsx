'use client';

import { Toaster } from '@/components/ui/sonner';
import { MediaLightbox } from '@/components/media/MediaLightbox';
import { RelayPoolProvider } from '@/lib/nostr/relayProvider';
import { WoTProvider } from 'nostr-wot-sdk/react';
import { REFERENCE_PUBKEY } from '@/constants/nostr';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WoTProvider options={{
      fallback: { myPubkey: REFERENCE_PUBKEY },
    }}>
      <RelayPoolProvider>
        {children}
        <Toaster position="bottom-center" />
        <MediaLightbox />
      </RelayPoolProvider>
    </WoTProvider>
  );
}
