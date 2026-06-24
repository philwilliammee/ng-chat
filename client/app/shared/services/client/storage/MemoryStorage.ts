class MemoryStorage implements Storage {
  private static _instance: MemoryStorage;
  private cache = new Map();

  static get Instance(): MemoryStorage {
    return this._instance || (this._instance = new this());
  }

  get length(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }

  getItem(key: string): string | null {
    return this.cache.get(key) || null;
  }

  key(index: number): string | null {
    return Array.from(this.cache.keys())[index] || null;
  }

  removeItem(key: string): void {
    this.cache.delete(key);
  }

  setItem(key: string, value: string): void {
    this.cache.set(key, value);
  }
}

export default MemoryStorage.Instance;
