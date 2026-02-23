import { create } from 'zustand';
import type { Conversation, DMMessage } from '@/types/nostr';
import { DM } from '@/lib/nostr/dm';

interface DMStore {
  conversations: Conversation[];
  currentMessages: DMMessage[];
  currentPartner: string | null;
  loading: boolean;
  initialized: boolean;
  updateTick: number;

  init: (myPubkey: string) => Promise<void>;
  loadConversation: (partnerPubkey: string) => Promise<void>;
  sendMessage: (partnerPubkey: string, text: string) => Promise<{ success: boolean; error?: string }>;
  refreshConversations: () => Promise<void>;
}

export const useDMStore = create<DMStore>((set, get) => ({
  conversations: [],
  currentMessages: [],
  currentPartner: null,
  loading: false,
  initialized: false,
  updateTick: 0,

  init: async (myPubkey: string) => {
    if (get().initialized) return;
    set({ loading: true });

    await DM.subscribe(myPubkey);

    // Wire live event updates
    DM.onEvent = () => {
      get().refreshConversations();
      // If viewing a conversation, refresh messages too
      const partner = get().currentPartner;
      if (partner) {
        DM.getMessages(partner).then((messages) => {
          set({ currentMessages: messages });
        });
      }
    };

    const conversations = await DM.getConversations();
    set({ conversations, loading: false, initialized: true });
  },

  loadConversation: async (partnerPubkey: string) => {
    set({ loading: true, currentPartner: partnerPubkey });
    const messages = await DM.getMessages(partnerPubkey);
    set({ currentMessages: messages, loading: false });

    // Refresh conversations to clear unread counts
    const conversations = await DM.getConversations();
    set({ conversations });
  },

  sendMessage: async (partnerPubkey: string, text: string) => {
    const result = await DM.sendDM(partnerPubkey, text);
    if (result.success) {
      // Refresh current conversation
      const messages = await DM.getMessages(partnerPubkey);
      set({ currentMessages: messages });

      // Refresh conversations list
      const conversations = await DM.getConversations();
      set({ conversations });
    }
    return result;
  },

  refreshConversations: async () => {
    const conversations = await DM.getConversations();
    set({ conversations, updateTick: get().updateTick + 1 });
  },
}));
