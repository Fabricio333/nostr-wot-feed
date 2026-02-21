import { SimplePool } from 'nostr-tools';
import type { NostrEvent } from '@/types/nostr';
import { getSettings, setSetting } from './settings';

type RelayStatus = 'connected' | 'eose' | 'disconnected';

class RelayManager {
  pool: SimplePool | null = null;
  private _sub: any = null;
  private _followSub: any = null;
  private _onEvent: ((event: NostrEvent) => void) | null = null;
  private _onStatus: ((status: RelayStatus) => void) | null = null;

  getUrls(): string[] {
    return getSettings().relays;
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
  }

  connect(): void {
    if (!this.pool) return;

    const urls = this.getUrls();
    const settings = getSettings();
    const since = Math.floor(Date.now() / 1000) - settings.timeWindow * 60 * 60;
    const limit = settings.maxNotes;

    this._sub = this.pool.subscribe(
      urls,
      { kinds: [1], since, limit } as any,
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

  reconnect(): void {
    if (this._sub) {
      this._sub.close();
      this._sub = null;
    }
    this.connect();
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
  }
}

export const Relay = new RelayManager();
