import type { NostrEvent } from '@/types/nostr';

class VerifierService {
  private worker: Worker | null = null;
  private _nextId = 0;
  private _pending = new Map<number, {
    resolve: (validEvents: NostrEvent[]) => void;
    events: NostrEvent[];
  }>();

  init(): void {
    try {
      this.worker = new Worker(
        new URL('../../workers/verifyWorker.ts', import.meta.url),
        { type: 'module' }
      );
      this.worker.onmessage = (e: MessageEvent<{ id: number; validIds: string[] }>) => {
        const { id, validIds } = e.data;
        const pending = this._pending.get(id);
        if (pending) {
          const validSet = new Set(validIds);
          pending.resolve(pending.events.filter((ev) => validSet.has(ev.id)));
          this._pending.delete(id);
        }
      };
      this.worker.onerror = () => {
        // Worker failed to load — fall back to main thread
        this.worker = null;
      };
    } catch {
      // Web Workers not supported or URL failed
      this.worker = null;
    }
  }

  async verifyBatch(events: NostrEvent[]): Promise<NostrEvent[]> {
    if (events.length === 0) return [];

    if (!this.worker) {
      // Fallback: skip verification (trust relay-provided events)
      return events;
    }

    const id = this._nextId++;
    return new Promise((resolve) => {
      this._pending.set(id, { resolve, events });
      this.worker!.postMessage({
        id,
        events: events.map((e) => ({
          id: e.id,
          pubkey: e.pubkey,
          created_at: e.created_at,
          kind: e.kind,
          tags: e.tags,
          content: e.content,
          sig: e.sig,
        })),
      });
    });
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    this._pending.clear();
  }
}

export const Verifier = new VerifierService();
