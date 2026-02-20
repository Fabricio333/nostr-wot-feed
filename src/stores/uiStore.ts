import { create } from 'zustand';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface UIStore {
  theme: 'dark' | 'light';
  profileModalPubkey: string | null;
  composeModalOpen: boolean;
  settingsOpen: boolean;
  toasts: Toast[];

  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  openProfileModal: (pubkey: string) => void;
  closeProfileModal: () => void;
  openCompose: () => void;
  closeCompose: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  showToast: (message: string, type?: ToastType) => void;
  dismissToast: (id: string) => void;
}

let toastCounter = 0;

export const useUIStore = create<UIStore>((set) => ({
  theme: 'dark',
  profileModalPubkey: null,
  composeModalOpen: false,
  settingsOpen: false,
  toasts: [],

  setTheme: (theme) => set({ theme }),

  toggleTheme: () =>
    set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),

  openProfileModal: (pubkey) => set({ profileModalPubkey: pubkey }),
  closeProfileModal: () => set({ profileModalPubkey: null }),

  openCompose: () => set({ composeModalOpen: true }),
  closeCompose: () => set({ composeModalOpen: false }),

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  showToast: (message, type = 'info') => {
    const id = `toast-${++toastCounter}`;
    set((state) => ({
      toasts: [...state.toasts, { id, message, type }],
    }));
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, 2500);
  },

  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));
