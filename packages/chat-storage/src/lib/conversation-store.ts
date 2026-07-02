import type { Conversation } from './types';

const DB_NAME = 'ng-chat-db';
const DB_VERSION = 1;
const STORE = 'conversations';

/**
 * Zero-dependency IndexedDB wrapper for Conversation records.
 * All methods are Promise-based; no third-party idb library required.
 * Instantiate once per app (e.g. as a module-level singleton or via DI).
 */
export class ConversationStore {
  private db: IDBDatabase | null = null;
  private openPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    return (this.openPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('by_updated', 'updatedAt');
      };
      req.onsuccess = () => {
        this.db = req.result;
        this.db.onversionchange = () => { this.db?.close(); this.db = null; this.openPromise = null; };
        resolve(this.db);
      };
      req.onerror = () => { this.openPromise = null; reject(req.error); };
    }));
  }

  async save(conv: Conversation): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(conv);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadAll(): Promise<Conversation[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).index('by_updated').getAll();
      req.onsuccess = () => resolve((req.result as Conversation[]).reverse());
      req.onerror = () => reject(req.error);
    });
  }

  async load(id: string): Promise<Conversation | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as Conversation) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clear(): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
