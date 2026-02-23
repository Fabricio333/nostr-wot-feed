import type { Metadata } from 'next';
import '../styles/index.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || 'https://nostr.wtf'),
  title: 'Nostr WTF — Web of Trust Feed',
  description: 'A trust-scored Nostr feed powered by your Web of Trust.',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Nostr WTF — Web of Trust Feed',
    description:
      'A trust-scored Nostr feed powered by your Web of Trust. See notes from people you trust, filter out spam, and stay connected.',
    images: ['/icon-192.png'],
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
