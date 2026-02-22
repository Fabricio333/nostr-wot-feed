import { Relay } from './relay';
import { Profiles } from './profiles';

interface ParentNote {
  pubkey: string;
  content: string;
}

class ParentNotesService {
  cache = new Map<string, ParentNote>();
  private _pendingIds = new Set<string>();
  private _fetchTimer: ReturnType<typeof setTimeout> | null = null;
  private _listeners = new Set<(eventIds: string[]) => void>();
  onUpdate: ((eventIds: string[]) => void) | null = null;

  addListener(fn: (eventIds: string[]) => void): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  localNotesById: Map<string, { pubkey: string; content: string }> | null = null;

  get(eventId: string): ParentNote | null {
    const local = this.localNotesById?.get(eventId);
    if (local) return { pubkey: local.pubkey, content: local.content };
    return this.cache.get(eventId) || null;
  }

  request(eventId: string): void {
    if (!eventId) return;
    if (this.cache.has(eventId) || this._pendingIds.has(eventId)) return;
    if (this.localNotesById?.has(eventId)) return;
    this._pendingIds.add(eventId);
    if (!this._fetchTimer) {
      this._fetchTimer = setTimeout(() => this._fetchBatch(), 400);
    }
  }

  private async _fetchBatch(): Promise<void> {
    this._fetchTimer = null;
    if (this._pendingIds.size === 0) return;

    const ids = [...this._pendingIds];
    this._pendingIds.clear();

    const pool = Relay.pool;
    if (!pool) return;

    const events = await pool.querySync(Relay.getUrls(), { ids });

    const fetched: string[] = [];
    for (const ev of events) {
      if (!this.cache.has(ev.id)) {
        this.cache.set(ev.id, { pubkey: ev.pubkey, content: ev.content });
        Profiles.request(ev.pubkey);
        fetched.push(ev.id);
      }
    }

    if (fetched.length > 0) {
      this.onUpdate?.(fetched);
      for (const fn of this._listeners) fn(fetched);
    }
  }
}

export const ParentNotes = new ParentNotesService();
