import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import type { DBEvent, DBProfile, DBRelayStats } from '@/types/db';

interface NostrWTFDB extends DBSchema {
  events: {
    key: string;
    value: DBEvent;
    indexes: {
      'by-created_at': number;
      'by-pubkey': string;
      'by-feed-time': [string, number];
    };
  };
  profiles: {
    key: string;
    value: DBProfile;
    indexes: {
      'by-lastFetched': number;
    };
  };
  relay_stats: {
    key: string;
    value: DBRelayStats;
  };
  seen_ids: {
    key: string;
    value: { id: string };
  };
}

const DB_NAME = 'nostr-wtf';
const DB_VERSION = 1;

// Write buffer config
const WRITE_BUFFER_MAX = 50;
const WRITE_BUFFER_DEBOUNCE_MS = 500;

class DatabaseService {
  private db: IDBPDatabase<NostrWTFDB> | null = null;
  private _initPromise: Promise<void> | null = null;

  // Buffered writes for events
  private _eventWriteBuffer: DBEvent[] = [];
  private _eventWriteTimer: ReturnType<typeof setTimeout> | null = null;

  // Buffered writes for seen IDs
  private _seenIdBuffer: string[] = [];
  private _seenIdTimer: ReturnType<typeof setTimeout> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._open();
    await this._initPromise;
  }

  private async _open(): Promise<void> {
    this.db = await openDB<NostrWTFDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Events store
        if (!db.objectStoreNames.contains('events')) {
          const eventStore = db.createObjectStore('events', { keyPath: 'id' });
          eventStore.createIndex('by-created_at', 'created_at');
          eventStore.createIndex('by-pubkey', 'pubkey');
          eventStore.createIndex('by-feed-time', ['feedType', 'created_at']);
        }

        // Profiles store
        if (!db.objectStoreNames.contains('profiles')) {
          const profileStore = db.createObjectStore('profiles', { keyPath: 'pubkey' });
          profileStore.createIndex('by-lastFetched', 'lastFetched');
        }

        // Relay stats store
        if (!db.objectStoreNames.contains('relay_stats')) {
          db.createObjectStore('relay_stats', { keyPath: 'url' });
        }

        // Seen IDs store
        if (!db.objectStoreNames.contains('seen_ids')) {
          db.createObjectStore('seen_ids', { keyPath: 'id' });
        }
      },
    });
  }

  private _ensureDb(): IDBPDatabase<NostrWTFDB> {
    if (!this.db) throw new Error('DB not initialized. Call init() first.');
    return this.db;
  }

  /** Check if DB is ready (initialized) */
  get isReady(): boolean {
    return this.db !== null;
  }

  // ── Events ──

  queueEventWrite(events: DBEvent[]): void {
    if (!this.db) return; // Silently skip if DB not initialized
    this._eventWriteBuffer.push(...events);
    if (this._eventWriteBuffer.length >= WRITE_BUFFER_MAX) {
      this._flushEventWrites();
    } else if (!this._eventWriteTimer) {
      this._eventWriteTimer = setTimeout(() => this._flushEventWrites(), WRITE_BUFFER_DEBOUNCE_MS);
    }
  }

  private async _flushEventWrites(): Promise<void> {
    if (this._eventWriteTimer) {
      clearTimeout(this._eventWriteTimer);
      this._eventWriteTimer = null;
    }
    if (this._eventWriteBuffer.length === 0) return;

    const batch = this._eventWriteBuffer;
    this._eventWriteBuffer = [];

    try {
      const db = this._ensureDb();
      const tx = db.transaction('events', 'readwrite');
      for (const ev of batch) {
        tx.store.put(ev);
      }
      await tx.done;
    } catch {
      // IndexedDB write failed — events are still in memory
    }
  }

  async putEvents(events: DBEvent[]): Promise<void> {
    const db = this._ensureDb();
    const tx = db.transaction('events', 'readwrite');
    for (const ev of events) {
      tx.store.put(ev);
    }
    await tx.done;
  }

  async getEventById(id: string): Promise<DBEvent | undefined> {
    const db = this._ensureDb();
    return db.get('events', id);
  }

  async getEventsByFeed(
    feedType: 'global' | 'following',
    limit: number,
    before?: number
  ): Promise<DBEvent[]> {
    const db = this._ensureDb();
    const tx = db.transaction('events', 'readonly');
    const index = tx.store.index('by-feed-time');

    const upper = before ?? Math.floor(Date.now() / 1000) + 1;
    const range = IDBKeyRange.bound([feedType, 0], [feedType, upper], false, true);

    const results: DBEvent[] = [];
    let cursor = await index.openCursor(range, 'prev');

    while (cursor && results.length < limit) {
      results.push(cursor.value);
      cursor = await cursor.continue();
    }

    return results;
  }

  async getLatestEventTimestamp(): Promise<number | null> {
    if (!this.db) return null;
    const tx = this.db.transaction('events', 'readonly');
    const index = tx.store.index('by-created_at');
    const cursor = await index.openCursor(null, 'prev');
    return cursor ? cursor.value.created_at : null;
  }

  async getEventCount(): Promise<number> {
    const db = this._ensureDb();
    return db.count('events');
  }

  async pruneOldEvents(maxAgeDays: number = 7): Promise<void> {
    const db = this._ensureDb();
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeDays * 86400;
    const tx = db.transaction('events', 'readwrite');
    const index = tx.store.index('by-created_at');
    let cursor = await index.openCursor(IDBKeyRange.upperBound(cutoff));

    while (cursor) {
      cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  // ── Seen IDs ──

  async loadSeenIds(): Promise<Set<string>> {
    const db = this._ensureDb();
    const all = await db.getAll('seen_ids');
    return new Set(all.map((r) => r.id));
  }

  addSeenIds(ids: string[]): void {
    if (!this.db) return; // Silently skip if DB not initialized
    this._seenIdBuffer.push(...ids);
    if (this._seenIdBuffer.length >= WRITE_BUFFER_MAX) {
      this._flushSeenIdWrites();
    } else if (!this._seenIdTimer) {
      this._seenIdTimer = setTimeout(() => this._flushSeenIdWrites(), WRITE_BUFFER_DEBOUNCE_MS);
    }
  }

  private async _flushSeenIdWrites(): Promise<void> {
    if (this._seenIdTimer) {
      clearTimeout(this._seenIdTimer);
      this._seenIdTimer = null;
    }
    if (this._seenIdBuffer.length === 0) return;

    const batch = this._seenIdBuffer;
    this._seenIdBuffer = [];

    try {
      const db = this._ensureDb();
      const tx = db.transaction('seen_ids', 'readwrite');
      for (const id of batch) {
        tx.store.put({ id });
      }
      await tx.done;
    } catch {
      // Write failed
    }
  }

  async clearSeenIds(): Promise<void> {
    const db = this._ensureDb();
    await db.clear('seen_ids');
  }

  // ── Profiles ──

  async putProfiles(profiles: DBProfile[]): Promise<void> {
    const db = this._ensureDb();
    const tx = db.transaction('profiles', 'readwrite');
    for (const p of profiles) {
      tx.store.put(p);
    }
    await tx.done;
  }

  async getProfile(pubkey: string): Promise<DBProfile | undefined> {
    const db = this._ensureDb();
    return db.get('profiles', pubkey);
  }

  async getAllProfiles(): Promise<DBProfile[]> {
    const db = this._ensureDb();
    return db.getAll('profiles');
  }

  async getStaleProfiles(maxAgeMs: number): Promise<string[]> {
    const db = this._ensureDb();
    const cutoff = Date.now() - maxAgeMs;
    const tx = db.transaction('profiles', 'readonly');
    const index = tx.store.index('by-lastFetched');
    const stale: string[] = [];

    let cursor = await index.openCursor(IDBKeyRange.upperBound(cutoff));
    while (cursor) {
      stale.push(cursor.value.pubkey);
      cursor = await cursor.continue();
    }
    return stale;
  }

  // ── Relay Stats ──

  async putRelayStats(stats: DBRelayStats[]): Promise<void> {
    const db = this._ensureDb();
    const tx = db.transaction('relay_stats', 'readwrite');
    for (const s of stats) {
      tx.store.put(s);
    }
    await tx.done;
  }

  async getRelayStats(): Promise<DBRelayStats[]> {
    const db = this._ensureDb();
    return db.getAll('relay_stats');
  }

  // ── Maintenance ──

  async clear(): Promise<void> {
    const db = this._ensureDb();
    await Promise.all([
      db.clear('events'),
      db.clear('profiles'),
      db.clear('relay_stats'),
      db.clear('seen_ids'),
    ]);
  }

  /** Flush any pending buffered writes immediately */
  async flush(): Promise<void> {
    if (!this.db) return;
    await Promise.all([
      this._flushEventWrites(),
      this._flushSeenIdWrites(),
    ]);
  }
}

export const DB = new DatabaseService();
