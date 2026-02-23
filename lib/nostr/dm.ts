import type { NostrEvent, Conversation, DMMessage } from '@/types/nostr';
import { Relay } from './relay';
import { Signer } from './signer';
import { QueryBatcher } from './queryBatcher';
import { Profiles } from '@/lib/content/profiles';
import { Mute } from '@/lib/wot/mute';
import { WoT } from '@/lib/wot/wot';

const STORAGE_KEY = 'wot-feed-dm-events';
const READ_KEY = 'wot-feed-dm-read';
const MAX_CACHED_EVENTS = 500;

class DMService {
  private _events: NostrEvent[] = [];
  private _seenIds = new Set<string>();
  private _decrypted = new Map<string, string>();
  private _sub: any = null;
  private _myPubkey: string | null = null;
  private _lastRead = new Map<string, number>();

  onEvent: (() => void) | null = null;

  get initialized(): boolean {
    return this._myPubkey !== null;
  }

  /**
   * Initialize DM service: loads cached events synchronously, then
   * fetches from relays in the background. Callers can use conversations
   * immediately from cache.
   */
  async subscribe(myPubkey: string): Promise<void> {
    this._myPubkey = myPubkey;
    this._loadLastRead();
    this._loadEvents();

    // Request profiles for cached conversation partners
    const partners = new Set<string>();
    for (const ev of this._events) {
      const partner = this._getPartner(ev);
      if (partner) partners.add(partner);
    }
    for (const pk of partners) {
      Profiles.request(pk);
    }

    // Fetch from relays in background — don't block on it
    this._fetchFromRelays(myPubkey);
  }

  /**
   * Background relay fetch — merges new events and notifies listeners.
   */
  private async _fetchFromRelays(myPubkey: string): Promise<void> {
    const pool = Relay.pool;
    if (!pool) return;

    const urls = Relay.getUrls();
    const latestCached = this._events.length > 0
      ? Math.max(...this._events.map(e => e.created_at))
      : 0;
    const fallbackSince = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
    const since = latestCached > 0 ? latestCached - 60 : fallbackSince;

    try {
      const [received, sent] = await Promise.all([
        QueryBatcher.query(urls, { kinds: [4], '#p': [myPubkey], since, limit: 200 }),
        QueryBatcher.query(urls, { kinds: [4], authors: [myPubkey], since, limit: 200 }),
      ]);

      let added = false;
      for (const ev of [...received, ...sent]) {
        if (this._addEvent(ev)) added = true;
      }

      if (added) {
        this._events.sort((a, b) => a.created_at - b.created_at);
        this._saveEvents();

        // Request profiles for new partners
        for (const ev of [...received, ...sent]) {
          const partner = this._getPartner(ev);
          if (partner) Profiles.request(partner);
        }

        this.onEvent?.();
      }
    } catch {
      // Relay fetch failed — cached data still available
    }

    // Subscribe to live DMs
    const dmFilters = [
      { kinds: [4], '#p': [myPubkey] },
      { kinds: [4], authors: [myPubkey] },
    ];
    const dmRequests = urls.flatMap((url) =>
      dmFilters.map((filter) => ({ url, filter }))
    );
    this._sub = pool.subscribeMap(dmRequests, {
      onevent: (event: NostrEvent) => {
        if (!this._addEvent(event)) return;
        this._saveEvents();
        const partner = this._getPartner(event);
        if (partner) Profiles.request(partner);
        this.onEvent?.();
      },
    });
  }

  private _addEvent(ev: NostrEvent): boolean {
    if (this._seenIds.has(ev.id)) return false;
    this._seenIds.add(ev.id);
    this._events.push(ev);
    return true;
  }

  private _getPartner(event: NostrEvent): string | null {
    if (!this._myPubkey) return null;
    if (event.pubkey === this._myPubkey) {
      const pTag = event.tags.find((t) => t[0] === 'p');
      return pTag?.[1] || null;
    }
    return event.pubkey;
  }

  async decrypt(event: NostrEvent): Promise<string> {
    if (this._decrypted.has(event.id)) return this._decrypted.get(event.id)!;

    const w = window as any;
    if (!w.nostr?.nip04) {
      return '[encrypted — no NIP-04 support]';
    }

    try {
      const partner = this._getPartner(event);
      if (!partner) return '[unknown partner]';
      const plaintext = await w.nostr.nip04.decrypt(partner, event.content);
      this._decrypted.set(event.id, plaintext);
      return plaintext;
    } catch {
      return '[decryption failed]';
    }
  }

  async getConversations(): Promise<Conversation[]> {
    if (!this._myPubkey) return [];

    const convMap = new Map<string, { events: NostrEvent[]; lastTimestamp: number }>();

    for (const ev of this._events) {
      const partner = this._getPartner(ev);
      if (!partner) continue;

      const existing = convMap.get(partner);
      if (existing) {
        existing.events.push(ev);
        if (ev.created_at > existing.lastTimestamp) {
          existing.lastTimestamp = ev.created_at;
        }
      } else {
        convMap.set(partner, { events: [ev], lastTimestamp: ev.created_at });
      }
    }

    // Score all conversation partners for WoT trust data
    const unscoredPartners = [...convMap.keys()].filter(pk => !WoT.cache.has(pk));
    if (unscoredPartners.length > 0) {
      await WoT.scoreBatch(unscoredPartners);
    }

    const conversations: Conversation[] = [];

    for (const [partnerPubkey, data] of convMap) {
      if (Mute.isMuted(partnerPubkey)) continue;

      const latest = data.events.reduce((a, b) =>
        a.created_at > b.created_at ? a : b
      );
      const lastMessage = await this.decrypt(latest);

      const lastReadTime = this._lastRead.get(partnerPubkey) || 0;
      const unread = data.events.filter(
        (ev) => ev.pubkey !== this._myPubkey && ev.created_at > lastReadTime
      ).length;

      const trust = WoT.cache.get(partnerPubkey);
      conversations.push({
        partnerPubkey,
        lastMessage,
        lastTimestamp: data.lastTimestamp,
        unread,
        isTrusted: trust?.trusted ?? false,
        trustScore: trust?.score ?? 0,
      });
    }

    conversations.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
    return conversations;
  }

  async getMessages(partnerPubkey: string): Promise<DMMessage[]> {
    if (!this._myPubkey) return [];
    if (Mute.isMuted(partnerPubkey)) return [];

    const partnerEvents = this._events.filter((ev) => {
      const partner = this._getPartner(ev);
      return partner === partnerPubkey;
    });

    partnerEvents.sort((a, b) => a.created_at - b.created_at);

    const messages: DMMessage[] = [];
    const seen = new Set<string>();
    for (const ev of partnerEvents) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      const content = await this.decrypt(ev);
      messages.push({
        id: ev.id,
        fromMe: ev.pubkey === this._myPubkey,
        content,
        timestamp: ev.created_at,
      });
    }

    this._markRead(partnerPubkey);
    return messages;
  }

  async sendDM(
    recipientPubkey: string,
    plaintext: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!Signer.isLoggedIn() || Signer.isReadOnly()) {
      return { success: false, error: 'Login required to send DMs' };
    }

    const w = window as any;
    if (!w.nostr?.nip04) {
      return { success: false, error: 'NIP-04 encryption not available' };
    }

    try {
      const ciphertext = await w.nostr.nip04.encrypt(recipientPubkey, plaintext);
      const event = {
        kind: 4,
        content: ciphertext,
        tags: [['p', recipientPubkey]],
        created_at: Math.floor(Date.now() / 1000),
      };
      const signed = await Signer.signEvent(event);
      await Relay.publishEvent(signed);

      this._addEvent(signed);
      this._decrypted.set(signed.id, plaintext);
      this._saveEvents();

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // --- localStorage: encrypted events ---

  private _loadEvents(): void {
    if (!this._myPubkey) return;
    try {
      const raw = localStorage.getItem(`${STORAGE_KEY}:${this._myPubkey}`);
      if (!raw) return;
      const events: NostrEvent[] = JSON.parse(raw);
      for (const ev of events) {
        this._addEvent(ev);
      }
      this._events.sort((a, b) => a.created_at - b.created_at);
    } catch {
      // corrupted cache — ignore
    }
  }

  private _saveEvents(): void {
    if (!this._myPubkey) return;
    try {
      const toCache = this._events.slice(-MAX_CACHED_EVENTS);
      localStorage.setItem(
        `${STORAGE_KEY}:${this._myPubkey}`,
        JSON.stringify(toCache.map(e => ({
          id: e.id,
          pubkey: e.pubkey,
          created_at: e.created_at,
          kind: e.kind,
          tags: e.tags,
          content: e.content,
          sig: e.sig,
        })))
      );
    } catch {
      // storage full — ignore
    }
  }

  // --- localStorage: read timestamps ---

  private _markRead(partnerPubkey: string): void {
    this._lastRead.set(partnerPubkey, Math.floor(Date.now() / 1000));
    this._saveLastRead();
  }

  private _loadLastRead(): void {
    try {
      const raw = localStorage.getItem(READ_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        for (const [k, v] of Object.entries(data)) {
          this._lastRead.set(k, v as number);
        }
      }
    } catch {
      // ignore
    }
  }

  private _saveLastRead(): void {
    try {
      const obj: Record<string, number> = {};
      for (const [k, v] of this._lastRead) {
        obj[k] = v;
      }
      localStorage.setItem(READ_KEY, JSON.stringify(obj));
    } catch {
      // ignore
    }
  }

  destroy(): void {
    if (this._sub) {
      this._sub.close();
      this._sub = null;
    }
    this._events = [];
    this._seenIds.clear();
    this._decrypted.clear();
    this._myPubkey = null;
  }
}

export const DM = new DMService();
