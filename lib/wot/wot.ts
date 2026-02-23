import { WoT as WoTSDK } from 'nostr-wot-sdk';
import type { TrustData } from '@/types/nostr';
import { REFERENCE_PUBKEY } from '@/constants/nostr';

const sdk = new WoTSDK({
  fallback: { myPubkey: REFERENCE_PUBKEY },
});

/**
 * Thin wrapper around the nostr-wot-sdk instance.
 * Maintains a local cache for synchronous lookups (WoT.cache.get(pk))
 * used by stores and services that can't use React hooks.
 */
class WoTService {
  cache = new Map<string, TrustData>();
  myPubkey: string | null = REFERENCE_PUBKEY;

  get sdk() {
    return sdk;
  }

  async scoreSingle(pubkey: string): Promise<TrustData> {
    if (this.cache.has(pubkey)) return this.cache.get(pubkey)!;
    await this.scoreBatch([pubkey]);
    return (
      this.cache.get(pubkey) || {
        score: 0,
        distance: Infinity,
        trusted: false,
        paths: 0,
      }
    );
  }

  async scoreBatch(pubkeys: string[]): Promise<void> {
    const uncached = pubkeys.filter((pk) => !this.cache.has(pk));
    if (uncached.length === 0) return;

    try {
      const results = await sdk.getDistanceBatch(uncached, {
        includePaths: true,
        includeScores: true,
      });

      for (const pk of uncached) {
        const data = results[pk];
        if (data && typeof data === 'object' && 'hops' in data) {
          this.cache.set(pk, {
            score: data.score ?? 0,
            distance: data.hops,
            trusted: true,
            paths: data.paths ?? 0,
          });
        } else {
          this.cache.set(pk, { score: 0, distance: Infinity, trusted: false, paths: 0 });
        }
      }
    } catch {
      for (const pk of uncached) {
        if (!this.cache.has(pk)) {
          this.cache.set(pk, { score: 0, distance: Infinity, trusted: false, paths: 0 });
        }
      }
    }
  }
}

export const WoT = new WoTService();
