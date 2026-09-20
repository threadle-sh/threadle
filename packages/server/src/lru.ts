/**
 * Minimal LRU on Map's insertion-order iteration: get() re-inserts to mark
 * recency, set() evicts the oldest entry past `max`. For long-lived
 * path-keyed caches (transcript scans, node manifests) whose cardinality
 * otherwise grows for the daemon's whole lifetime.
 */
export class LruMap<K, V> {
  private map = new Map<K, V>();

  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined || this.map.has(key)) {
      this.map.delete(key);
      this.map.set(key, val as V);
    }
    return val;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }
}
