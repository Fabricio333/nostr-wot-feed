import type { NostrEvent } from '@/types/nostr';

export type FlushReason = 'eose' | 'timeout' | 'buffer_full' | 'user_action';

const TIMEOUT_MS = 4000;
const MAX_BUFFER_SIZE = 500;

class EventBufferService {
  private buffer: NostrEvent[] = [];
  private seenInBuffer = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private _onFlush: ((events: NostrEvent[], reason: FlushReason) => void) | null = null;
  private _stopped = false;

  init(
    onFlush: (events: NostrEvent[], reason: FlushReason) => void
  ): void {
    this._onFlush = onFlush;
    this._stopped = false;
    this._startTimeout();
  }

  /** Add an event to the buffer. Returns false if duplicate. */
  add(event: NostrEvent): boolean {
    if (this._stopped) return false;
    if (this.seenInBuffer.has(event.id)) return false;
    this.seenInBuffer.add(event.id);
    this.buffer.push(event);

    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this._flush('buffer_full');
    }

    return true;
  }

  /** Flush remaining buffer and stop accepting new events */
  flushAndStop(): void {
    this._flush('eose');
    this._stopped = true;
    this._clearTimeout();
  }

  /** Manually flush (e.g., pull-to-refresh, scroll to top) */
  flushOnUserAction(): void {
    if (this.buffer.length > 0) {
      this._flush('user_action');
    }
  }

  private _startTimeout(): void {
    if (this.flushTimer || this._stopped) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.buffer.length > 0) {
        this._flush('timeout');
      }
      if (!this._stopped) {
        this._startTimeout();
      }
    }, TIMEOUT_MS);
  }

  private _clearTimeout(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private _flush(reason: FlushReason): void {
    this._clearTimeout();

    const events = this.buffer;
    this.buffer = [];

    if (events.length > 0) {
      this._onFlush?.(events, reason);
    }

    if (!this._stopped) {
      this._startTimeout();
    }
  }

  reset(): void {
    this.buffer = [];
    this.seenInBuffer.clear();
    this._stopped = false;
    this._clearTimeout();
  }

  get size(): number {
    return this.buffer.length;
  }

  hasSeen(id: string): boolean {
    return this.seenInBuffer.has(id);
  }

  destroy(): void {
    this.reset();
    this._onFlush = null;
  }
}

export const EventBuffer = new EventBufferService();
