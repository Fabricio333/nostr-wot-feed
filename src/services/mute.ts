import { Signer } from './signer';
import { Relay } from './relay';
import { WoT } from './wot';

class MuteService {
  list = new Set<string>();
  onUpdate: (() => void) | null = null;

  private _notify() {
    this.onUpdate?.();
  }

  async loadFromRelay(): Promise<void> {
    if (!WoT.myPubkey) return;

    try {
      const pool = Relay.pool;
      if (!pool) return;

      const events = await pool.querySync(Relay.getUrls(), {
        kinds: [10000],
        authors: [WoT.myPubkey],
      });

      if (events.length === 0) return;

      const latest = events.reduce((a, b) =>
        a.created_at > b.created_at ? a : b
      );
      const relayPubkeys = latest.tags
        .filter((t: string[]) => t[0] === 'p' && t[1])
        .map((t: string[]) => t[1]);

      this.list.clear();
      relayPubkeys.forEach((pk: string) => this.list.add(pk));
      this._notify();
    } catch {
      // relay load failed
    }
  }

  async publishToRelay(): Promise<boolean> {
    if (!Signer.isLoggedIn() || Signer.isReadOnly()) return false;

    try {
      const tags = [...this.list].map((pk) => ['p', pk]);
      const event = {
        kind: 10000,
        content: '',
        tags,
        created_at: Math.floor(Date.now() / 1000),
      };
      const signed = await Signer.signEvent(event);
      await Relay.publishEvent(signed);
      return true;
    } catch {
      return false;
    }
  }

  isMuted(pubkey: string): boolean {
    return this.list.has(pubkey);
  }

  toggle(pubkey: string): void {
    if (this.list.has(pubkey)) {
      this.list.delete(pubkey);
    } else {
      this.list.add(pubkey);
    }
    this._notify();
    this.publishToRelay();
  }

  unmute(pubkey: string): void {
    this.list.delete(pubkey);
    this._notify();
    this.publishToRelay();
  }
}

export const Mute = new MuteService();
