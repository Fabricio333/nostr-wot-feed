import type { TrustData } from '@/types/nostr';
import { getSettings, setSetting } from './settings';
import { Signer } from './signer';

const WOT_ORACLE_URL = 'https://wot-oracle.mappingbitcoin.com';

class WoTService {
  cache = new Map<string, TrustData>();
  myPubkey: string | null = null;
  hasExtension = false;
  extensionSettingsImported = false;
  private _methods: Record<string, boolean> = {};

  private _scoreFromDistance(d: number): number {
    if (d <= 0 || d === Infinity) return 0;
    if (d === 1) return 1.0;
    if (d === 2) return 0.5;
    if (d === 3) return 0.25;
    return 0.1;
  }

  async init(): Promise<{ hasExtension: boolean }> {
    const w = window as any;
    this.hasExtension = !!(w.nostr?.wot);

    if (w.nostr?.wot) {
      const wot = w.nostr.wot;
      for (const k in wot) {
        if (typeof wot[k] === 'function') {
          this._methods[k] = true;
        }
      }
    }

    if (Signer.isLoggedIn()) {
      try {
        this.myPubkey = await Signer.getPublicKey();
      } catch {
        // ignore
      }
    }

    // Import settings from the WoT extension if available
    if (this.hasExtension && !this.extensionSettingsImported) {
      await this._importExtensionSettings();
    }

    return { hasExtension: this.hasExtension };
  }

  /**
   * Try to import trust settings from the WoT browser extension.
   * The extension may expose getSettings(), getConfig(), or individual getters.
   * These override local defaults to keep the app in sync with the extension.
   */
  private async _importExtensionSettings(): Promise<void> {
    const wot = (window as any).nostr?.wot;
    if (!wot) return;

    try {
      // Try getSettings() or getConfig()
      let extSettings: any = null;

      if (typeof wot.getSettings === 'function') {
        extSettings = await wot.getSettings();
      } else if (typeof wot.getConfig === 'function') {
        extSettings = await wot.getConfig();
      }

      if (extSettings && typeof extSettings === 'object') {
        // Import maxHops / maxDistance
        const maxHops = extSettings.maxHops ?? extSettings.maxDistance ?? extSettings.depth;
        if (typeof maxHops === 'number' && maxHops > 0 && maxHops <= 10) {
          setSetting('maxHops', maxHops);
        }

        // Import trust threshold
        const threshold = extSettings.trustThreshold ?? extSettings.minTrust ?? extSettings.threshold;
        if (typeof threshold === 'number' && threshold >= 0 && threshold <= 100) {
          setSetting('trustThreshold', threshold);
        }

        // Import relays if the extension provides them
        const relays = extSettings.relays ?? extSettings.relayUrls;
        if (Array.isArray(relays) && relays.length > 0 && relays.every((r: any) => typeof r === 'string' && r.startsWith('wss://'))) {
          setSetting('relays', relays);
        }

        this.extensionSettingsImported = true;
        return;
      }
    } catch {
      // getSettings not supported or failed
    }

    // Fallback: try individual getters
    try {
      if (typeof wot.getMaxHops === 'function') {
        const h = await wot.getMaxHops();
        if (typeof h === 'number' && h > 0) setSetting('maxHops', h);
      }
      if (typeof wot.getMaxDistance === 'function') {
        const d = await wot.getMaxDistance();
        if (typeof d === 'number' && d > 0) setSetting('maxHops', d);
      }
    } catch {
      // individual getters not supported
    }

    this.extensionSettingsImported = true;
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

    // Late detection: extension might have loaded after init
    if (!this.hasExtension && (window as any).nostr?.wot) {
      await this.init();
    }

    if (this.hasExtension) {
      await this._scoreBatchExtension(uncached);
    } else if (this.myPubkey) {
      await this._scoreBatchOracle(uncached);
    } else {
      for (const pk of uncached) {
        this.cache.set(pk, {
          score: 0,
          distance: Infinity,
          trusted: false,
          paths: 0,
        });
      }
    }
  }

  private async _scoreBatchExtension(pubkeys: string[]): Promise<void> {
    const w = window as any;
    const wot = w.nostr.wot;
    let toDetail = pubkeys;

    if (this._methods.filterByWoT) {
      try {
        const maxHops = getSettings().maxHops;
        const inWot = await wot.filterByWoT(pubkeys, maxHops + 2);
        const inWotSet = new Set(Array.isArray(inWot) ? inWot : []);

        for (const pk of pubkeys) {
          if (!inWotSet.has(pk)) {
            this.cache.set(pk, {
              score: 0,
              distance: Infinity,
              trusted: false,
              paths: 0,
            });
          }
        }

        toDetail = pubkeys.filter((pk) => inWotSet.has(pk));
      } catch {
        toDetail = pubkeys;
      }
    }

    if (toDetail.length === 0) return;

    const DELAY_MS = 125;

    for (let i = 0; i < toDetail.length; i++) {
      const pk = toDetail[i];
      if (this.cache.has(pk)) continue;

      const result: TrustData = {
        score: 0,
        distance: Infinity,
        trusted: false,
        paths: 0,
      };

      try {
        if (this._methods.getDetails) {
          const details = await wot.getDetails(pk);
          if (details) {
            result.distance = details.distance ?? Infinity;
            result.score = details.trustScore ?? details.score ?? 0;
            result.paths = details.pathsCount ?? details.paths ?? 0;
            if (result.distance !== null && result.distance < Infinity && result.distance > 0) result.trusted = true;
            if (result.score > 0) result.trusted = true;
            if (result.trusted && result.score === 0) {
              result.score = this._scoreFromDistance(result.distance);
            }
          }
        } else if (this._methods.getDistance) {
          const raw = await wot.getDistance(pk);
          const d = typeof raw === 'number' ? raw : raw?.distance ?? raw?.hops ?? null;
          if (d !== null && d > 0) {
            result.distance = d;
            result.trusted = true;
            result.score = this._scoreFromDistance(d);
          }
        } else if (this._methods.getTrustScore) {
          const raw = await wot.getTrustScore(pk);
          const s = typeof raw === 'number' ? raw : raw?.score ?? raw?.trust ?? 0;
          if (s > 0) {
            result.score = s;
            result.trusted = true;
          }
        }
      } catch (e: any) {
        if (e.message?.includes('Rate limit')) {
          await new Promise((r) => setTimeout(r, 2000));
          i--;
          continue;
        }
      }

      this.cache.set(pk, result);

      if (i < toDetail.length - 1) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    }
  }

  private async _scoreBatchOracle(pubkeys: string[]): Promise<void> {
    if (!this.myPubkey) return;

    for (let i = 0; i < pubkeys.length; i += 50) {
      const chunk = pubkeys.slice(i, i + 50);
      const uncached = chunk.filter((pk) => !this.cache.has(pk));
      if (uncached.length === 0) continue;

      try {
        const resp = await fetch(`${WOT_ORACLE_URL}/distance/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: this.myPubkey, targets: uncached }),
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (data && typeof data === 'object') {
          for (const pk of uncached) {
            const d = data[pk] ?? data.distances?.[pk] ?? null;
            if (d !== null && typeof d === 'number' && d > 0) {
              this.cache.set(pk, {
                score: this._scoreFromDistance(d),
                distance: d,
                trusted: true,
                paths: 0,
              });
            } else {
              this.cache.set(pk, {
                score: 0,
                distance: Infinity,
                trusted: false,
                paths: 0,
              });
            }
          }
        }
      } catch {
        for (const pk of uncached) {
          if (this.cache.has(pk)) continue;
          try {
            const r = await fetch(
              `${WOT_ORACLE_URL}/distance?from=${this.myPubkey}&to=${pk}`
            );
            if (r.ok) {
              const d = await r.json();
              const dist = typeof d === 'number' ? d : d?.distance ?? null;
              if (dist !== null && dist > 0) {
                this.cache.set(pk, {
                  score: this._scoreFromDistance(dist),
                  distance: dist,
                  trusted: true,
                  paths: 0,
                });
                continue;
              }
            }
          } catch {
            // ignore individual failures
          }
          this.cache.set(pk, {
            score: 0,
            distance: Infinity,
            trusted: false,
            paths: 0,
          });
        }
      }
    }
  }
}

export const WoT = new WoTService();
