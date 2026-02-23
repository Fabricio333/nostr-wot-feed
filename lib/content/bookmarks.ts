import type { Note } from '@/types/nostr';
import { getSettings, setSetting } from '@/lib/storage/settings';

class BookmarksService {
  list = new Map<string, Note>();

  init(): void {
    const saved = getSettings().bookmarks;
    if (saved && typeof saved === 'object') {
      for (const [id, data] of Object.entries(saved)) {
        this.list.set(id, data);
      }
    }
  }

  has(noteId: string): boolean {
    return this.list.has(noteId);
  }

  toggle(noteId: string, noteData: Note): void {
    if (this.list.has(noteId)) {
      this.list.delete(noteId);
    } else {
      this.list.set(noteId, { ...noteData });
    }
    this._save();
  }

  private _save(): void {
    const obj: Record<string, Note> = {};
    for (const [id, data] of this.list) {
      obj[id] = data;
    }
    setSetting('bookmarks', obj);
  }
}

export const Bookmarks = new BookmarksService();
