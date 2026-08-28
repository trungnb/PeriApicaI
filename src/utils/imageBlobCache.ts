/**
 * imageBlobCache.ts
 * In-memory LRU Cache with 24-hour TTL for radiograph data blobs and Object URLs.
 * Ensures memory is automatically pruned after 24h and supports immediate eviction upon session completion.
 */

interface CacheEntry {
  blobUrl?: string;
  dataUrl?: string;
  createdAt: number;
  expiresAt: number;
  lastAccessed: number;
}

const TTL_24_HOURS_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;

class ImageBlobCacheManager {
  private cache = new Map<string, CacheEntry>();

  /**
   * Cleans up expired entries (older than 24 hours).
   */
  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.revokeEntry(entry);
        this.cache.delete(key);
      }
    }
  }

  /**
   * Helper to safely revoke an Object URL if present.
   */
  private revokeEntry(entry: CacheEntry): void {
    if (entry.blobUrl && entry.blobUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(entry.blobUrl);
      } catch {
        // Ignore any errors during revocation
      }
    }
  }

  /**
   * Enforces max capacity using Least Recently Used (LRU) policy.
   */
  private enforceCapacity(): void {
    if (this.cache.size <= MAX_CACHE_ENTRIES) return;

    // Find the least recently accessed key
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestAccess) {
        oldestAccess = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.cache.get(oldestKey);
      if (entry) {
        this.revokeEntry(entry);
        this.cache.delete(oldestKey);
      }
    }
  }

  /**
   * Registers or updates an image blob/dataUrl in the cache with a 24-hour TTL.
   */
  public set(key: string, data: { blob?: Blob | File; dataUrl?: string }): { blobUrl?: string; dataUrl?: string } {
    if (!key) return {};
    this.pruneExpired();

    // If an existing entry exists under this key, revoke its previous object URL
    const existing = this.cache.get(key);
    if (existing) {
      this.revokeEntry(existing);
      this.cache.delete(key);
    }

    let blobUrl: string | undefined;
    if (data.blob) {
      try {
        blobUrl = URL.createObjectURL(data.blob);
      } catch {
        // Fallback if URL.createObjectURL fails
      }
    }

    const now = Date.now();
    const entry: CacheEntry = {
      blobUrl,
      dataUrl: data.dataUrl,
      createdAt: now,
      expiresAt: now + TTL_24_HOURS_MS,
      lastAccessed: now,
    };

    this.cache.set(key, entry);
    this.enforceCapacity();

    return { blobUrl, dataUrl: data.dataUrl };
  }

  /**
   * Retrieves an image from the cache and updates its LRU access timestamp.
   */
  public get(key: string): { blobUrl?: string; dataUrl?: string } | null {
    if (!key) return null;
    this.pruneExpired();

    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.revokeEntry(entry);
      this.cache.delete(key);
      return null;
    }

    entry.lastAccessed = Date.now();
    return { blobUrl: entry.blobUrl, dataUrl: entry.dataUrl };
  }

  /**
   * Immediately clears and revokes memory for a specific session/assessment.
   */
  public evictSessionImage(key: string): void {
    if (!key) return;
    const entry = this.cache.get(key);
    if (entry) {
      this.revokeEntry(entry);
      this.cache.delete(key);
    }
  }

  /**
   * Clears and revokes all cached image URLs in memory.
   */
  public clearAll(): void {
    for (const entry of this.cache.values()) {
      this.revokeEntry(entry);
    }
    this.cache.clear();
  }

  /**
   * Returns current count of cached sessions for diagnostics.
   */
  public size(): number {
    this.pruneExpired();
    return this.cache.size;
  }
}

export const imageBlobCache = new ImageBlobCacheManager();
