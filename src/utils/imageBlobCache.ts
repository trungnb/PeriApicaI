/**
 * imageBlobCache.ts
 * In-memory LRU Cache with byte caps & 2-hour TTL for radiograph data blobs and Object URLs.
 * Ensures memory is bounded (<= 25MB total or <= 50 entries) and automatically pruned.
 */

interface CacheEntry {
  blobUrl?: string;
  dataUrl?: string;
  estimatedBytes: number;
  createdAt: number;
  expiresAt: number;
  lastAccessed: number;
}

const TTL_2_HOURS_MS = 2 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;
const MAX_CACHE_BYTES = 25 * 1024 * 1024; // 25 MB max in-memory cache

class ImageBlobCacheManager {
  private cache = new Map<string, CacheEntry>();
  private totalBytes = 0;

  /**
   * Cleans up expired entries (older than 2 hours).
   */
  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.revokeEntry(entry);
        this.totalBytes = Math.max(0, this.totalBytes - entry.estimatedBytes);
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
   * Enforces max capacity and byte limits using Least Recently Used (LRU) policy.
   */
  private enforceCapacity(): void {
    while (this.cache.size > MAX_CACHE_ENTRIES || this.totalBytes > MAX_CACHE_BYTES) {
      let oldestKey: string | null = null;
      let oldestAccess = Infinity;

      for (const [key, entry] of this.cache.entries()) {
        if (entry.lastAccessed < oldestAccess) {
          oldestAccess = entry.lastAccessed;
          oldestKey = key;
        }
      }

      if (!oldestKey) break;

      const entry = this.cache.get(oldestKey);
      if (entry) {
        this.revokeEntry(entry);
        this.totalBytes = Math.max(0, this.totalBytes - entry.estimatedBytes);
        this.cache.delete(oldestKey);
      }
    }
  }

  /**
   * Registers or updates an image blob/dataUrl in the cache with a 2-hour TTL.
   */
  public set(key: string, data: { blob?: Blob | File; dataUrl?: string }): { blobUrl?: string; dataUrl?: string } {
    if (!key) return {};
    this.pruneExpired();

    // If an existing entry exists under this key, revoke its previous object URL and subtract bytes
    const existing = this.cache.get(key);
    if (existing) {
      this.revokeEntry(existing);
      this.totalBytes = Math.max(0, this.totalBytes - existing.estimatedBytes);
      this.cache.delete(key);
    }

    let blobUrl: string | undefined;
    let estimatedBytes = 0;

    if (data.blob) {
      try {
        blobUrl = URL.createObjectURL(data.blob);
        estimatedBytes += data.blob.size;
      } catch {
        // Fallback if URL.createObjectURL fails
      }
    }

    if (data.dataUrl) {
      // If we don't have blob, estimate dataUrl bytes (approx char length * 2)
      estimatedBytes += Math.round(data.dataUrl.length * 1.5);
    }

    const now = Date.now();
    const entry: CacheEntry = {
      blobUrl,
      dataUrl: data.dataUrl,
      estimatedBytes,
      createdAt: now,
      expiresAt: now + TTL_2_HOURS_MS,
      lastAccessed: now,
    };

    this.cache.set(key, entry);
    this.totalBytes += estimatedBytes;
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
      this.totalBytes = Math.max(0, this.totalBytes - entry.estimatedBytes);
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
      this.totalBytes = Math.max(0, this.totalBytes - entry.estimatedBytes);
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
    this.totalBytes = 0;
  }

  /**
   * Returns diagnostics: count and estimated cache memory bytes.
   */
  public getDiagnostics(): { count: number; totalBytes: number; maxBytes: number } {
    this.pruneExpired();
    return {
      count: this.cache.size,
      totalBytes: this.totalBytes,
      maxBytes: MAX_CACHE_BYTES,
    };
  }

  public size(): number {
    this.pruneExpired();
    return this.cache.size;
  }
}

export const imageBlobCache = new ImageBlobCacheManager();
