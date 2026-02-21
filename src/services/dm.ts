import type { NostrEvent, Conversation, DMMessage } from '@/types/nostr';
import { Relay } from './relay';
import { Signer } from './signer';
import { Profiles } from './profiles';
import { Mute } from './mute';

class DMService {
  private _events: NostrEvent[] = [];
  private _decrypted = new Map<string, string>();
  private _sub: any = null;
  private _myPubkey: string | null = null;
  private _lastRead = new Map<string, number>(); // partnerPubkey → timestamp

  onEvent: (() => void) | null = null;

  get initialized(): boolean {
    return this._myPubkey !== null;
  }

  async subscribe(myPubkey: string): Promise<void> {
    this._myPubkey = myPubkey;
    this._loadLastRead();

    const pool = Relay.pool;
    if (!pool) return;

    const urls = Relay.getUrls();
    const since = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60; // last 7 days

    // Fetch existing DMs
    const [received, sent] = await Promise.all([
      pool.querySync(urls, { kinds: [4], '#p': [myPubkey], since, limit: 200 } as any),
      pool.querySync(urls, { kinds: [4], authors: [myPubkey], since, limit: 200 } as any),
    ]);

    const seenIds = new Set<string>();
    for (const ev of [...received, ...sent]) {
      if (!seenIds.has(ev.id)) {
        seenIds.add(ev.id);
        this._events.push(ev);
      }
    }

    // Sort by time
    this._events.sort((a, b) => a.created_at - b.created_at);

    // Request profiles for all conversation partners
    const partners = new Set<string>();
    for (const ev of this._events) {
      const partner = this._getPartner(ev);
      if (partner) partners.add(partner);
    }
    for (const pk of partners) {
      Profiles.request(pk);
    }

    // Subscribe to live DMs — use subscribeMap for multiple filters
    const dmFilters = [
      { kinds: [4], '#p': [myPubkey] },
      { kinds: [4], authors: [myPubkey] },
    ];
    const dmRequests = urls.flatMap((url) =>
      dmFilters.map((filter) => ({ url, filter }))
    );
    this._sub = pool.subscribeMap(dmRequests, {
      onevent: (event: NostrEvent) => {
        if (seenIds.has(event.id)) return;
        seenIds.add(event.id);
        this._events.push(event);
        const partner = this._getPartner(event);
        if (partner) Profiles.request(partner);
        this.onEvent?.();
      },
    });
  }

  private _getPartner(event: NostrEvent): string | null {
    if (!this._myPubkey) return null;
    if (event.pubkey === this._myPubkey) {
      // I sent it — partner is the p tag
      const pTag = event.tags.find((t) => t[0] === 'p');
      return pTag?.[1] || null;
    }
    // They sent it — partner is the sender
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

    const conversations: Conversation[] = [];

    for (const [partnerPubkey, data] of convMap) {
      // Skip muted users
      if (Mute.isMuted(partnerPubkey)) continue;

      // Get most recent event for last message preview
      const latest = data.events.reduce((a, b) =>
        a.created_at > b.created_at ? a : b
      );
      const lastMessage = await this.decrypt(latest);

      // Count unread (messages from partner after our last read time)
      const lastReadTime = this._lastRead.get(partnerPubkey) || 0;
      const unread = data.events.filter(
        (ev) => ev.pubkey !== this._myPubkey && ev.created_at > lastReadTime
      ).length;

      conversations.push({
        partnerPubkey,
        lastMessage,
        lastTimestamp: data.lastTimestamp,
        unread,
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
    for (const ev of partnerEvents) {
      const content = await this.decrypt(ev);
      messages.push({
        id: ev.id,
        fromMe: ev.pubkey === this._myPubkey,
        content,
        timestamp: ev.created_at,
      });
    }

    // Mark conversation as read
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

      // Add to local events
      this._events.push(signed);
      this._decrypted.set(signed.id, plaintext);

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  private _markRead(partnerPubkey: string): void {
    this._lastRead.set(partnerPubkey, Math.floor(Date.now() / 1000));
    this._saveLastRead();
  }

  private _loadLastRead(): void {
    try {
      const raw = localStorage.getItem('wot-feed-dm-read');
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
      localStorage.setItem('wot-feed-dm-read', JSON.stringify(obj));
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
    this._decrypted.clear();
    this._myPubkey = null;
  }
}

export const DM = new DMService();
