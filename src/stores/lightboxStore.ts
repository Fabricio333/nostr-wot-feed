import { create } from 'zustand';

export interface LightboxItem {
  type: 'image' | 'video';
  src: string;
}

interface LightboxStore {
  isOpen: boolean;
  items: LightboxItem[];
  currentIndex: number;
  open: (items: LightboxItem[], startIndex?: number) => void;
  close: () => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
}

export const useLightboxStore = create<LightboxStore>((set, get) => ({
  isOpen: false,
  items: [],
  currentIndex: 0,

  open: (items, startIndex = 0) =>
    set({ isOpen: true, items, currentIndex: startIndex }),

  close: () =>
    set({ isOpen: false, items: [], currentIndex: 0 }),

  next: () => {
    const { currentIndex, items } = get();
    if (currentIndex < items.length - 1) set({ currentIndex: currentIndex + 1 });
  },

  prev: () => {
    const { currentIndex } = get();
    if (currentIndex > 0) set({ currentIndex: currentIndex - 1 });
  },

  goTo: (index) => {
    const { items } = get();
    if (index >= 0 && index < items.length) set({ currentIndex: index });
  },
}));
