/* eslint-disable @typescript-eslint/no-explicit-any */
import { LRUCache } from "lru-cache";
import { PYPI_STATS_CONFIG } from "./config";

// Shared in-memory LRU cache for download stats
type StatsLru = LRUCache<string, DownloadStats>;

function getSharedStatsLru(): StatsLru {
  const g = globalThis as unknown as { __pypiStatsLru?: StatsLru };
  if (g.__pypiStatsLru) return g.__pypiStatsLru;
  const cache = new LRUCache<string, DownloadStats>({ max: PYPI_STATS_CONFIG.CACHE_MAX_SIZE, ttl: PYPI_STATS_CONFIG.CACHE_TTL_MS });
  g.__pypiStatsLru = cache;
  return cache;
}

export type DownloadStats = {
  recent: number; // Last 7 days
  mirrors: number; // Mirror downloads
  total: number; // Total downloads (all time)
};

// Fetch with timeout
async function fetchWithTimeout(url: string, timeoutMs: number = PYPI_STATS_CONFIG.FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(function () { controller.abort(); }, timeoutMs);
  try {
    // Use 'no-store' to disable Next.js data cache (2MB limit)
    // We rely on in-memory LRU cache instead
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Fetch download statistics from PyPI Stats API
 * @param packageName - Package name (case-insensitive)
 * @returns Download statistics or null if unavailable
 */
export async function fetchDownloadStats(packageName: string): Promise<DownloadStats | null> {
  const normalizedName = packageName.toLowerCase();
  // Re-enable selective caching for download stats (24 hour TTL - updates daily)
  const lru = getSharedStatsLru();
  const cacheKey = "pypi:stats:" + normalizedName;
  const cached = lru.get(cacheKey);
  if (cached) {
    return cached;
  }
  
  let attempt = 0;
  let lastError: unknown;
  
  while (attempt < PYPI_STATS_CONFIG.MAX_RETRY_ATTEMPTS) {
    attempt += 1;
    try {
      // PyPI Stats API endpoint: /api/packages/{package}/recent
      const url = `${PYPI_STATS_CONFIG.PYPI_STATS_API_BASE}/packages/${encodeURIComponent(normalizedName)}/recent`;
      const res = await fetchWithTimeout(url, PYPI_STATS_CONFIG.FETCH_TIMEOUT_MS);
      
      if (!res.ok) {
        // 404 means package not found in stats (common for new or less popular packages)
        if (res.status === 404) {
          return null;
        }
        
        // Retry on 429 (rate limit) and 5xx (server errors)
        if ((res.status === 429 || res.status >= 500) && attempt < PYPI_STATS_CONFIG.MAX_RETRY_ATTEMPTS) {
          const delay = PYPI_STATS_CONFIG.RETRY_INITIAL_DELAY_MS * (2 ** (attempt - 1)) + Math.floor(Math.random() * PYPI_STATS_CONFIG.RETRY_JITTER_MS);
          await new Promise(function (r) { setTimeout(r, delay); });
          continue;
        }
        
        // For other errors, return null
        return null;
      }
      
      const json = await res.json() as {
        data?: {
          recent?: number;
          mirrors?: number;
          last_day?: number;
          last_week?: number;
          last_month?: number;
        };
      };
      
      // Parse response - PyPI Stats API returns last_day, last_week, last_month
      // Use last_week as "recent" (7 days), last_day as "mirrors", last_month as "total"
      const stats: DownloadStats = {
        recent: json.data?.last_week || json.data?.recent || 0,
        mirrors: json.data?.last_day || json.data?.mirrors || 0,
        total: (json.data?.last_month as number | undefined) || 0, // Use last_month as total (last 30 days)
      };
      
      // Cache download stats (24 hour TTL) - updates daily
      lru.set(cacheKey, stats);
      return stats;
    } catch (err) {
      lastError = err;
      
      // Check if it's a retryable error
      const shouldRetry = (err as { code?: string }).code === "ECONNREFUSED" ||
        (err as { code?: string }).code === "ETIMEDOUT" ||
        String(err).toLowerCase().includes("timeout") ||
        String(err).toLowerCase().includes("network");
      
      if (!shouldRetry || attempt >= PYPI_STATS_CONFIG.MAX_RETRY_ATTEMPTS) {
        // Not retryable or max attempts reached
        return null;
      }
      
      // Exponential backoff
      const delay = PYPI_STATS_CONFIG.RETRY_INITIAL_DELAY_MS * (2 ** (attempt - 1)) + Math.floor(Math.random() * PYPI_STATS_CONFIG.RETRY_JITTER_MS);
      await new Promise(function (r) { setTimeout(r, delay); });
    }
  }
  
  // Max attempts reached
  return null;
}

/**
 * Fetch download statistics for multiple packages
 * @param packageNames - Array of package names
 * @returns Map of package name to download stats
 */
export async function fetchDownloadStatsBatch(packageNames: string[]): Promise<Map<string, DownloadStats>> {
  const results = new Map<string, DownloadStats>();
  
  // Fetch in parallel with concurrency limit
  const concurrency = PYPI_STATS_CONFIG.BATCH_CONCURRENCY;
  for (let i = 0; i < packageNames.length; i += concurrency) {
    const batch = packageNames.slice(i, i + concurrency);
    const batchPromises = batch.map(async function (pkg) {
      const stats = await fetchDownloadStats(pkg);
      if (stats) {
        results.set(pkg.toLowerCase(), stats);
      }
      return { pkg, stats };
    });
    
    await Promise.all(batchPromises);
    
    // Small delay between batches to avoid rate limiting
    if (i + concurrency < packageNames.length) {
      await new Promise(function (r) { setTimeout(r, PYPI_STATS_CONFIG.BATCH_DELAY_MS); });
    }
  }
  
  return results;
}

