import type { SimplePool } from 'nostr-tools';
import type { NostrEvent } from '@/types/nostr';

interface PendingQuery {
  urls: string[];
  filter: Record<string, any>;
  dedupKey: string;
  callbacks: Array<{
    resolve: (events: NostrEvent[]) => void;
    reject: (err: Error) => void;
  }>;
  onUpdate?: (events: NostrEvent[]) => void;
}

const DEBOUNCE_MS = 100;
const POOL_WAIT_MS = 200;
const POOL_WAIT_MAX_RETRIES = 10;

// Progressive query timing
const COLLECTION_WINDOW = 200;    // ms after first event before resolving
const FIRST_EVENT_TIMEOUT = 3000; // ms to wait if NO events arrive at all
const MAX_WAIT = 5000;            // hard timeout for subscribeManyEose

class QueryBatcherService {
  private _pool: SimplePool | null = null;
  private _pending: PendingQuery[] = [];
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _poolWaitRetries = 0;

  setPool(pool: SimplePool | null): void {
    this._pool = pool;
    // Flush any queries that were waiting for the pool
    if (pool && this._pending.length > 0) {
      this._poolWaitRetries = 0;
      this._flush();
    }
  }

  /** Drop-in replacement for pool.querySync — debounced 100ms */
  query(urls: string[], filter: Record<string, any>, opts?: { onUpdate?: (events: NostrEvent[]) => void }): Promise<NostrEvent[]> {
    return new Promise((resolve, reject) => {
      const key = this._dedupKey(urls, filter);
      const existing = this._pending.find((q) => q.dedupKey === key);
      if (existing) {
        existing.callbacks.push({ resolve, reject });
        if (opts?.onUpdate) {
          const prev = existing.onUpdate;
          existing.onUpdate = prev
            ? (events) => { prev(events); opts.onUpdate!(events); }
            : opts.onUpdate;
        }
      } else {
        this._pending.push({ urls, filter, dedupKey: key, callbacks: [{ resolve, reject }], onUpdate: opts?.onUpdate });
      }
      if (!this._timer) {
        this._timer = setTimeout(() => this._flush(), DEBOUNCE_MS);
      }
    });
  }

  /** Immediate variant — flushes the queue right away (for user-initiated actions) */
  queryImmediate(urls: string[], filter: Record<string, any>, opts?: { onUpdate?: (events: NostrEvent[]) => void }): Promise<NostrEvent[]> {
    return new Promise((resolve, reject) => {
      const key = this._dedupKey(urls, filter);
      const existing = this._pending.find((q) => q.dedupKey === key);
      if (existing) {
        existing.callbacks.push({ resolve, reject });
        if (opts?.onUpdate) {
          const prev = existing.onUpdate;
          existing.onUpdate = prev
            ? (events) => { prev(events); opts.onUpdate!(events); }
            : opts.onUpdate;
        }
      } else {
        this._pending.push({ urls, filter, dedupKey: key, callbacks: [{ resolve, reject }], onUpdate: opts?.onUpdate });
      }
      this._flush();
    });
  }

  private _flush(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }

    const batch = this._pending.splice(0);
    if (batch.length === 0) return;

    const pool = this._pool;
    if (!pool) {
      // Pool not ready yet — re-queue and retry
      this._pending.unshift(...batch);
      this._poolWaitRetries++;
      if (this._poolWaitRetries > POOL_WAIT_MAX_RETRIES) {
        // Give up after max retries
        const failed = this._pending.splice(0);
        for (const q of failed) {
          for (const cb of q.callbacks) cb.reject(new Error('Pool not initialized'));
        }
        this._poolWaitRetries = 0;
        return;
      }
      this._timer = setTimeout(() => this._flush(), POOL_WAIT_MS);
      return;
    }
    this._poolWaitRetries = 0;

    // Group by relay URL set (sorted+joined as key)
    const groups = new Map<string, PendingQuery[]>();
    for (const q of batch) {
      const key = [...q.urls].sort().join(',');
      const arr = groups.get(key);
      if (arr) {
        arr.push(q);
      } else {
        groups.set(key, [q]);
      }
    }

    for (const [, queries] of groups) {
      this._executeGroup(pool, queries);
    }
  }

  private async _executeGroup(pool: SimplePool, queries: PendingQuery[]): Promise<void> {
    const urls = queries[0].urls;

    // If only one query in the group, just execute directly with progressive query
    if (queries.length === 1) {
      const q = queries[0];
      try {
        const events = await this._progressiveQuery(pool, urls, q.filter, q.onUpdate ? (allEvents) => {
          const deduped = this._dedup(allEvents);
          q.onUpdate!(deduped);
        } : undefined);
        for (const cb of q.callbacks) cb.resolve(events as NostrEvent[]);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        for (const cb of q.callbacks) cb.reject(err);
      }
      return;
    }

    // Try to merge compatible filters
    const { merged, queryMap } = this._mergeFilters(queries);

    // Track whether any query has onUpdate callbacks
    const hasAnyOnUpdate = queries.some((q) => q.onUpdate);

    // Execute each merged filter in parallel with progressive queries
    const allEvents: NostrEvent[] = [];
    try {
      const results = await Promise.all(
        merged.map((filter, mergedIdx) => {
          // Only set up onAllComplete if any original query in this group has onUpdate
          const originalIndices = queryMap.get(mergedIdx) || [];
          const needsUpdate = hasAnyOnUpdate && originalIndices.some((qi) => queries[qi].onUpdate);

          return this._progressiveQuery(pool, urls, filter, needsUpdate ? (completedEvents) => {
            // Route completed events back to original callers that have onUpdate
            for (const qi of originalIndices) {
              const q = queries[qi];
              if (!q.onUpdate) continue;
              const matching = completedEvents.filter((ev) => this._eventMatchesFilter(ev, q.filter));
              const deduped = this._dedup(matching);
              q.onUpdate(deduped);
            }
          } : undefined);
        })
      );
      for (const events of results) {
        allEvents.push(...events);
      }
    } catch (e) {
      console.error(`[QueryBatcher]   execution error:`, e);
      const err = e instanceof Error ? e : new Error(String(e));
      for (const q of queries) {
        for (const cb of q.callbacks) cb.reject(err);
      }
      return;
    }

    // Route events back to callers
    // Each caller gets events that match their original filter
    for (let qi = 0; qi < queries.length; qi++) {
      const matchingEvents = allEvents.filter((ev) =>
        this._eventMatchesFilter(ev, queries[qi].filter)
      );
      const deduped = this._dedup(matchingEvents);
      for (const cb of queries[qi].callbacks) cb.resolve(deduped);
    }
  }

  /**
   * Progressive relay query — resolves fast with first batch, then calls onAllComplete with full results.
   * Phase 1: After first event arrives, wait COLLECTION_WINDOW ms then resolve with collected events.
   * Phase 2: Keep listening. When onclose fires (all relays done), call onAllComplete with all events.
   */
  private _progressiveQuery(
    pool: SimplePool,
    urls: string[],
    filter: Record<string, any>,
    onAllComplete?: (events: NostrEvent[]) => void
  ): Promise<NostrEvent[]> {
    return new Promise<NostrEvent[]>((resolve) => {
      const events: NostrEvent[] = [];
      let resolved = false;
      let collectionTimer: ReturnType<typeof setTimeout> | null = null;
      let firstEventTimer: ReturnType<typeof setTimeout> | null = null;

      const doResolve = () => {
        if (resolved) return;
        resolved = true;
        if (collectionTimer) clearTimeout(collectionTimer);
        if (firstEventTimer) clearTimeout(firstEventTimer);
        resolve([...events]);
      };

      // Safety: if no events arrive within FIRST_EVENT_TIMEOUT, resolve with []
      firstEventTimer = setTimeout(() => {
        firstEventTimer = null;
        if (!resolved) doResolve();
      }, FIRST_EVENT_TIMEOUT);

      pool.subscribeManyEose(urls, filter as any, {
        onevent(event) {
          events.push(event as NostrEvent);

          // On first event, start the collection window
          if (events.length === 1 && !resolved) {
            if (firstEventTimer) {
              clearTimeout(firstEventTimer);
              firstEventTimer = null;
            }
            collectionTimer = setTimeout(() => {
              collectionTimer = null;
              doResolve();
            }, COLLECTION_WINDOW);
          }
        },
        onclose() {
          // All relays done — resolve if not already
          if (collectionTimer) clearTimeout(collectionTimer);
          if (firstEventTimer) clearTimeout(firstEventTimer);
          doResolve();

          // Fire onAllComplete with the full deduped set if we have events
          if (events.length > 0 && onAllComplete) {
            onAllComplete([...events]);
          }
        },
        maxWait: MAX_WAIT,
      });
    });
  }

  /** Deduplicate events by id */
  private _dedup(events: NostrEvent[]): NostrEvent[] {
    const seen = new Set<string>();
    const result: NostrEvent[] = [];
    for (const ev of events) {
      if (!seen.has(ev.id)) {
        seen.add(ev.id);
        result.push(ev);
      }
    }
    return result;
  }

  /**
   * Merge compatible filters:
   * 1. Multi-kind author merge: {kinds, authors} (no limit/since/until/tags) → combine kinds+authors
   * 2. Same-kind author merge: {kinds:[K], authors, limit?} → merge authors per kind
   * 3. IDs merge: {ids} → merge ids
   * 4. Everything else stays separate
   */
  private _mergeFilters(queries: PendingQuery[]): {
    merged: Record<string, any>[];
    queryMap: Map<number, number[]>; // merged index → original query indices
  } {
    const merged: Record<string, any>[] = [];
    const queryMap = new Map<number, number[]>();

    // Buckets
    const multiKindGroups = new Map<string, { kinds: Set<number>; authors: Set<string>; queryIndices: number[] }>();
    const kindAuthorGroups = new Map<number, { authors: string[]; queryIndices: number[] }>();
    const idGroup: { ids: string[]; queryIndices: number[] } = { ids: [], queryIndices: [] };
    const unmergeable: { filter: Record<string, any>; queryIndex: number }[] = [];

    for (let i = 0; i < queries.length; i++) {
      const f = queries[i].filter;

      // 1. Multi-kind mergeable: {kinds, authors} with NO limit/since/until/tags
      if (this._isMultiKindMergeable(f)) {
        const authorKey = [...f.authors].sort().join(',');
        const existing = multiKindGroups.get(authorKey);
        if (existing) {
          for (const k of f.kinds) existing.kinds.add(k);
          for (const a of f.authors) existing.authors.add(a);
          existing.queryIndices.push(i);
        } else {
          multiKindGroups.set(authorKey, {
            kinds: new Set(f.kinds),
            authors: new Set(f.authors),
            queryIndices: [i],
          });
        }
      }
      // 2. Same-kind author merge: {kinds:[K], authors, limit?}
      else if (this._isKindAuthorWithLimit(f)) {
        const kind = f.kinds[0];
        const existing = kindAuthorGroups.get(kind);
        if (existing) {
          existing.authors.push(...f.authors);
          existing.queryIndices.push(i);
        } else {
          kindAuthorGroups.set(kind, {
            authors: [...f.authors],
            queryIndices: [i],
          });
        }
      }
      // 3. IDs merge: {ids:[...]}
      else if (this._isIdsOnlyFilter(f)) {
        idGroup.ids.push(...f.ids);
        idGroup.queryIndices.push(i);
      }
      // 4. Not mergeable
      else {
        unmergeable.push({ filter: f, queryIndex: i });
      }
    }

    // Emit multi-kind merged filters
    // Second pass: merge groups that share overlapping authors
    const mkGroups = [...multiKindGroups.values()];
    let merged_mk = true;
    while (merged_mk) {
      merged_mk = false;
      for (let i = 0; i < mkGroups.length; i++) {
        for (let j = i + 1; j < mkGroups.length; j++) {
          // Check if any author overlaps
          let overlaps = false;
          for (const a of mkGroups[j].authors) {
            if (mkGroups[i].authors.has(a)) { overlaps = true; break; }
          }
          if (overlaps) {
            for (const k of mkGroups[j].kinds) mkGroups[i].kinds.add(k);
            for (const a of mkGroups[j].authors) mkGroups[i].authors.add(a);
            mkGroups[i].queryIndices.push(...mkGroups[j].queryIndices);
            mkGroups.splice(j, 1);
            merged_mk = true;
            break;
          }
        }
        if (merged_mk) break;
      }
    }

    for (const group of mkGroups) {
      const idx = merged.length;
      merged.push({ kinds: [...group.kinds], authors: [...group.authors] });
      queryMap.set(idx, group.queryIndices);
    }

    // Emit same-kind+author merged filters
    for (const [kind, group] of kindAuthorGroups) {
      const uniqueAuthors = [...new Set(group.authors)];
      const idx = merged.length;
      merged.push({ kinds: [kind], authors: uniqueAuthors });
      queryMap.set(idx, group.queryIndices);
    }

    // Emit merged ids filter
    if (idGroup.ids.length > 0) {
      const uniqueIds = [...new Set(idGroup.ids)];
      const idx = merged.length;
      merged.push({ ids: uniqueIds });
      queryMap.set(idx, idGroup.queryIndices);
    }

    // Emit unmergeable filters as-is
    for (const item of unmergeable) {
      const idx = merged.length;
      merged.push(item.filter);
      queryMap.set(idx, [item.queryIndex]);
    }

    return { merged, queryMap };
  }

  /** Check if filter can be multi-kind merged: has kinds + authors, NO limit/since/until/tag filters */
  private _isMultiKindMergeable(f: Record<string, any>): boolean {
    if (!Array.isArray(f.kinds) || f.kinds.length === 0) return false;
    if (!Array.isArray(f.authors) || f.authors.length === 0) return false;
    if (f.limit || f.since || f.until) return false;
    // Check for tag filters (#e, #p, #t, etc.)
    for (const key of Object.keys(f)) {
      if (key !== 'kinds' && key !== 'authors') return false;
    }
    return true;
  }

  /** Check if filter is {kinds:[K], authors:[...]} with optional limit (has limit or other constraints preventing multi-kind merge) */
  private _isKindAuthorWithLimit(f: Record<string, any>): boolean {
    const keys = Object.keys(f).filter((k) => k !== 'limit');
    if (keys.length !== 2) return false;
    return (
      Array.isArray(f.kinds) &&
      f.kinds.length === 1 &&
      Array.isArray(f.authors) &&
      f.authors.length > 0 &&
      !f.since &&
      !f.until
    );
  }

  /** Canonical dedup key: sorted URLs + sorted canonical filter JSON */
  private _dedupKey(urls: string[], filter: Record<string, any>): string {
    const urlPart = [...urls].sort().join(',');
    const sortedKeys = Object.keys(filter).sort();
    const canonical: Record<string, any> = {};
    for (const k of sortedKeys) {
      const v = filter[k];
      canonical[k] = Array.isArray(v) ? [...v].sort() : v;
    }
    return urlPart + '|' + JSON.stringify(canonical);
  }

  /** Check if filter is {ids:[...]} only */
  private _isIdsOnlyFilter(f: Record<string, any>): boolean {
    const keys = Object.keys(f);
    return keys.length === 1 && keys[0] === 'ids' && Array.isArray(f.ids);
  }

  /** Check if an event matches a given filter */
  private _eventMatchesFilter(ev: NostrEvent, filter: Record<string, any>): boolean {
    // ids
    if (filter.ids && !filter.ids.includes(ev.id)) return false;

    // kinds
    if (filter.kinds && !filter.kinds.includes(ev.kind)) return false;

    // authors
    if (filter.authors && !filter.authors.includes(ev.pubkey)) return false;

    // since
    if (filter.since && ev.created_at < filter.since) return false;

    // until
    if (filter.until && ev.created_at > filter.until) return false;

    // Tag filters (#e, #p, #t, etc.)
    for (const key of Object.keys(filter)) {
      if (key.startsWith('#') && key.length === 2) {
        const tagName = key[1];
        const values: string[] = filter[key];
        const hasMatch = ev.tags.some(
          (t) => t[0] === tagName && values.includes(t[1])
        );
        if (!hasMatch) return false;
      }
    }

    return true;
  }
}

export const QueryBatcher = new QueryBatcherService();
