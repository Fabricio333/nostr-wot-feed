import { REFERENCE_PUBKEY, MAX_HOPS } from '@/constants/nostr';

// Use the same oracle the client already uses successfully
const WOT_ORACLE_URL = 'https://wot-oracle.mappingbitcoin.com';
const BATCH_SIZE = 50; // Oracle handles 50 targets per batch
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CachedResult {
  inWoT: boolean;
  distance: number | null;
  timestamp: number;
}

const cache = new Map<string, CachedResult>();

/**
 * Filter pubkeys to only those within the reference pubkey's WoT.
 * Uses the WoT oracle batch API (same one the client uses).
 */
export async function filterTrustedPubkeys(
  pubkeys: string[],
): Promise<Set<string>> {
  const now = Date.now();
  const trusted = new Set<string>();
  const uncached: string[] = [];

  for (const pk of pubkeys) {
    const cached = cache.get(pk);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      if (cached.inWoT) trusted.add(pk);
    } else {
      uncached.push(pk);
    }
  }

  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const chunk = uncached.slice(i, i + BATCH_SIZE);
    try {
      const resp = await fetch(`${WOT_ORACLE_URL}/distance/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: REFERENCE_PUBKEY, targets: chunk }),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      // Build a lookup from oracle results
      const resultMap = new Map<string, number>();
      if (data.results && Array.isArray(data.results)) {
        for (const r of data.results) {
          if (r.to && typeof r.hops === 'number') {
            resultMap.set(r.to, r.hops);
          }
        }
      }

      for (const pk of chunk) {
        const hops = resultMap.get(pk);
        if (hops !== undefined && hops > 0 && hops <= MAX_HOPS) {
          cache.set(pk, { inWoT: true, distance: hops, timestamp: now });
          trusted.add(pk);
        } else {
          cache.set(pk, { inWoT: false, distance: hops ?? null, timestamp: now });
        }
      }
    } catch (err) {
      console.warn('[ServerWoT] Batch oracle failed, trying individual:', err);
      // Fallback: individual distance queries
      for (const pk of chunk) {
        try {
          const r = await fetch(
            `${WOT_ORACLE_URL}/distance?from=${REFERENCE_PUBKEY}&to=${pk}`,
          );
          if (r.ok) {
            const d = await r.json();
            const dist = typeof d === 'number' ? d : d?.distance ?? d?.hops ?? null;
            if (dist !== null && dist > 0 && dist <= MAX_HOPS) {
              cache.set(pk, { inWoT: true, distance: dist, timestamp: now });
              trusted.add(pk);
              continue;
            }
          }
        } catch {
          // ignore individual failures
        }
        cache.set(pk, { inWoT: false, distance: null, timestamp: now });
      }
    }
  }

  return trusted;
}

// Periodic cache cleanup to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [pk, entry] of cache) {
    if (now - entry.timestamp > CACHE_TTL_MS * 2) {
      cache.delete(pk);
    }
  }
}, CACHE_TTL_MS);
