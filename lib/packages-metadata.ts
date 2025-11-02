import { existsSync, readFileSync } from "fs";
import path from "path";

// Helper function to get project root
function getProjectRoot(): string {
  const cwd = process.cwd();
  const dataPath = path.join(cwd, "data", "popular.json");
  if (existsSync(dataPath)) {
    return cwd;
  }
  try {
    const parentPath = path.resolve(cwd, "..", "data", "popular.json");
    if (existsSync(parentPath)) {
      return path.resolve(cwd, "..");
    }
  } catch {
    // Continue
  }
  return cwd;
}

// Normalize package name (case-insensitive)
function normalizePackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]/g, "-");
}

// Cache loaded metadata (in-memory)
let versionsCache: Record<string, string> | null = null;
let depsCountCache: Record<string, number> | null = null;
let repositoriesCache: Record<string, string | null> | null = null;
let downloadsCache: Record<string, { recent: number; mirrors: number; total: number } | null> | null = null;
let descriptionsCache: Record<string, string> | null = null;

/**
 * Load package versions from file
 * Format: { "package-name": "1.2.3" }
 */
export function loadVersions(): Record<string, string> {
  if (versionsCache) return versionsCache;
  const projectRoot = getProjectRoot();
  const filePath = path.join(projectRoot, "data", "packages-versions.json");
  if (!existsSync(filePath)) {
    versionsCache = {};
    return versionsCache;
  }
  try {
    versionsCache = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    versionsCache = {};
  }
  return versionsCache || {};
}

/**
 * Load dependency counts from file
 * Format: { "package-name": 5 }
 */
export function loadDepsCount(): Record<string, number> {
  if (depsCountCache) return depsCountCache;
  const projectRoot = getProjectRoot();
  const filePath = path.join(projectRoot, "data", "packages-deps-count.json");
  if (!existsSync(filePath)) {
    depsCountCache = {};
    return depsCountCache;
  }
  try {
    depsCountCache = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    depsCountCache = {};
  }
  return depsCountCache || {};
}

/**
 * Load repositories from file
 * Format: { "package-name": "https://github.com/user/repo" }
 */
export function loadRepositories(): Record<string, string | null> {
  if (repositoriesCache) return repositoriesCache;
  const projectRoot = getProjectRoot();
  const filePath = path.join(projectRoot, "data", "packages-repositories.json");
  if (!existsSync(filePath)) {
    repositoriesCache = {};
    return repositoriesCache;
  }
  try {
    repositoriesCache = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    repositoriesCache = {};
  }
  return repositoriesCache || {};
}

/**
 * Load download statistics from file
 * Format: { "package-name": { recent: 1000, mirrors: 500, total: 5000 } }
 */
export function loadDownloads(): Record<string, { recent: number; mirrors: number; total: number } | null> {
  if (downloadsCache) return downloadsCache;
  const projectRoot = getProjectRoot();
  const filePath = path.join(projectRoot, "data", "packages-downloads.json");
  if (!existsSync(filePath)) {
    downloadsCache = {};
    return downloadsCache;
  }
  try {
    downloadsCache = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    downloadsCache = {};
  }
  return downloadsCache || {};
}

/**
 * Load descriptions from file
 * Format: { "package-name": "Package description..." }
 */
export function loadDescriptions(): Record<string, string> {
  if (descriptionsCache) return descriptionsCache;
  const projectRoot = getProjectRoot();
  const filePath = path.join(projectRoot, "data", "packages-descriptions.json");
  if (!existsSync(filePath)) {
    descriptionsCache = {};
    return descriptionsCache;
  }
  try {
    descriptionsCache = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    descriptionsCache = {};
  }
  return descriptionsCache || {};
}

/**
 * Combined package metadata interface
 */
export interface CombinedPackageMetadata {
  name: string;
  latest: string | null;
  dependenciesCount: number;
  repository: string | null;
  downloads: { recent: number; mirrors: number; total: number } | null;
  description: string;
}

/**
 * Get combined metadata for a single package
 * Combines data from all separate metadata files
 */
export function getPackageMetadata(pkg: string): CombinedPackageMetadata | null {
  const normalizedPkg = normalizePackageName(pkg);
  const versions = loadVersions();
  const depsCount = loadDepsCount();
  const repositories = loadRepositories();
  const downloads = loadDownloads();
  const descriptions = loadDescriptions();

  // Try normalized name first, then original name
  const version = versions[normalizedPkg] || versions[pkg];
  const deps = depsCount[normalizedPkg] || depsCount[pkg];
  const repo = repositories[normalizedPkg] || repositories[pkg];
  const dl = downloads[normalizedPkg] || downloads[pkg];
  const desc = descriptions[normalizedPkg] || descriptions[pkg];

  // If no data found at all, return null
  if (!version && deps === undefined && !repo && !dl && !desc) {
    return null;
  }

  return {
    name: pkg,
    latest: version || null,
    dependenciesCount: deps ?? 0,
    repository: repo ?? null,
    downloads: dl ?? null,
    description: desc || "",
  };
}

/**
 * Preload all metadata files into memory (optional, for faster access)
 * Call this once at application startup to cache all metadata
 */
export function preloadAllMetadata(): void {
  loadVersions();
  loadDepsCount();
  loadRepositories();
  loadDownloads();
  loadDescriptions();
}

/**
 * Clear metadata cache (useful for testing or reloading data)
 */
export function clearMetadataCache(): void {
  versionsCache = null;
  depsCountCache = null;
  repositoriesCache = null;
  downloadsCache = null;
  descriptionsCache = null;
}

