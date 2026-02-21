import { SimplePool } from 'nostr-tools';
import type { NostrEvent } from '@/types/nostr';
import { getSettings, setSetting } from './settings';

type RelayStatus = 'connected' | 'eose' | 'disconnected';

// Small initial batch for fast first render; more loaded on scroll
const INITIAL_LIMIT = 30;
const FETCH_PAGE_SIZE = 25;

class RelayManager {
  pool: SimplePool | null = null;
  private _sub: any = null;
  private _followSub: any = null;
  private _onEvent: ((event: NostrEvent) => void) | null = null;
  private _onStatus: ((status: RelayStatus) => void) | null = null;

  // Per-relay connection tracking
  relayStatuses = new Map<string, boolean>();
  onRelayStatusChange: (() => void) | null = null;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

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
        // Normalize URLs (pool may add trailing slash)
        for (const url of urls) {
          const withSlash = url.endsWith('/') ? url : url + '/';
          const found = statuses.get(url) ?? statuses.get(withSlash);
          next.set(url, found === true);
        }
        // Only notify if something changed
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

  /** Start polling relay statuses every 3s */
  private _startStatusPolling(): void {
    this._stopStatusPolling();
    // Initial check after short delay (relays need time to connect)
    setTimeout(() => this.refreshStatuses(), 1500);
    this._pollTimer = setInterval(() => this.refreshStatuses(), 3000);
  }

  private _stopStatusPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
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

    if (!this.pool) {
      this.pool = new SimplePool();
    }
    this.connect();
    this._startStatusPolling();
  }

  connect(): void {
    if (!this.pool) return;

    const urls = this.getUrls();
    const settings = getSettings();
    const since = Math.floor(Date.now() / 1000) - settings.timeWindow * 60 * 60;

    this._sub = this.pool.subscribe(
      urls,
      { kinds: [1], since, limit: INITIAL_LIMIT } as any,
      {
        onevent: (event: NostrEvent) => {
          this._onEvent?.(event);
        },
        oneose: () => {
          this._onStatus?.('eose');
        },
        onclose: () => {
          this._onStatus?.('disconnected');
          setTimeout(() => this.reconnect(), 3000);
        },
      }
    );

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

    const urls = this.getUrls();
    const settings = getSettings();
    const since = customSince ?? Math.floor(Date.now() / 1000) - settings.timeWindow * 60 * 60;

    try {
      const events = await this.pool.querySync(
        urls,
        { kinds: [1], since, until, limit } as any
      );
      return events as NostrEvent[];
    } catch {
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

    const urls = this.getUrls();
    const settings = getSettings();
    const since = customSince ?? Math.floor(Date.now() / 1000) - settings.timeWindow * 60 * 60;

    try {
      // Chunk pubkeys to avoid relay limits
      const CHUNK = 150;
      const allEvents: NostrEvent[] = [];
      for (let i = 0; i < pubkeys.length; i += CHUNK) {
        const chunk = pubkeys.slice(i, i + CHUNK);
        const events = await this.pool.querySync(
          urls,
          { kinds: [1], authors: chunk, since, until, limit } as any
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
    // Reset statuses — they'll be re-populated by polling
    this.relayStatuses.clear();
    this.onRelayStatusChange?.();
    this.connect();
    // Refresh after relays have time to reconnect
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

    // Close previous following subscription
    if (this._followSub) {
      this._followSub.close();
      this._followSub = null;
    }

    const urls = this.getUrls();

    // Chunk pubkeys to avoid relay filter limits (150 per filter)
    const CHUNK = 150;
    const filters: any[] = [];
    for (let i = 0; i < pubkeys.length; i += CHUNK) {
      filters.push({
        kinds: [1],
        authors: pubkeys.slice(i, i + CHUNK),
        limit: 100,
      });
    }

    // Use subscribeMap to send multiple filters per relay correctly
    const requests = urls.flatMap((url) =>
      filters.map((filter) => ({ url, filter }))
    );

    let eoseFired = false;
    this._followSub = this.pool.subscribeMap(requests, {
      onevent: (event: NostrEvent) => {
        onEvent(event);
      },
      oneose: () => {
        if (!eoseFired) {
          eoseFired = true;
          onEose?.();
        }
      },
    });
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
