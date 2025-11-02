/* eslint-disable @typescript-eslint/no-explicit-any */
import { LRUCache } from "lru-cache";

export type PyPISearchObject = {
  name: string;
};

import { PYPI_API_CONFIG } from "./config";

const PYPI_BASE = "https://pypi.org" as const;
const PYPI_JSON_API = PYPI_API_CONFIG.PYPI_JSON_API_BASE;
const PYPI_SIMPLE_API = "https://pypi.org/simple" as const;
const PYPI_SEARCH_API = PYPI_API_CONFIG.PYPI_SEARCH_API_BASE;
const LIBRARIES_IO_API = PYPI_API_CONFIG.LIBRARIES_IO_API_BASE;

// Rate limiting: track last request time per domain
const lastRequestTime = new Map<string, number>();

// Shared in-memory LRU across module reloads
type PyPILru = LRUCache<string, any>;

function getSharedPyPILru(): PyPILru {
  const g = globalThis as unknown as { __pypiLru?: PyPILru };
  if (g.__pypiLru) return g.__pypiLru;
  const cache = new LRUCache<string, any>({ max: PYPI_API_CONFIG.CACHE_MAX_SIZE, ttl: PYPI_API_CONFIG.CACHE_TTL_MS });
  g.__pypiLru = cache;
  return cache;
}

// Check if error is a network/connection error that should be retried
function isRetryableError(err: unknown): boolean {
  if (!err) return false;
  const msg = String(err);
  const code = (err as { code?: string }).code;
  // Connection errors that should be retried
  const retryableCodes = ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ECONNRESET", "EAI_AGAIN"];
  const retryableMessages = ["network", "timeout", "connection", "failed to fetch", "fetch failed"];
  if (code && retryableCodes.includes(code)) return true;
  return retryableMessages.some(function (pattern) { return msg.toLowerCase().includes(pattern); });
}

// Rate limiting: ensure minimum delay between requests to same domain
async function rateLimit(domain: string): Promise<void> {
  const last = lastRequestTime.get(domain) || 0;
  const now = Date.now();
  const elapsed = now - last;
  if (elapsed < PYPI_API_CONFIG.REQUEST_DELAY_MS) {
    await new Promise(function (resolve) { setTimeout(resolve, PYPI_API_CONFIG.REQUEST_DELAY_MS - elapsed); });
  }
  lastRequestTime.set(domain, Date.now());
}

// Fetch with timeout
async function fetchWithTimeout(url: string, options: { cache?: RequestCache; headers?: Record<string, string> } = {}, timeoutMs: number = PYPI_API_CONFIG.FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(function () { controller.abort(); }, timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function fetchJsonWithCache(key: string, url: string, revalidateSeconds: number, headers?: Record<string, string>): Promise<any> {
  // Re-enable selective caching for metadata (rarely changes, 1 hour TTL)
  const lru = getSharedPyPILru();
  const hit = lru.get(key);
  if (hit) return hit as any;

  // Extract domain for rate limiting
  let domain = "default";
  try {
    const urlObj = new URL(url);
    domain = urlObj.hostname;
  } catch {
    // ignore URL parse errors
  }

  // Apply rate limiting
  await rateLimit(domain);

  let attempt = 0;
  let lastError: unknown;

  while (attempt < PYPI_API_CONFIG.MAX_RETRY_ATTEMPTS) {
    attempt += 1;
    try {
      // Use 'no-store' to disable Next.js data cache (2MB limit)
      // We rely on in-memory LRU cache instead
      const res = await fetchWithTimeout(url, { cache: "no-store", headers }, PYPI_API_CONFIG.FETCH_TIMEOUT_MS);
      
      if (!res.ok) {
        // Retry on 429 (rate limit) and 5xx (server errors)
        if ((res.status === 429 || res.status >= 500) && attempt < PYPI_API_CONFIG.MAX_RETRY_ATTEMPTS) {
          const delay = Math.min(PYPI_API_CONFIG.RETRY_INITIAL_DELAY_MS * (2 ** (attempt - 1)), PYPI_API_CONFIG.RETRY_MAX_DELAY_MS) + Math.floor(Math.random() * PYPI_API_CONFIG.RETRY_JITTER_MS);
          await new Promise(function (r) { setTimeout(r, delay); });
          // Re-apply rate limiting after retry delay
          await rateLimit(domain);
          continue;
        }
        throw new Error("HTTP " + String(res.status) + " for " + url);
      }

      const json = await res.json();
      // Cache metadata (1 hour TTL) - rarely changes
      lru.set(key, json);
      return json;
    } catch (err) {
      lastError = err;

      // Check if it's a retryable error
      const shouldRetry = isRetryableError(err) || (err as { status?: number }).status === 429 || ((err as { status?: number }).status || 0) >= 500;

      if (!shouldRetry || attempt >= PYPI_API_CONFIG.MAX_RETRY_ATTEMPTS) {
        // Not retryable or max attempts reached
        throw err;
      }

      // Calculate exponential backoff with jitter
      const baseDelay = PYPI_API_CONFIG.RETRY_INITIAL_DELAY_MS * (2 ** (attempt - 1));
      const delay = Math.min(baseDelay, PYPI_API_CONFIG.RETRY_MAX_DELAY_MS) + Math.floor(Math.random() * PYPI_API_CONFIG.RETRY_JITTER_MS);
      await new Promise(function (r) { setTimeout(r, delay); });
      
      // Re-apply rate limiting after retry delay
      await rateLimit(domain);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError || new Error("Max retry attempts reached");
}

export async function fetchPackageMeta(packageName: string): Promise<any> {
  const key = "pypi:meta:" + packageName.toLowerCase();
  const url = `${PYPI_JSON_API}/${encodeURIComponent(packageName.toLowerCase())}/json`;
  return await fetchJsonWithCache(key, url, PYPI_API_CONFIG.META_CACHE_TTL_SECONDS);
}

export async function searchTopPackages(limit: number): Promise<string[]> {
  // PyPI doesn't have a direct popularity search like npm, so we'll use search with empty query
  // which returns popular packages, or use a simple list from popular.json
  const size = Math.min(limit, PYPI_API_CONFIG.MAX_SEARCH_LIMIT);
  const key = "pypi:top:" + String(size);
  // PyPI search API: https://pypi.org/search/?q=&o=-created
  // But it's not reliable, so we'll return empty and let the caller use popular.json
  // For now, we'll try to get packages from search API
  const url = `${PYPI_SEARCH_API}/?q=&o=-created`;
  
  try {
    // Note: PyPI search doesn't have a proper JSON API, so we'll return empty
    // The popular packages list should be used instead
    return [];
  } catch {
    return [];
  }
}

// Normalize package name (PyPI package names are case-insensitive and normalized)
function normalizePackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]/g, "-").toLowerCase();
}

export async function fetchReverseDependentsApprox(packageName: string): Promise<string[]> {
  // Reverse dependencies are now built from PyPI API and cached in reverseDeps-*.json files
  // The cache loader will handle loading from these files
  // This function is kept for backward compatibility but now returns empty array
  // The actual reverse deps are loaded via loadReverseDepsCache() in lib/cache.ts
  return [];
}

export function pickLatestDependencies(meta: any): string[] {
  // PyPI metadata structure: info.requires_dist is an array of dependency strings
  // Format: "package-name>=version" or "package-name[extra]>=version"
  const info = meta?.info || {};
  const requiresDist = info.requires_dist || [];
  
  if (!Array.isArray(requiresDist)) return [];
  
  const deps = new Set<string>();
  for (let i = 0; i < requiresDist.length; i += 1) {
    const dep = requiresDist[i];
    if (typeof dep !== "string") continue;
    
    // Parse dependency string: "package-name>=version" -> "package-name"
    // Handle extras: "package[extra]>=version" -> "package"
    let depName = dep.trim();
    
    // Remove version specifiers: >=, ==, !=, <, >, ~=, etc.
    // Remove extras: [extra]
    depName = depName.replace(/\[.*?\]/g, ""); // Remove extras
    depName = depName.split(/[>=<!=~]/)[0].trim(); // Get name before version specifier
    depName = depName.replace(/^[+-]/g, "").trim(); // Remove leading +/- (markers)
    
    if (depName) {
      deps.add(depName.toLowerCase());
    }
  }
  
  // Also check requires (older format, but still used)
  const requires = info.requires || [];
  if (Array.isArray(requires)) {
    for (let i = 0; i < requires.length; i += 1) {
      const dep = requires[i];
      if (typeof dep === "string") {
        let depName = dep.trim();
        depName = depName.replace(/\[.*?\]/g, "");
        depName = depName.split(/[>=<!=~]/)[0].trim();
        if (depName) {
          deps.add(depName.toLowerCase());
        }
      }
    }
  }
  
  return Array.from(deps);
}


