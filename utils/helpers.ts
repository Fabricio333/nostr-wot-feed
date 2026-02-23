import { nip19 } from 'nostr-tools';

export function truncateNpub(hexPubkey: string): string {
  try {
    const np = nip19.npubEncode(hexPubkey);
    return np.slice(0, 12) + '...' + np.slice(-4);
  } catch {
    return hexPubkey.slice(0, 10) + '...';
  }
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function pubkeyColor(hex: string): string {
  let hash = 0;
  for (let i = 0; i < Math.min(8, hex.length); i++) {
    hash = parseInt(hex[i], 16) + (hash << 4);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 50%, 60%)`;
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getInitials(name: string, fallback: string): string {
  return (name || fallback.slice(0, 2)).slice(0, 2).toUpperCase();
}

/** Red (0%) → Green (100%) trust score color */
export function trustColor(score: number): string {
  const clamped = Math.max(0, Math.min(1, score));
  const hue = Math.round(clamped * 120);
  return `hsl(${hue}, 70%, 45%)`;
}
