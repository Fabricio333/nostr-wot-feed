import type { UnsignedEvent } from '@/types/nostr';
import { Signer } from './signer';
import { Relay } from './relay';

class ActionsService {
  liked = new Set<string>();
  reposted = new Set<string>();

  async like(
    noteId: string,
    authorPubkey: string
  ): Promise<{ success: boolean; error?: string }> {
    if (this.liked.has(noteId)) return { success: true };
    if (!Signer.isLoggedIn() || Signer.isReadOnly()) {
      return { success: false, error: 'Login required' };
    }

    try {
      const event: UnsignedEvent = {
        kind: 7,
        content: '+',
        tags: [
          ['e', noteId],
          ['p', authorPubkey],
        ],
        created_at: Math.floor(Date.now() / 1000),
      };
      const signed = await Signer.signEvent(event);
      await Relay.publishEvent(signed);
      this.liked.add(noteId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async repost(
    noteId: string,
    authorPubkey: string
  ): Promise<{ success: boolean; error?: string }> {
    if (this.reposted.has(noteId)) return { success: true };
    if (!Signer.isLoggedIn() || Signer.isReadOnly()) {
      return { success: false, error: 'Login required' };
    }

    try {
      const relayHint = Relay.getUrls()[0] || '';
      const event: UnsignedEvent = {
        kind: 6,
        content: '',
        tags: [
          ['e', noteId, relayHint],
          ['p', authorPubkey],
        ],
        created_at: Math.floor(Date.now() / 1000),
      };
      const signed = await Signer.signEvent(event);
      await Relay.publishEvent(signed);
      this.reposted.add(noteId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async reply(
    noteId: string,
    authorPubkey: string,
    content: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!content.trim()) return { success: false, error: 'Empty content' };
    if (!Signer.isLoggedIn() || Signer.isReadOnly()) {
      return { success: false, error: 'Login required' };
    }

    try {
      const relayHint = Relay.getUrls()[0] || '';
      const event: UnsignedEvent = {
        kind: 1,
        content: content.trim(),
        tags: [
          ['e', noteId, relayHint, 'reply'],
          ['p', authorPubkey],
        ],
        created_at: Math.floor(Date.now() / 1000),
      };
      const signed = await Signer.signEvent(event);
      await Relay.publishEvent(signed);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async publishNote(
    content: string
  ): Promise<{ success: boolean; event?: any; error?: string }> {
    if (!content.trim()) return { success: false, error: 'Empty content' };
    if (!Signer.isLoggedIn() || Signer.isReadOnly()) {
      return { success: false, error: 'Login required' };
    }

    try {
      const event: UnsignedEvent = {
        kind: 1,
        content: content.trim(),
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      };
      const signed = await Signer.signEvent(event);
      await Relay.publishEvent(signed);
      return { success: true, event: signed };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }
}

export const Actions = new ActionsService();
