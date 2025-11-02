/* eslint-disable no-console */
/**
 * Weekly Data Update Script
 * 
 * This script automatically updates all PyPI data:
 * 1. Gets all valid PyPI packages
 * 2. Downloads metadata for all packages
 * 3. Builds reverse dependencies
 * 
 * Features:
 * - Atomic updates: Writes to temp files first, then swaps them
 * - Lock file: Prevents concurrent runs
 * - Progress tracking: Detailed logging and progress updates
 * - Error recovery: Continues on errors, reports at end
 * - Application-safe: Doesn't disturb running application
 */

import { existsSync, writeFileSync, mkdirSync, readFileSync, statSync, unlinkSync, renameSync } from "fs";
import path from "path";
import { PYPI_API_CONFIG } from "../lib/config";
import { fetchPackageMeta, pickLatestDependencies } from "../lib/pypi";
import { fetchDownloadStats } from "../lib/pypi-stats";
import { ReverseDepsCache } from "../lib/cache";

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

// Normalize package name
function normalizePackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]/g, "-").trim();
}

// Get prefix for file splitting
function getPrefixChar(packageName: string): string {
  const normalized = normalizePackageName(packageName);
  if (!normalized) return "other";
  const firstChar = normalized[0];
  if (/[a-z]/.test(firstChar)) {
    return firstChar;
  } else if (/[0-9]/.test(firstChar)) {
    return "0-9";
  }
  return "other";
}

// Get all prefix characters
function getAllPrefixChars(): string[] {
  const prefixes: string[] = [];
  for (let i = 97; i <= 122; i += 1) {
    prefixes.push(String.fromCharCode(i));
  }
  prefixes.push("0-9", "other");
  return prefixes;
}

// Lock file management
const LOCK_FILE = path.join(getProjectRoot(), "data", ".weekly-update.lock");

function acquireLock(): boolean {
  if (existsSync(LOCK_FILE)) {
    try {
      const lockData = JSON.parse(readFileSync(LOCK_FILE, "utf-8"));
      const lockTime = lockData.timestamp || 0;
      const elapsed = Date.now() - lockTime;
      const LOCK_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
      
      if (elapsed > LOCK_TIMEOUT_MS) {
        console.log("⚠️  Found stale lock file (older than 24h), removing...");
        unlinkSync(LOCK_FILE);
      } else {
        console.error("✗ Another update is already running (lock file exists)");
        console.error(`   Lock file created: ${new Date(lockTime).toISOString()}`);
        console.error("   If previous run crashed, delete the lock file manually");
        return false;
      }
    } catch {
      // Lock file corrupted, remove it
      unlinkSync(LOCK_FILE);
    }
  }
  
  try {
    writeFileSync(LOCK_FILE, JSON.stringify({ 
      timestamp: Date.now(),
      pid: process.pid,
      startTime: new Date().toISOString()
    }), "utf-8");
    return true;
  } catch (err) {
    console.error("✗ Failed to create lock file:", (err as Error).message);
    return false;
  }
}

function releaseLock(): void {
  try {
    if (existsSync(LOCK_FILE)) {
      unlinkSync(LOCK_FILE);
    }
  } catch {
    // Ignore errors
  }
}

// Atomic file write: Write to temp file, then rename
function atomicWriteFile(filePath: string, data: string): void {
  const tempPath = filePath + ".tmp";
  writeFileSync(tempPath, data, "utf-8");
  renameSync(tempPath, filePath);
}

// Atomic JSON write: Write to temp file, then rename
function atomicWriteJSON(filePath: string, data: any): void {
  atomicWriteFile(filePath, JSON.stringify(data, null, 2));
}

// Rate limiting helper
const lastRequestTime = new Map<string, number>();
async function rateLimit(domain: string): Promise<void> {
  const last = lastRequestTime.get(domain) || 0;
  const now = Date.now();
  const elapsed = now - last;
  if (elapsed < PYPI_API_CONFIG.REQUEST_DELAY_MS) {
    await new Promise(function (resolve) { 
      setTimeout(resolve, PYPI_API_CONFIG.REQUEST_DELAY_MS - elapsed); 
    });
  }
  lastRequestTime.set(domain, Date.now());
}

// Fetch with retry and timeout
async function fetchWithRetry(url: string, retries: number = PYPI_API_CONFIG.MAX_RETRY_ATTEMPTS): Promise<Response> {
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < retries) {
    attempt += 1;
    try {
      const domain = new URL(url).hostname;
      await rateLimit(domain);

      const controller = new AbortController();
      const timeoutId = setTimeout(function () { 
        controller.abort(); 
      }, PYPI_API_CONFIG.FETCH_TIMEOUT_MS);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          const delay = Math.min(
            PYPI_API_CONFIG.RETRY_INITIAL_DELAY_MS * (2 ** (attempt - 1)),
            PYPI_API_CONFIG.RETRY_MAX_DELAY_MS
          ) + Math.floor(Math.random() * PYPI_API_CONFIG.RETRY_JITTER_MS);
          await new Promise(function (r) { setTimeout(r, delay); });
          continue;
        }
        throw new Error(`HTTP ${res.status} for ${url}`);
      }

      return res;
    } catch (err) {
      lastError = err as Error;
      if (attempt >= retries) {
        throw lastError;
      }
      const delay = Math.min(
        PYPI_API_CONFIG.RETRY_INITIAL_DELAY_MS * (2 ** (attempt - 1)),
        PYPI_API_CONFIG.RETRY_MAX_DELAY_MS
      ) + Math.floor(Math.random() * PYPI_API_CONFIG.RETRY_JITTER_MS);
      await new Promise(function (r) { setTimeout(r, delay); });
    }
  }

  throw lastError || new Error("Max retry attempts reached");
}

// Concurrency limiter
function createLimiter(concurrency: number) {
  let running = 0;
  const queue: Array<() => void> = [];
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise(function (resolve, reject) {
      function run() {
        running += 1;
        fn()
          .then(function (v) {
            running -= 1;
            resolve(v);
            if (queue.length > 0) {
              const next = queue.shift();
              if (next) next();
            }
          })
          .catch(function (e) {
            running -= 1;
            reject(e);
            if (queue.length > 0) {
              const next = queue.shift();
              if (next) next();
            }
          });
      }
      if (running < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

// Step 1: Get all valid PyPI packages
async function step1_GetValidPackages(): Promise<string[]> {
  console.log("\n" + "=".repeat(80));
  console.log("STEP 1: Getting All Valid PyPI Packages");
  console.log("=".repeat(80));
  
  const packages = new Set<string>();
  
  console.log("Fetching all PyPI package names from Simple API...");
  
  try {
    const simpleApiUrl = "https://pypi.org/simple/";
    console.log(`Fetching: ${simpleApiUrl}`);
    const response = await fetchWithRetry(simpleApiUrl);
    const html = await response.text();
    
    const packageRegex = /href="\/simple\/([^\/"]+)\/"/g;
    let match;
    let count = 0;

    while ((match = packageRegex.exec(html)) !== null) {
      const packageName = match[1];
      const decoded = packageName
        .replace(/&#45;/g, "-")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&");
      
      packages.add(decoded);
      count += 1;
      
      if (count % 10000 === 0) {
        console.log(`  Parsed ${count.toLocaleString()} package links...`);
      }
    }

    console.log(`✓ Found ${packages.size.toLocaleString()} unique packages`);
    
    const packageArray = Array.from(packages).sort();
    return packageArray;
  } catch (err) {
    console.error("✗ Error fetching packages:", err);
    throw err;
  }
}

// Step 2: Validate packages and get metadata
interface PackageMetadataBatch {
  versions: Record<string, string | null>;
  depsCount: Record<string, number>;
  repositories: Record<string, string | null>;
  downloads: Record<string, { recent: number; mirrors: number; total: number } | null>;
  descriptions: Record<string, string>;
}

async function step2_DownloadMetadata(packages: string[]): Promise<{ validPackages: string[]; metadata: PackageMetadataBatch; packagesDeps: Record<string, string[]> }> {
  console.log("\n" + "=".repeat(80));
  console.log("STEP 2: Validating Packages and Downloading Metadata");
  console.log("=".repeat(80));
  console.log(`Total packages: ${packages.length.toLocaleString()}`);
  
  const CONCURRENCY = Number(process.env.DOWNLOAD_CONCURRENCY || 25);
  console.log(`Concurrency: ${CONCURRENCY} concurrent requests`);
  console.log(`Estimated time: ~${Math.ceil(packages.length / 60 / 60)} hours\n`);

  const metadata: PackageMetadataBatch = {
    versions: {},
    depsCount: {},
    repositories: {},
    downloads: {},
    descriptions: {},
  };

  const validPackages: string[] = [];
  const packagesDeps: Record<string, string[]> = {}; // Store dependencies for reuse in step 3
  const limiter = createLimiter(CONCURRENCY);
  let completed = 0;
  let successCount = 0;
  let errorCount = 0;
  
  const startTime = Date.now();
  const SAVE_INTERVAL = 500;
  let lastSaved = 0;
  const projectRoot = getProjectRoot();
  const outputDir = path.join(projectRoot, "data");

  // Process all packages
  const allPromises: Promise<void>[] = [];
  for (let i = 0; i < packages.length; i += 1) {
    const pkg = packages[i];
    const promise = limiter(function () {
      return fetchPackageMeta(pkg).catch(function () { return null; });
    })
      .then(function (meta) {
        if (meta) {
          const info = meta?.info || {};
          const latestDeps = pickLatestDependencies(meta);
          const version = info.version || null;
          const description = (info.summary || "").substring(0, 150);
          const repository = info.project_urls?.Repository || info.project_urls?.Homepage || info.home_page || null;
          
          // Store metadata
          metadata.versions[pkg] = version || "";
          metadata.depsCount[pkg] = latestDeps.length;
          metadata.repositories[pkg] = repository;
          metadata.descriptions[pkg] = description;
          
          // Store dependencies for step 3 (reuse data, avoid re-fetching)
          packagesDeps[pkg] = latestDeps;
          
          // Fetch downloads separately (non-blocking, don't wait)
          fetchDownloadStats(pkg).catch(function () { return null; })
            .then(function (downloads) {
              metadata.downloads[pkg] = downloads;
            })
            .catch(function () {
              // Ignore download fetch errors
            });
          
          validPackages.push(pkg);
          successCount += 1;
        } else {
          errorCount += 1;
        }
        completed += 1;
        
        // Progress logging every 100 packages
        if (completed % 100 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000);
          const rate = elapsed > 0 ? (completed / elapsed) : 0;
          const remaining = packages.length - completed;
          const eta = rate > 0 ? remaining / rate : 0;
          
          console.log(`Progress: ${completed.toLocaleString()}/${packages.length.toLocaleString()} (${((completed / packages.length) * 100).toFixed(1)}%)`);
          console.log(`  Valid: ${successCount.toLocaleString()}, Errors: ${errorCount.toLocaleString()}`);
          if (rate > 0) {
            console.log(`  Rate: ${rate.toFixed(2)} pkg/s, ETA: ${Math.ceil(eta / 60)} minutes`);
          }
          console.log();
        }
        
        // Periodic save (to temp files)
        if (completed - lastSaved >= SAVE_INTERVAL) {
          if (!existsSync(outputDir)) {
            mkdirSync(outputDir, { recursive: true });
          }
          
          // Save to temp files
          const tempPrefix = ".temp-";
          atomicWriteJSON(path.join(outputDir, tempPrefix + "packages-versions.json"), metadata.versions);
          atomicWriteJSON(path.join(outputDir, tempPrefix + "packages-deps-count.json"), metadata.depsCount);
          atomicWriteJSON(path.join(outputDir, tempPrefix + "packages-repositories.json"), metadata.repositories);
          atomicWriteJSON(path.join(outputDir, tempPrefix + "packages-downloads.json"), metadata.downloads);
          atomicWriteJSON(path.join(outputDir, tempPrefix + "packages-descriptions.json"), metadata.descriptions);
          atomicWriteJSON(path.join(outputDir, tempPrefix + "popular.json"), validPackages);
          lastSaved = completed;
        }
      })
      .catch(function () {
        errorCount += 1;
        completed += 1;
      });
    
    allPromises.push(promise);
  }

  await Promise.all(allPromises);

  // Final save of metadata files
  const projectRoot2 = getProjectRoot();
  const outputDir2 = path.join(projectRoot2, "data");
  if (!existsSync(outputDir2)) {
    mkdirSync(outputDir2, { recursive: true });
  }
  
  const tempPrefix = ".temp-";
  atomicWriteJSON(path.join(outputDir2, tempPrefix + "packages-versions.json"), metadata.versions);
  atomicWriteJSON(path.join(outputDir2, tempPrefix + "packages-deps-count.json"), metadata.depsCount);
  atomicWriteJSON(path.join(outputDir2, tempPrefix + "packages-repositories.json"), metadata.repositories);
  atomicWriteJSON(path.join(outputDir2, tempPrefix + "packages-downloads.json"), metadata.downloads);
  atomicWriteJSON(path.join(outputDir2, tempPrefix + "packages-descriptions.json"), metadata.descriptions);
  atomicWriteJSON(path.join(outputDir2, tempPrefix + "popular.json"), validPackages.sort());

  console.log("\n✓ Metadata download complete");
  console.log(`  Valid packages: ${validPackages.length.toLocaleString()}`);
  console.log(`  Errors: ${errorCount.toLocaleString()}`);

  return { validPackages, metadata, packagesDeps };
}

// Step 3: Build reverse dependencies (reuse dependencies from step 2)
async function step3_BuildReverseDeps(packages: string[], packagesDeps: Record<string, string[]>): Promise<void> {
  console.log("\n" + "=".repeat(80));
  console.log("STEP 3: Building Reverse Dependencies");
  console.log("=".repeat(80));
  console.log(`Total packages: ${packages.length.toLocaleString()}`);
  
  const CONCURRENCY = Number(process.env.REVERSE_DEPS_CONCURRENCY || 10);
  console.log(`Concurrency: ${CONCURRENCY} concurrent requests`);
  console.log(`Estimated time: ~${Math.ceil(packages.length / CONCURRENCY / 20 / 60)} hours\n`);

  // Build reverse dependency map by iterating through packages and their dependencies
  // Structure: { "dependency-package": ["dependent1", "dependent2", ...] }
  const reverseDeps: ReverseDepsCache = {};
  const limiter = createLimiter(CONCURRENCY);
  let completed = 0;
  let successCount = 0;
  let errorCount = 0;
  let totalDependencies = 0;
  
  const startTime = Date.now();
  const SAVE_INTERVAL = 1000;
  let lastSaved = 0;
  const projectRoot = getProjectRoot();
  const outputDir = path.join(projectRoot, "data");

  // Process all packages: use dependencies from step 2 to build reverse map
  const allPromises = packages.map(function (pkg) {
    return limiter(function () {
      return Promise.resolve(packagesDeps[pkg] || [])
        .then(function (deps) {
          if (deps.length === 0 && !packagesDeps[pkg]) {
            // Package not found in step 2, skip it
            completed += 1;
            errorCount += 1;
            return;
          }

          // Use dependencies from step 2 (already fetched)
          totalDependencies += deps.length;

          // For each dependency, add this package as a reverse dependency
          for (const dep of deps) {
            const normalizedDep = normalizePackageName(dep);
            if (normalizedDep && normalizedDep !== "") {
              if (!reverseDeps[normalizedDep]) {
                reverseDeps[normalizedDep] = [];
              }
              const normalizedPkg = normalizePackageName(pkg);
              if (!reverseDeps[normalizedDep].includes(normalizedPkg)) {
                reverseDeps[normalizedDep].push(normalizedPkg);
              }
            }
          }

          completed += 1;
          successCount += 1;

          // Progress logging every 1000 packages
          if (completed % 1000 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000);
            const rate = elapsed > 0 ? (completed / elapsed) : 0;
            const remaining = packages.length - completed;
            const eta = rate > 0 ? remaining / rate : 0;
            
            console.log(`Progress: ${completed.toLocaleString()}/${packages.length.toLocaleString()} (${((completed / packages.length) * 100).toFixed(1)}%)`);
            console.log(`  Success: ${successCount.toLocaleString()}, Errors: ${errorCount.toLocaleString()}`);
            console.log(`  Packages with reverse deps: ${Object.keys(reverseDeps).length.toLocaleString()}`);
            if (rate > 0) {
              console.log(`  Rate: ${rate.toFixed(2)} pkg/s, ETA: ${Math.ceil(eta / 60)} minutes`);
            }
            console.log();
          }
          
          // Periodic save (to temp split files)
          if (completed - lastSaved >= SAVE_INTERVAL) {
            if (!existsSync(outputDir)) {
              mkdirSync(outputDir, { recursive: true });
            }
            
            // Split reverse deps by prefix and save to temp files
            const tempPrefix = ".temp-";
            const prefixChars = getAllPrefixChars();
            const splitData: Record<string, ReverseDepsCache> = {};
            for (const prefix of prefixChars) {
              splitData[prefix] = {};
            }
            
            // Group by prefix
            for (const [dep, dependents] of Object.entries(reverseDeps)) {
              const prefix = getPrefixChar(dep);
              splitData[prefix][dep] = dependents;
            }
            
            // Save split files
            for (const [prefix, data] of Object.entries(splitData)) {
              atomicWriteJSON(path.join(outputDir, tempPrefix + `reverseDeps-${prefix}.json`), data);
            }
            lastSaved = completed;
          }
        })
        .catch(function () {
          completed += 1;
          errorCount += 1;
        });
    });
  });

  await Promise.all(allPromises);

  // Final save of reverse dependencies
  const projectRoot2 = getProjectRoot();
  const outputDir2 = path.join(projectRoot2, "data");
  const tempPrefix = ".temp-";
  const prefixChars = getAllPrefixChars();
  const splitData: Record<string, ReverseDepsCache> = {};
  
  // Initialize all prefix buckets
  for (const prefix of prefixChars) {
    splitData[prefix] = {};
  }
  
  // Group by prefix
  for (const [dep, dependents] of Object.entries(reverseDeps)) {
    const prefix = getPrefixChar(dep);
    splitData[prefix][dep] = dependents;
  }
  
  // Save split files to temp
  console.log("\nSaving reverse dependencies to temp files...");
  for (const [prefix, data] of Object.entries(splitData)) {
    atomicWriteJSON(path.join(outputDir2, tempPrefix + `reverseDeps-${prefix}.json`), data);
  }

  console.log("\n✓ Reverse dependencies build complete");
  console.log(`  Success: ${successCount.toLocaleString()}`);
  console.log(`  Errors: ${errorCount.toLocaleString()}`);
  console.log(`  Packages with reverse deps: ${Object.keys(reverseDeps).length.toLocaleString()}`);
  console.log(`  Total reverse dependencies: ${Object.values(reverseDeps).reduce(function (sum, deps) { return sum + deps.length; }, 0).toLocaleString()}`);
}

// Step 4: Atomically swap temp files to production
async function step4_AtomicSwap(): Promise<void> {
  console.log("\n" + "=".repeat(80));
  console.log("STEP 4: Atomically Swapping New Data");
  console.log("=".repeat(80));
  
  const projectRoot = getProjectRoot();
  const dataDir = path.join(projectRoot, "data");
  const tempPrefix = ".temp-";
  
  // List of files to swap
  const filesToSwap = [
    "popular.json",
    "packages-versions.json",
    "packages-deps-count.json",
    "packages-repositories.json",
    "packages-downloads.json",
    "packages-descriptions.json",
  ];
  
  // Add reverse deps files
  const prefixChars = getAllPrefixChars();
  for (const prefix of prefixChars) {
    filesToSwap.push(`reverseDeps-${prefix}.json`);
  }
  
  console.log(`Swapping ${filesToSwap.length} files...`);
  
  let swappedCount = 0;
  let skippedCount = 0;
  
  for (const fileName of filesToSwap) {
    const tempPath = path.join(dataDir, tempPrefix + fileName);
    const prodPath = path.join(dataDir, fileName);
    
    if (existsSync(tempPath)) {
      try {
        // Use rename for atomic operation (works on same filesystem)
        // This ensures the swap is instant - no partial files visible to the application
        if (existsSync(prodPath)) {
          // Backup old file (in case of rollback needed)
          const backupPath = prodPath + ".backup";
          try {
            if (existsSync(backupPath)) {
              unlinkSync(backupPath); // Remove old backup
            }
            renameSync(prodPath, backupPath);
          } catch {
            // If backup fails, continue anyway (atomic swap still works)
          }
        }
        
        // Atomic swap: temp to production (instant rename)
        renameSync(tempPath, prodPath);
        swappedCount += 1;
        console.log(`  ✓ ${fileName}`);
      } catch (err) {
        console.error(`  ✗ Failed to swap ${fileName}:`, (err as Error).message);
      }
    } else {
      skippedCount += 1;
      console.log(`  ⚠️  ${fileName} (temp file not found, skipping)`);
    }
  }
  
  // Clean up old backup files (keep only recent ones)
  console.log("\nCleaning up old backup files...");
  const backupFiles = filesToSwap.map(function (f) { return path.join(dataDir, f + ".backup"); });
  for (const backupPath of backupFiles) {
    if (existsSync(backupPath)) {
      try {
        // Keep backups for 7 days, then remove
        const stats = statSync(backupPath);
        const age = Date.now() - stats.mtime.getTime();
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        
        if (age > sevenDays) {
          unlinkSync(backupPath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }
  
  console.log(`\n✓ Successfully swapped ${swappedCount} files`);
  if (skippedCount > 0) {
    console.log(`⚠️  Skipped ${skippedCount} files (temp files not found)`);
  }
  console.log("✓ New data is now live");
  console.log("✓ Application will use new data immediately (cache will auto-refresh)");
}

async function main(): Promise<void> {
  const startTime = Date.now();
  
  console.log("=".repeat(80));
  console.log("WEEKLY PYPI DATA UPDATE");
  console.log("=".repeat(80));
  console.log(`Started: ${new Date().toISOString()}`);
  console.log();
  
  // Acquire lock
  if (!acquireLock()) {
    process.exit(1);
  }
  
  try {
    const projectRoot = getProjectRoot();
    const dataDir = path.join(projectRoot, "data");
    
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    
    // Step 1: Get all valid packages
    const allPackages = await step1_GetValidPackages();
    
    // Step 2: Validate and download metadata (saves popular.json to .temp-popular.json)
    const { validPackages, metadata, packagesDeps } = await step2_DownloadMetadata(allPackages);
    
    // Step 3: Build reverse dependencies (reuse dependencies from step 2)
    await step3_BuildReverseDeps(validPackages, packagesDeps);
    
    // Step 4: Atomically swap all files
    await step4_AtomicSwap();
    
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log("\n" + "=".repeat(80));
    console.log("WEEKLY UPDATE COMPLETE");
    console.log("=".repeat(80));
    console.log(`Total time: ${elapsed} minutes`);
    console.log(`Valid packages: ${validPackages.length.toLocaleString()}`);
    console.log(`Completed: ${new Date().toISOString()}`);
    console.log("=".repeat(80));
    
  } catch (err) {
    console.error("\n" + "=".repeat(80));
    console.error("WEEKLY UPDATE FAILED");
    console.error("=".repeat(80));
    console.error("Error:", err);
    console.error("=".repeat(80));
    process.exit(1);
  } finally {
    releaseLock();
  }
}

// Run the script
if (require.main === module) {
  void main();
}
