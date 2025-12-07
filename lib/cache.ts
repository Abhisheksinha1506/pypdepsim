import { existsSync, readFileSync, readdirSync } from "fs";
import { promises as fs } from "fs";
import path from "path";

export type ReverseDepsCache = Record<string, string[]>;
export type SimilarIndexEntry = { name: string; jaccard: number; sharedDependents: number };
export type SimilarIndexCache = Record<string, SimilarIndexEntry[]>;

let reverseDepsCache: ReverseDepsCache | null = null;
let similarIndexCache: SimilarIndexCache | null = null;
let popularPackagesCache: string[] | null = null;

// Lazy loading state for prefix-based cache files
const prefixCacheState: Map<string, ReverseDepsCache> = new Map();
const prefixLoadingState: Map<string, Promise<ReverseDepsCache>> = new Map();
let allPrefixesLoaded = false;

// Helper function to get the project root directory reliably
function getProjectRoot(): string {
  // Try process.cwd() first (works for most cases)
  const cwd = process.cwd();
  
  // Check if data directory exists in current working directory
  const dataPath = path.join(cwd, "data", "popular.json");
  if (existsSync(dataPath)) {
    return cwd;
  }
  
  // If not found, try resolving relative to lib directory
  // This handles cases where scripts are run from different directories
  try {
    // Try going up from node_modules if we're in a nested context
    // Common scenarios:
    // 1. Running from project root: cwd is correct
    // 2. Running from nested directory: need to go up
    // 3. Running in Next.js: cwd should be project root
    
    // Try current directory's parent
    const parentPath = path.resolve(cwd, "..", "data", "popular.json");
    if (existsSync(parentPath)) {
      return path.resolve(cwd, "..");
    }
    
    // Try going up two levels (in case we're in scripts/ or similar)
    const grandparentPath = path.resolve(cwd, "..", "..", "data", "popular.json");
    if (existsSync(grandparentPath)) {
      return path.resolve(cwd, "..", "..");
    }
    
    // Try absolute path resolution from where this file is located
    // This requires using __dirname equivalent, but in ES modules we can use import.meta.url
    // However, to avoid issues, we'll just check a few common locations
    const commonPaths = [
      path.resolve(cwd, "pypdepsim", "data", "popular.json"),
      path.resolve(cwd, "..", "pypdepsim", "data", "popular.json"),
    ];
    
    for (let i = 0; i < commonPaths.length; i += 1) {
      if (existsSync(commonPaths[i])) {
        return path.dirname(path.dirname(commonPaths[i]));
      }
    }
  } catch {
    // If any resolution fails, continue
  }
  
  // Fallback: return cwd anyway and let the file existence check handle it
  return cwd;
}

/**
 * Get all possible prefix characters (for split file detection)
 */
function getAllPrefixChars(): string[] {
  const prefixes: string[] = [];
  // a-z
  for (let i = 97; i <= 122; i += 1) {
    prefixes.push(String.fromCharCode(i));
  }
  // 0-9 and other
  prefixes.push("0-9", "other");
  return prefixes;
}

/**
 * Get the prefix for a package name (for lazy loading)
 */
function getPrefixForPackage(pkgName: string): string {
  const firstChar = pkgName.toLowerCase().charAt(0);
  if (firstChar >= "a" && firstChar <= "z") {
    return firstChar;
  }
  if (firstChar >= "0" && firstChar <= "9") {
    return "0-9";
  }
  return "other";
}

/**
 * Load a single prefix file asynchronously
 */
async function loadPrefixFileAsync(prefix: string, dataDir: string): Promise<ReverseDepsCache> {
  if (prefixCacheState.has(prefix)) {
    return prefixCacheState.get(prefix)!;
  }
  
  // Check if already loading
  if (prefixLoadingState.has(prefix)) {
    return prefixLoadingState.get(prefix)!;
  }
  
  const loadingPromise = (async function () {
    const splitFilePath = path.join(dataDir, `reverseDeps-${prefix}.json`);
    try {
      if (existsSync(splitFilePath)) {
        const raw = await fs.readFile(splitFilePath, "utf-8");
        const splitData = JSON.parse(raw) as ReverseDepsCache;
        prefixCacheState.set(prefix, splitData);
        return splitData;
      }
      return {};
    } catch (e) {
      console.warn(`Failed to load prefix file ${splitFilePath}:`, (e as Error).message);
      const emptyCache: ReverseDepsCache = {};
      prefixCacheState.set(prefix, emptyCache);
      return emptyCache;
    } finally {
      prefixLoadingState.delete(prefix);
    }
  })();
  
  prefixLoadingState.set(prefix, loadingPromise);
  return loadingPromise;
}

/**
 * Load all prefix files asynchronously in parallel (when needed)
 */
async function loadAllPrefixFilesAsync(dataDir: string): Promise<ReverseDepsCache> {
  if (allPrefixesLoaded && reverseDepsCache) {
    return reverseDepsCache;
  }
  
  const combined: ReverseDepsCache = {};
  const prefixChars = getAllPrefixChars();
  
  // Load all prefix files in parallel
  const loadPromises = prefixChars.map(function (prefix) {
    return loadPrefixFileAsync(prefix, dataDir);
  });
  
  const loadedData = await Promise.all(loadPromises);
  
  for (let i = 0; i < prefixChars.length; i += 1) {
    const prefixData = loadedData[i];
    Object.assign(combined, prefixData);
  }
  
  allPrefixesLoaded = true;
  reverseDepsCache = combined;
  return combined;
}

/**
 * Get reverse deps for a specific package (lazy loading by prefix)
 */
export async function getReverseDepsForPackage(pkgName: string): Promise<string[] | null> {
  const projectRoot = getProjectRoot();
  const dataDir = path.join(projectRoot, "data");
  const prefix = getPrefixForPackage(pkgName);
  
  // Try lazy loading the specific prefix file first
  try {
    const prefixData = await loadPrefixFileAsync(prefix, dataDir);
    if (prefixData[pkgName]) {
      return prefixData[pkgName];
    }
  } catch (e) {
    console.warn(`Failed to load prefix file for ${pkgName}:`, (e as Error).message);
  }
  
  // Fallback: check if full cache is already loaded
  if (reverseDepsCache && reverseDepsCache[pkgName]) {
    return reverseDepsCache[pkgName];
  }
  
  // Fallback to legacy cache files
  const csvJsonPath = path.join(dataDir, "reverseDeps.csv.json");
  if (existsSync(csvJsonPath)) {
    try {
      const raw = await fs.readFile(csvJsonPath, "utf-8");
      const cache = JSON.parse(raw) as ReverseDepsCache;
      if (cache[pkgName]) {
        return cache[pkgName];
      }
    } catch (e) {
      // ignore
    }
  }
  
  const filePath = path.join(dataDir, "reverseDeps.1000.json");
  if (existsSync(filePath)) {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const cache = JSON.parse(raw) as ReverseDepsCache;
      if (cache[pkgName]) {
        return cache[pkgName];
      }
    } catch (e) {
      // ignore
    }
  }
  
  return null;
}

/**
 * Async version: Load reverse deps cache asynchronously (non-blocking)
 */
export async function loadReverseDepsCacheAsync(): Promise<ReverseDepsCache> {
  if (reverseDepsCache) return reverseDepsCache;
  const projectRoot = getProjectRoot();
  const dataDir = path.join(projectRoot, "data");
  
  // Strategy 1: Try to load from split PyPI-derived cache files (new format)
  try {
    // Check if single-character prefix files exist
    const prefixChars = getAllPrefixChars();
    let allSingleCharFilesExist = true;
    
    for (const prefix of prefixChars) {
      const splitFilePath = path.join(dataDir, `reverseDeps-${prefix}.json`);
      if (!existsSync(splitFilePath)) {
        allSingleCharFilesExist = false;
        break;
      }
    }
    
    if (allSingleCharFilesExist) {
      // Load all prefix files in parallel using async operations
      return await loadAllPrefixFilesAsync(dataDir);
    } else {
      // Some files may have been split further (two-character prefixes)
      // Load all reverseDeps-*.json files
      const files = readdirSync(dataDir);
      const reverseDepsFiles = files.filter(function (file: string) {
        return file.startsWith("reverseDeps-") && file.endsWith(".json");
      });
      
      if (reverseDepsFiles.length > 0) {
        const combined: ReverseDepsCache = {};
        const loadPromises = reverseDepsFiles.map(async function (file: string) {
          const splitFilePath = path.join(dataDir, file);
          try {
            const raw = await fs.readFile(splitFilePath, "utf-8");
            return JSON.parse(raw) as ReverseDepsCache;
          } catch (e) {
            console.warn(`Failed to load split file ${splitFilePath}:`, (e as Error).message);
            return {};
          }
        });
        
        const loadedData = await Promise.all(loadPromises);
        for (let i = 0; i < loadedData.length; i += 1) {
          Object.assign(combined, loadedData[i]);
        }
        
        if (Object.keys(combined).length > 0) {
          reverseDepsCache = combined;
          return reverseDepsCache;
        }
      }
    }
  } catch (e) {
    console.warn("Failed to load split cache files, trying fallback:", (e as Error).message);
  }
  
  // Strategy 2: Try to load from single cache file (backward compatibility)
  const csvJsonPath = path.join(dataDir, "reverseDeps.csv.json");
  if (existsSync(csvJsonPath)) {
    try {
      const raw = await fs.readFile(csvJsonPath, "utf-8");
      reverseDepsCache = JSON.parse(raw);
      return reverseDepsCache as ReverseDepsCache;
    } catch (e) {
      console.warn("Failed to load cache file, falling back to regular cache:", (e as Error).message);
    }
  }
  
  // Strategy 3: Load from legacy cache file
  const filePath = path.join(dataDir, "reverseDeps.1000.json");
  if (!existsSync(filePath)) {
    reverseDepsCache = {};
    return reverseDepsCache;
  }
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    reverseDepsCache = JSON.parse(raw);
    return reverseDepsCache as ReverseDepsCache;
  } catch (e) {
    console.warn("Failed to load legacy cache:", (e as Error).message);
    reverseDepsCache = {};
    return reverseDepsCache;
  }
}

/**
 * Synchronous version: Maintain backward compatibility
 * This still loads all files synchronously, but is kept for compatibility
 */
export function loadReverseDepsCache(): ReverseDepsCache {
  if (reverseDepsCache) return reverseDepsCache;
  const projectRoot = getProjectRoot();
  const dataDir = path.join(projectRoot, "data");
  
  // Strategy 1: Try to load from split PyPI-derived cache files (new format)
  // These files are generated by build-reverse-deps-from-pypi.ts
  // Can be single-char (reverseDeps-a.json) or two-char (reverseDeps-a-ab.json) if files exceeded 100MB
  try {
    const combined: ReverseDepsCache = {};
    let totalPackages = 0;
    
    // Try single-character prefix files first
    const prefixChars = getAllPrefixChars();
    let allSingleCharFilesExist = true;
    
    for (const prefix of prefixChars) {
      const splitFilePath = path.join(dataDir, `reverseDeps-${prefix}.json`);
      if (!existsSync(splitFilePath)) {
        allSingleCharFilesExist = false;
        break;
      }
    }
    
    if (allSingleCharFilesExist) {
      // Load all single-character prefix files
      for (const prefix of prefixChars) {
        const splitFilePath = path.join(dataDir, `reverseDeps-${prefix}.json`);
        try {
          const splitData = JSON.parse(readFileSync(splitFilePath, "utf-8"));
          Object.assign(combined, splitData);
          totalPackages += Object.keys(splitData).length;
        } catch (e) {
          console.warn(`Failed to load split file ${splitFilePath}:`, (e as Error).message);
        }
      }
    } else {
      // Some files may have been split further (two-character prefixes)
      // Load all reverseDeps-*.json files
      const files = readdirSync(dataDir);
      const reverseDepsFiles = files.filter(function (file: string) {
        return file.startsWith("reverseDeps-") && file.endsWith(".json");
      });
      
      if (reverseDepsFiles.length > 0) {
        for (const file of reverseDepsFiles) {
          const splitFilePath = path.join(dataDir, file);
          try {
            const splitData = JSON.parse(readFileSync(splitFilePath, "utf-8"));
            Object.assign(combined, splitData);
            totalPackages += Object.keys(splitData).length;
          } catch (e) {
            console.warn(`Failed to load split file ${splitFilePath}:`, (e as Error).message);
          }
        }
      }
    }
    
    if (totalPackages > 0) {
      reverseDepsCache = combined;
      return reverseDepsCache;
    }
  } catch (e) {
    console.warn("Failed to load split cache files, trying fallback:", (e as Error).message);
  }
  
  // Strategy 2: Try to load from single cache file (backward compatibility)
  const csvJsonPath = path.join(dataDir, "reverseDeps.csv.json");
  if (existsSync(csvJsonPath)) {
    try {
      const raw = readFileSync(csvJsonPath, "utf-8");
      reverseDepsCache = JSON.parse(raw);
      return reverseDepsCache as ReverseDepsCache;
    } catch (e) {
      console.warn("Failed to load cache file, falling back to regular cache:", (e as Error).message);
    }
  }
  
  // Strategy 3: Load from legacy cache file
  const filePath = path.join(dataDir, "reverseDeps.1000.json");
  if (!existsSync(filePath)) {
    reverseDepsCache = {};
    return reverseDepsCache;
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    reverseDepsCache = JSON.parse(raw);
    return reverseDepsCache as ReverseDepsCache;
  } catch (e) {
    console.warn("Failed to load legacy cache:", (e as Error).message);
    reverseDepsCache = {};
    return reverseDepsCache;
  }
}

/**
 * Async version: Load similar index cache asynchronously
 */
export async function loadSimilarIndexCacheAsync(): Promise<SimilarIndexCache> {
  if (similarIndexCache) return similarIndexCache;
  const projectRoot = getProjectRoot();
  const filePath = path.join(projectRoot, "data", "similarIndex.1000.json");
  if (!existsSync(filePath)) {
    similarIndexCache = {};
    return similarIndexCache;
  }
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    similarIndexCache = JSON.parse(raw);
    return similarIndexCache as SimilarIndexCache;
  } catch (e) {
    console.warn("Failed to load similar index cache:", (e as Error).message);
    similarIndexCache = {};
    return similarIndexCache;
  }
}

export function loadSimilarIndexCache(): SimilarIndexCache {
  if (similarIndexCache) return similarIndexCache;
  const projectRoot = getProjectRoot();
  const filePath = path.join(projectRoot, "data", "similarIndex.1000.json");
  if (!existsSync(filePath)) {
    similarIndexCache = {};
    return similarIndexCache;
  }
  const raw = readFileSync(filePath, "utf-8");
  similarIndexCache = JSON.parse(raw);
  return similarIndexCache as SimilarIndexCache;
}

/**
 * Async version: Load popular packages asynchronously
 */
export async function loadPopularPackagesAsync(): Promise<string[]> {
  if (popularPackagesCache) return popularPackagesCache;
  // Small, optional static list to accelerate lookups and avoid a network roundtrip.
  // Expected path: data/popular.json => ["requests", "numpy", ...]
  const projectRoot = getProjectRoot();
  const filePath = path.join(projectRoot, "data", "popular.json");
  if (!existsSync(filePath)) {
    popularPackagesCache = [];
    return popularPackagesCache;
  }
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const list = JSON.parse(raw);
    if (Array.isArray(list)) {
      popularPackagesCache = list.map(function (n) { return String(n); });
    } else {
      popularPackagesCache = [];
    }
  } catch {
    popularPackagesCache = [];
  }
  return popularPackagesCache;
}

export function loadPopularPackages(): string[] {
  if (popularPackagesCache) return popularPackagesCache;
  // Small, optional static list to accelerate lookups and avoid a network roundtrip.
  // Expected path: data/popular.json => ["requests", "numpy", ...]
  const projectRoot = getProjectRoot();
  const filePath = path.join(projectRoot, "data", "popular.json");
  if (!existsSync(filePath)) {
    popularPackagesCache = [];
    return popularPackagesCache;
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const list = JSON.parse(raw);
    if (Array.isArray(list)) {
      popularPackagesCache = list.map(function (n) { return String(n); });
    } else {
      popularPackagesCache = [];
    }
  } catch {
    popularPackagesCache = [];
  }
  return popularPackagesCache;
}


