import type { TrustData } from '@/types/nostr';
import { getSettings, setSetting } from './settings';
import { Signer } from './signer';
import { REFERENCE_PUBKEY } from '@/constants/nostr';

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

    // Fallback: use reference pubkey for guest/read-only mode so the WoT
    // oracle can still provide trust scores anchored to a known graph.
    if (!this.myPubkey) {
      this.myPubkey = REFERENCE_PUBKEY;
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
    const wot = (window as any).nostr.wot;

    // Strategy 1: Use batch APIs (fast, ideal for local node)
    if (this._methods.getDistanceBatch || this._methods.getTrustScoreBatch) {
      try {
        const scored = await this._scoreBatchAPIs(pubkeys, wot);
        if (scored) return;
      } catch {
        // Fall through to individual scoring
      }
    }

    // Strategy 2: Use getDetails() in parallel (no artificial delays for local node)
    if (this._methods.getDetails) {
      await this._scoreWithDetails(pubkeys, wot);
      return;
    }

    // Strategy 3: Use individual getDistance or getTrustScore
    await this._scoreIndividual(pubkeys, wot);
  }

  /**
   * Use batch APIs to score all pubkeys at once.
   * Returns true if successful.
   */
  private async _scoreBatchAPIs(pubkeys: string[], wot: any): Promise<boolean> {
    const promises: Promise<any>[] = [];

    if (this._methods.getDistanceBatch) {
      promises.push(wot.getDistanceBatch(pubkeys).catch(() => null));
    } else {
      promises.push(Promise.resolve(null));
    }

    if (this._methods.getTrustScoreBatch) {
      promises.push(wot.getTrustScoreBatch(pubkeys).catch(() => null));
    } else {
      promises.push(Promise.resolve(null));
    }

    const [distancesRaw, scoresRaw] = await Promise.all(promises);

    if (!distancesRaw && !scoresRaw) return false;

    // Normalize results to { pubkey: value } maps
    const distances = this._normalizeResult(distancesRaw, pubkeys);
    const scores = this._normalizeResult(scoresRaw, pubkeys);

    // Track which pubkeys still need paths data
    const needsPaths: string[] = [];

    for (const pk of pubkeys) {
      if (this.cache.has(pk)) continue;

      const d = distances.get(pk);
      const s = scores.get(pk);
      const distance = (typeof d === 'number' && d > 0) ? d : Infinity;
      const score = (typeof s === 'number' && s > 0) ? s : (distance < Infinity ? this._scoreFromDistance(distance) : 0);
      const trusted = distance < Infinity || score > 0;

      this.cache.set(pk, { score, distance, trusted, paths: 0 });

      if (trusted) needsPaths.push(pk);
    }

    // Background: enrich trusted pubkeys with path count via getDetails
    if (this._methods.getDetails && needsPaths.length > 0) {
      this._enrichWithDetails(needsPaths, wot);
    }

    return true;
  }

  /**
   * Normalize batch API results (could be Map, object, or array) to a Map.
   */
  private _normalizeResult(raw: any, pubkeys: string[]): Map<string, number | null> {
    const map = new Map<string, number | null>();
    if (!raw) return map;

    if (raw instanceof Map) {
      return raw;
    }
    if (Array.isArray(raw)) {
      for (let i = 0; i < pubkeys.length && i < raw.length; i++) {
        map.set(pubkeys[i], raw[i]);
      }
      return map;
    }
    if (typeof raw === 'object') {
      for (const pk of pubkeys) {
        if (pk in raw) map.set(pk, raw[pk]);
      }
    }
    return map;
  }

  /**
   * Score pubkeys using getDetails() in parallel (no delays for local node).
   */
  private async _scoreWithDetails(pubkeys: string[], wot: any): Promise<void> {
    // Pre-filter with filterByWoT if available to reduce detail calls
    let toDetail = pubkeys;
    if (this._methods.filterByWoT) {
      try {
        const maxHops = getSettings().maxHops;
        const inWot = await wot.filterByWoT(pubkeys, maxHops + 2);
        const inWotSet = new Set(Array.isArray(inWot) ? inWot : []);
        for (const pk of pubkeys) {
          if (!inWotSet.has(pk)) {
            this.cache.set(pk, { score: 0, distance: Infinity, trusted: false, paths: 0 });
          }
        }
        toDetail = pubkeys.filter((pk) => inWotSet.has(pk));
      } catch {
        // If filterByWoT fails, score all
      }
    }

    if (toDetail.length === 0) return;

    // Run getDetails in parallel batches of 10 to avoid overwhelming the extension
    const BATCH = 10;
    for (let i = 0; i < toDetail.length; i += BATCH) {
      const chunk = toDetail.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        chunk.map((pk) => wot.getDetails(pk).then((d: any) => ({ pk, d })))
      );

      for (const r of results) {
        if (r.status !== 'fulfilled' || !r.value) continue;
        const { pk, d: details } = r.value;
        if (this.cache.has(pk)) continue;

        if (details) {
          const distance = details.distance ?? Infinity;
          let score = details.score ?? details.trustScore ?? 0;
          const paths = details.pathsCount ?? details.paths ?? 0;
          const trusted = (distance < Infinity && distance > 0) || score > 0;
          if (trusted && score === 0) score = this._scoreFromDistance(distance);
          this.cache.set(pk, { score, distance, trusted, paths });
        } else {
          this.cache.set(pk, { score: 0, distance: Infinity, trusted: false, paths: 0 });
        }
      }
    }

    // Fill any remaining uncached
    for (const pk of toDetail) {
      if (!this.cache.has(pk)) {
        this.cache.set(pk, { score: 0, distance: Infinity, trusted: false, paths: 0 });
      }
    }
  }

  /**
   * Background enrichment: fetch pathsCount for already-scored pubkeys.
   */
  private async _enrichWithDetails(pubkeys: string[], wot: any): Promise<void> {
    for (const pk of pubkeys) {
      try {
        const details = await wot.getDetails(pk);
        if (details) {
          const existing = this.cache.get(pk);
          if (existing) {
            existing.paths = details.pathsCount ?? details.paths ?? existing.paths;
            if (details.score && details.score > existing.score) {
              existing.score = details.score;
            }
          }
        }
      } catch {
        // ignore individual failures
      }
    }
  }

  /**
   * Fallback: score using individual getDistance/getTrustScore calls.
   */
  private async _scoreIndividual(pubkeys: string[], wot: any): Promise<void> {
    for (const pk of pubkeys) {
      if (this.cache.has(pk)) continue;

      const result: TrustData = { score: 0, distance: Infinity, trusted: false, paths: 0 };

      try {
        if (this._methods.getDistance) {
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
      } catch {
        // ignore
      }

      this.cache.set(pk, result);
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
