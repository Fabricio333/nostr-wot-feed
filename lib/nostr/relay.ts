import { SimplePool } from 'nostr-tools';
import type { NostrEvent } from '@/types/nostr';
import { getSettings, setSetting } from '@/lib/storage/settings';
import { DB } from '@/lib/storage/db';
import { RelayStats } from './relayStats';
import { QueryBatcher } from './queryBatcher';

type RelayStatus = 'connected' | 'eose' | 'disconnected';

const INITIAL_LIMIT = 150;
const FETCH_PAGE_SIZE = 25;

class RelayManager {
  pool: SimplePool | null = null;
  private _sub: any = null;
  private _followSub: any = null;
  private _onEvent: ((event: NostrEvent) => void) | null = null;
  private _onStatus: ((status: RelayStatus) => void) | null = null;
  private _eoseFired = false;

  // Per-relay connection tracking
  relayStatuses = new Map<string, boolean>();
  onRelayStatusChange: (() => void) | null = null;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  // Subscription start time for latency tracking
  private _subStartTime = 0;

  getUrls(): string[] {
    return getSettings().relays;
  }

  getConnectedCount(): number {
    let count = 0;
    for (const v of this.relayStatuses.values()) {
      if (v) count++;
    }
    return count;
  }

  /** Poll per-relay status from SimplePool.listConnectionStatus() */
  refreshStatuses(): void {
    if (!this.pool) return;
    try {
      const statuses = (this.pool as any).listConnectionStatus?.();
      if (statuses instanceof Map) {
        const urls = this.getUrls();
        const next = new Map<string, boolean>();
        for (const url of urls) {
          const withSlash = url.endsWith('/') ? url : url + '/';
          const found = statuses.get(url) ?? statuses.get(withSlash);
          next.set(url, found === true);
        }
        let changed = next.size !== this.relayStatuses.size;
        if (!changed) {
          for (const [k, v] of next) {
            if (this.relayStatuses.get(k) !== v) { changed = true; break; }
          }
        }
        if (changed) {
          this.relayStatuses = next;
          this.onRelayStatusChange?.();
        }
      }
    } catch {
      // listConnectionStatus not available
    }
  }

  private _startStatusPolling(): void {
    this._stopStatusPolling();
    setTimeout(() => this.refreshStatuses(), 1500);
    this._pollTimer = setInterval(() => this.refreshStatuses(), 3000);
  }

  private _stopStatusPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /** Create pool eagerly (without subscribing to feed). Safe to call multiple times. */
  ensurePool(): void {
    if (!this.pool) {
      this.pool = new SimplePool();
      QueryBatcher.setPool(this.pool);
    }
  }

  init(
    onEvent: (event: NostrEvent) => void,
    onStatus: (status: RelayStatus) => void
  ): void {
    this._onEvent = onEvent;
    this._onStatus = onStatus;

    // Reuse existing pool if already connected
    if (this.pool && this._sub) {
      this._onStatus?.('connected');
      return;
    }

    this.ensurePool();
    // connect is async but we don't need to block init on it —
    // the subscription will be set up when the async work completes
    this._doConnect();
    this._startStatusPolling();
  }

  /**
   * Internal async connect — resolves DB lookup then subscribes.
   * Not awaited from init() so the caller isn't blocked.
   */
  private async _doConnect(): Promise<void> {
    if (!this.pool) return;

    const rawUrls = this.getUrls();
    const urls = RelayStats.getPrioritizedUrls(rawUrls);
    const settings = getSettings();

    // Smart since: use cached latest event timestamp with 60s overlap
    let cachedLatest: number | null = null;
    try {
      cachedLatest = await DB.getLatestEventTimestamp();
    } catch {
      // DB not ready yet — use time window only
    }
    const timeWindowSince = Math.floor(Date.now() / 1000) - settings.timeWindow * 60 * 60;
    const since = cachedLatest
      ? Math.max(cachedLatest - 60, timeWindowSince)
      : timeWindowSince;

    this._eoseFired = false;
    this._subStartTime = Date.now();

    // pool.subscribe fires oneose once when ALL relays have sent EOSE
    this._sub = this.pool.subscribe(urls, { kinds: [1], since, limit: INITIAL_LIMIT } as any, {
      onevent: (event: NostrEvent) => {
        this._onEvent?.(event);
      },
      oneose: () => {
        if (this._eoseFired) return;
        this._eoseFired = true;

        // Record success for all connected relays
        const elapsed = Date.now() - this._subStartTime;
        for (const url of urls) {
          RelayStats.recordSuccess(url, elapsed);
        }

        this._onStatus?.('eose');
      },
      onclose: (reasons?: string[]) => {
        this._onStatus?.('disconnected');
        // Reconnect with backoff based on first failing relay
        const backoff = 3000;
        setTimeout(() => this.reconnect(), backoff);
      },
    });

    this._onStatus?.('connected');
  }

  /**
   * Fetch older notes for pagination. One-shot query — does not stay open.
   * Uses `until` to page backward in time.
   */
  async fetchOlderNotes(
    until: number,
    limit: number = FETCH_PAGE_SIZE,
    customSince?: number
  ): Promise<NostrEvent[]> {
    if (!this.pool) return [];

    const rawUrls = this.getUrls();
    const urls = RelayStats.getPrioritizedUrls(rawUrls);
    const settings = getSettings();
    const since = customSince ?? Math.floor(Date.now() / 1000) - settings.timeWindow * 60 * 60;

    const startTime = Date.now();
    try {
      const events = await QueryBatcher.query(
        urls,
        { kinds: [1], since, until, limit }
      );
      // Record success for responsive relays
      const elapsed = Date.now() - startTime;
      for (const url of urls) {
        RelayStats.recordSuccess(url, elapsed);
      }
      return events as NostrEvent[];
    } catch {
      for (const url of urls) {
        RelayStats.recordFailure(url, 'querySync failed');
      }
      return [];
    }
  }

  /**
   * Fetch older notes from followed authors specifically.
   */
  async fetchOlderFollowingNotes(
    pubkeys: string[],
    until: number,
    limit: number = FETCH_PAGE_SIZE,
    customSince?: number
  ): Promise<NostrEvent[]> {
    if (!this.pool || pubkeys.length === 0) return [];

    const rawUrls = this.getUrls();
    const urls = RelayStats.getPrioritizedUrls(rawUrls);
    const settings = getSettings();
    const since = customSince ?? Math.floor(Date.now() / 1000) - settings.timeWindow * 60 * 60;

    try {
      // Chunk pubkeys to avoid relay limits
      const CHUNK = 150;
      const allEvents: NostrEvent[] = [];
      for (let i = 0; i < pubkeys.length; i += CHUNK) {
        const chunk = pubkeys.slice(i, i + CHUNK);
        const events = await QueryBatcher.query(
          urls,
          { kinds: [1], authors: chunk, since, until, limit }
        );
        allEvents.push(...(events as NostrEvent[]));
      }
      return allEvents;
    } catch {
      return [];
    }
  }

  reconnect(): void {
    if (this._sub) {
      this._sub.close();
      this._sub = null;
    }
    this.relayStatuses.clear();
    this.onRelayStatusChange?.();
    this._doConnect();
    setTimeout(() => this.refreshStatuses(), 2000);
  }

  /**
   * Subscribe to notes from specific authors (for the Following tab).
   * Fetches recent notes + keeps a live subscription.
   */
  async subscribeFollowing(
    pubkeys: string[],
    onEvent: (event: NostrEvent) => void,
    onEose?: () => void
  ): Promise<void> {
    if (!this.pool || pubkeys.length === 0) return;

    if (this._followSub) {
      this._followSub.close();
      this._followSub = null;
    }

    const rawUrls = this.getUrls();
    const urls = RelayStats.getPrioritizedUrls(rawUrls);

    const settings = getSettings();
    const since = Math.floor(Date.now() / 1000) - settings.timeWindow * 60 * 60;

    // For large follow lists, chunk pubkeys into separate filter objects
    const CHUNK = 150;
    if (pubkeys.length <= CHUNK) {
      this._followSub = this.pool.subscribe(
        urls,
        { kinds: [1], authors: pubkeys, since, limit: 200 } as any,
        {
          onevent: (event: NostrEvent) => onEvent(event),
          oneose: () => onEose?.(),
        }
      );
    } else {
      // For large follow lists, use subscribeMap to send chunked filters per relay
      const filters: any[] = [];
      for (let i = 0; i < pubkeys.length; i += CHUNK) {
        filters.push({
          kinds: [1],
          authors: pubkeys.slice(i, i + CHUNK),
          since,
          limit: 200,
        });
      }
      const requests = urls.flatMap((url) =>
        filters.map((filter) => ({ url, filter }))
      );

      let eoseFired = false;
      this._followSub = this.pool.subscribeMap(requests, {
        onevent: (event: NostrEvent) => onEvent(event),
        oneose: () => {
          if (!eoseFired) {
            eoseFired = true;
            onEose?.();
          }
        },
      });
    }
  }

  /**
   * Fetch the user's NIP-65 relay list (kind 10002) from relays.
   * Falls back to relay hints in kind 3 (contacts) if no 10002 found.
   */
  async fetchUserRelays(pubkey: string): Promise<string[]> {
    if (!this.pool) return [];

    const urls = this.getUrls();
    try {
      // Try NIP-65 relay list metadata (kind 10002)
      const events = await QueryBatcher.query(
        urls,
        { kinds: [10002], authors: [pubkey] }
      );

      if (events.length > 0) {
        // Sort by created_at desc to get the latest
        events.sort((a: any, b: any) => b.created_at - a.created_at);
        const relayTags = (events[0] as any).tags.filter(
          (t: string[]) => t[0] === 'r'
        );
        const relayUrls = relayTags
          .map((t: string[]) => t[1])
          .filter((u: string) => u && u.startsWith('wss://'));
        if (relayUrls.length > 0) return relayUrls;
      }

      // Fallback: try kind 3 (contacts) which sometimes has relay JSON in content
      const k3 = await QueryBatcher.query(
        urls,
        { kinds: [3], authors: [pubkey] }
      );
      if (k3.length > 0) {
        k3.sort((a: any, b: any) => b.created_at - a.created_at);
        const content = (k3[0] as any).content;
        if (content) {
          try {
            const relayMap = JSON.parse(content);
            const parsed = Object.keys(relayMap).filter((u) =>
              u.startsWith('wss://')
            );
            if (parsed.length > 0) return parsed;
          } catch {
            // content not valid JSON
          }
        }
      }
    } catch {
      // query failed
    }
    return [];
  }

  async addRelay(url: string): Promise<boolean> {
    const urls = this.getUrls();
    if (urls.includes(url)) return false;
    setSetting('relays', [...urls, url]);
    this.reconnect();
    return true;
  }

  async removeRelay(url: string): Promise<boolean> {
    const urls = this.getUrls();
    const filtered = urls.filter((u) => u !== url);
    if (filtered.length === 0) return false;
    setSetting('relays', filtered);
    this.reconnect();
    return true;
  }

  async publishEvent(event: NostrEvent): Promise<void> {
    if (!this.pool) throw new Error('Pool not initialized');
    await Promise.any(this.pool.publish(this.getUrls(), event));
  }

  destroy(): void {
    this._stopStatusPolling();
    if (this._followSub) {
      this._followSub.close();
      this._followSub = null;
    }
    if (this._sub) {
      this._sub.close();
      this._sub = null;
    }
    if (this.pool) {
      this.pool.close(this.getUrls());
      this.pool = null;
    }
    this.relayStatuses.clear();
  }
}

export const Relay = new RelayManager();
