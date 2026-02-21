import { create } from 'zustand';
import type { TrendingHashtag, TrendingPost } from '@/types/nostr';
import { Trending } from '@/services/trending';

interface TrendingStore {
  hashtags: TrendingHashtag[];
  posts: TrendingPost[];
  loading: boolean;
  lastUpdated: number;
  updateTick: number;

  initialize: () => void;
  refresh: () => Promise<void>;
}

export const useTrendingStore = create<TrendingStore>((set, get) => ({
  hashtags: [],
  posts: [],
  loading: true,
  lastUpdated: 0,
  updateTick: 0,

  initialize: () => {
    Trending.onUpdate = () => {
      set({
        hashtags: [...Trending.hashtags],
        posts: [...Trending.posts],
        loading: false,
        lastUpdated: Trending.lastFetchedAt,
        updateTick: get().updateTick + 1,
      });
    };

    Trending.start();
  },

  refresh: async () => {
    set({ loading: true });
    await Trending.refresh();
  },
}));
