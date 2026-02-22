import { DB } from './db';
import type { DBRelayStats } from '@/types/db';

interface RelayMetrics {
  url: string;
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  lastConnected: number;
  consecutiveFailures: number;
  backoffUntil: number;
}

const MAX_BACKOFF_MS = 30_000;
const PERSIST_INTERVAL_MS = 30_000;

class RelayStatsService {
  private metrics = new Map<string, RelayMetrics>();
  private _persistTimer: ReturnType<typeof setInterval> | null = null;

  async init(): Promise<void> {
    const stats = await DB.getRelayStats();
    for (const s of stats) {
      this.metrics.set(s.url, {
        url: s.url,
        successCount: s.successCount,
        failureCount: s.failureCount,
        totalLatencyMs: s.avgLatencyMs * s.successCount,
        avgLatencyMs: s.avgLatencyMs,
        lastConnected: s.lastConnected,
        consecutiveFailures: s.consecutiveFailures,
        backoffUntil: 0,
      });
    }

    // Persist periodically
    this._persistTimer = setInterval(() => this.persist(), PERSIST_INTERVAL_MS);
  }

  private _ensure(url: string): RelayMetrics {
    let m = this.metrics.get(url);
    if (!m) {
      m = {
        url,
        successCount: 0,
        failureCount: 0,
        totalLatencyMs: 0,
        avgLatencyMs: 0,
        lastConnected: 0,
        consecutiveFailures: 0,
        backoffUntil: 0,
      };
      this.metrics.set(url, m);
    }
    return m;
  }

  recordSuccess(url: string, latencyMs: number): void {
    const m = this._ensure(url);
    m.successCount++;
    m.totalLatencyMs += latencyMs;
    m.avgLatencyMs = m.totalLatencyMs / m.successCount;
    m.lastConnected = Date.now();
    m.consecutiveFailures = 0;
    m.backoffUntil = 0;
  }

  recordFailure(url: string, error?: string): void {
    const m = this._ensure(url);
    m.failureCount++;
    m.consecutiveFailures++;
    m.backoffUntil = Date.now() + this.getBackoffMs(url);
  }

  /** Returns relay URLs sorted by priority (lowest latency + highest success rate) */
  getPrioritizedUrls(urls: string[]): string[] {
    return [...urls].sort((a, b) => {
      const ma = this.metrics.get(a);
      const mb = this.metrics.get(b);

      // Unknown relays go to the end
      if (!ma && !mb) return 0;
      if (!ma) return 1;
      if (!mb) return -1;

      // Backed-off relays go last
      const now = Date.now();
      const aBackedOff = ma.backoffUntil > now;
      const bBackedOff = mb.backoffUntil > now;
      if (aBackedOff && !bBackedOff) return 1;
      if (!aBackedOff && bBackedOff) return -1;

      // Score: lower is better. Weighted combo of avg latency and failure rate
      const aTotal = ma.successCount + ma.failureCount;
      const bTotal = mb.successCount + mb.failureCount;
      const aSuccessRate = aTotal > 0 ? ma.successCount / aTotal : 0.5;
      const bSuccessRate = bTotal > 0 ? mb.successCount / bTotal : 0.5;

      // Normalize latency to 0-1 (cap at 5000ms)
      const aLatencyScore = Math.min(ma.avgLatencyMs, 5000) / 5000;
      const bLatencyScore = Math.min(mb.avgLatencyMs, 5000) / 5000;

      // Combined: 60% success rate, 40% latency (lower score = better)
      const aScore = (1 - aSuccessRate) * 0.6 + aLatencyScore * 0.4;
      const bScore = (1 - bSuccessRate) * 0.6 + bLatencyScore * 0.4;

      return aScore - bScore;
    });
  }

  /** Returns backoff delay in ms based on consecutive failures (exponential) */
  getBackoffMs(url: string): number {
    const m = this.metrics.get(url);
    if (!m) return 1000;
    const delay = Math.min(1000 * Math.pow(2, m.consecutiveFailures - 1), MAX_BACKOFF_MS);
    return delay;
  }

  isBackedOff(url: string): boolean {
    const m = this.metrics.get(url);
    if (!m) return false;
    return m.backoffUntil > Date.now();
  }

  getMetrics(url: string): RelayMetrics | undefined {
    return this.metrics.get(url);
  }

  async persist(): Promise<void> {
    const stats: DBRelayStats[] = [];
    for (const m of this.metrics.values()) {
      stats.push({
        url: m.url,
        successCount: m.successCount,
        failureCount: m.failureCount,
        avgLatencyMs: m.avgLatencyMs,
        lastConnected: m.lastConnected,
        consecutiveFailures: m.consecutiveFailures,
      });
    }
    if (stats.length > 0) {
      await DB.putRelayStats(stats);
    }
  }

  destroy(): void {
    if (this._persistTimer) {
      clearInterval(this._persistTimer);
      this._persistTimer = null;
    }
  }
}

export const RelayStats = new RelayStatsService();
