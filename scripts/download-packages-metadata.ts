/* eslint-disable no-console */

// Optimize rate limiting for bulk downloads BEFORE imports
// This ensures the config reads the optimized value when modules load
// For bulk operations, 50ms is safe (vs 150ms default) and ~3x faster
if (!process.env.PYPI_REQUEST_DELAY_MS) {
  process.env.PYPI_REQUEST_DELAY_MS = "50"; // 50ms for bulk downloads
}
if (!process.env.PYPI_FETCH_TIMEOUT_MS) {
  process.env.PYPI_FETCH_TIMEOUT_MS = "10000"; // 10s timeout (vs 30s default)
}

import { existsSync, writeFileSync, mkdirSync, statSync, readFileSync } from "fs";
import path from "path";
import { fetchPackageMeta, pickLatestDependencies } from "../lib/pypi";
import { fetchDownloadStats } from "../lib/pypi-stats";

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

interface PackageMetadataBatch {
  versions: Record<string, string>;
  depsCount: Record<string, number>;
  repositories: Record<string, string | null>;
  downloads: Record<string, { recent: number; mirrors: number; total: number } | null>;
  descriptions: Record<string, string>;
}

async function fetchPackageMetadata(pkg: string): Promise<Partial<PackageMetadataBatch> | null> {
  try {
    // Fetch metadata first (required), downloads can fail
    // Downloads are non-critical and can be slow, so we make them optional
    const metaPromise = fetchPackageMeta(pkg).catch(function () { return null; });
    
    // Start downloads with a timeout (faster fail for slow downloads)
    const DOWNLOAD_TIMEOUT = 5000; // 5 second timeout for downloads
    const downloadsPromise = Promise.race([
      fetchDownloadStats(pkg),
      new Promise<null>(function (resolve) {
        setTimeout(function () { resolve(null); }, DOWNLOAD_TIMEOUT);
      }),
    ]).catch(function () { return null; });
    
    // Wait for metadata (required), downloads can fail/timeout
    const [meta, downloads] = await Promise.all([metaPromise, downloadsPromise]);

    if (!meta) return null;

    const info = meta?.info || {};
    const latestDeps = pickLatestDependencies(meta);
    const version = info.version || null;
    // Truncate description to 150 chars to save space
    const description = (info.summary || "").substring(0, 150);
    const repository = info.project_urls?.Repository || info.project_urls?.Homepage || info.home_page || null;

    return {
      versions: { [pkg]: version || "" },
      depsCount: { [pkg]: latestDeps.length },
      repositories: { [pkg]: repository },
      downloads: { [pkg]: downloads },
      descriptions: { [pkg]: description },
    };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  try {
    // Read optimized settings (already set at top of file)
    const BULK_DOWNLOAD_RATE_LIMIT_MS = Number(process.env.PYPI_REQUEST_DELAY_MS || 50);
    const BULK_DOWNLOAD_TIMEOUT_MS = Number(process.env.PYPI_FETCH_TIMEOUT_MS || 10000);
    
    const projectRoot = getProjectRoot();
    const popularPath = path.join(projectRoot, "data", "popular.json");
    
    if (!existsSync(popularPath)) {
      console.error("Error: popular.json not found. Run 'npm run download-all-packages' first.");
      process.exit(1);
    }

    const packages: string[] = JSON.parse(readFileSync(popularPath, "utf-8"));
    
    // Optimized concurrency: PyPI can handle 20-30 concurrent requests
    // With optimized rate limiting (50ms), we can achieve 40-60 pkg/s
    // Set DOWNLOAD_CONCURRENCY env var to adjust (default: 25, can go up to 50 if needed)
    const CONCURRENCY = Number(process.env.DOWNLOAD_CONCURRENCY || 25);
    // Estimate: With 50ms rate limit = ~20 req/s per domain × 2 domains × concurrency factor
    const estimatedRate = Math.min(CONCURRENCY * 2.5, 60); // Cap at 60 pkg/s realistically
    
    console.log("=".repeat(60));
    console.log("Downloading Package Metadata");
    console.log("=".repeat(60));
    console.log(`Total packages: ${packages.length.toLocaleString()}`);
    console.log(`Concurrency: ${CONCURRENCY} concurrent requests`);
    console.log(`Rate limit: ${BULK_DOWNLOAD_RATE_LIMIT_MS}ms delay (optimized for bulk downloads)`);
    console.log(`Timeout: ${BULK_DOWNLOAD_TIMEOUT_MS / 1000}s per request`);
    console.log(`Estimated time: ~${Math.ceil(packages.length / estimatedRate / 60)} minutes`);
    console.log(`Note: Using optimized settings for bulk downloads\n`);

    const metadata: PackageMetadataBatch = {
      versions: {},
      depsCount: {},
      repositories: {},
      downloads: {},
      descriptions: {},
    };

    const limiter = createLimiter(CONCURRENCY);
    let completed = 0;
    let successCount = 0;
    let errorCount = 0;
    
    // Error tracking for diagnostics
    const errorTypes: Record<string, number> = {};
    const recentErrors: Array<{ pkg: string; error: string }> = [];

    const startTime = Date.now();

    // Process with optimized queue-based approach
    // Save progress periodically
    const SAVE_INTERVAL = 500; // Save every 500 completed packages
    let lastSaved = 0;
    
    // Process all packages with queue
    const allPromises: Promise<void>[] = [];
    for (let i = 0; i < packages.length; i += 1) {
      const pkg = packages[i];
      const promise = limiter(function () {
        return fetchPackageMetadata(pkg);
      })
        .then(function (result) {
          if (result) {
            Object.assign(metadata.versions, result.versions);
            Object.assign(metadata.depsCount, result.depsCount);
            Object.assign(metadata.repositories, result.repositories);
            Object.assign(metadata.downloads, result.downloads);
            Object.assign(metadata.descriptions, result.descriptions);
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
            console.log(`  Success: ${successCount.toLocaleString()}, Errors: ${errorCount.toLocaleString()}`);
            if (rate > 0) {
              console.log(`  Rate: ${rate.toFixed(2)} pkg/s, ETA: ${Math.ceil(eta / 60)} minutes`);
            }
            
            // Show error breakdown if we have errors
            if (errorCount > 0 && Object.keys(errorTypes).length > 0) {
              const errorSummary = Object.entries(errorTypes)
                .map(function ([type, count]) { return `${type}: ${count}`; })
                .join(", ");
              console.log(`  Error breakdown: ${errorSummary}`);
            }
            console.log();
          }
          
          // Save progress periodically
          if (completed - lastSaved >= SAVE_INTERVAL) {
            const outputDir = path.join(projectRoot, "data");
            if (!existsSync(outputDir)) {
              mkdirSync(outputDir, { recursive: true });
            }
            
            writeFileSync(
              path.join(outputDir, "packages-versions.json"),
              JSON.stringify(metadata.versions),
              "utf-8"
            );
            writeFileSync(
              path.join(outputDir, "packages-deps-count.json"),
              JSON.stringify(metadata.depsCount),
              "utf-8"
            );
            writeFileSync(
              path.join(outputDir, "packages-repositories.json"),
              JSON.stringify(metadata.repositories),
              "utf-8"
            );
            writeFileSync(
              path.join(outputDir, "packages-downloads.json"),
              JSON.stringify(metadata.downloads),
              "utf-8"
            );
            writeFileSync(
              path.join(outputDir, "packages-descriptions.json"),
              JSON.stringify(metadata.descriptions),
              "utf-8"
            );
            lastSaved = completed;
          }
        })
        .catch(function (err) {
          errorCount += 1;
          completed += 1;
          
          // Track error types for diagnostics
          const errorMsg = String(err);
          let errorType = "unknown";
          if (errorMsg.includes("timeout") || errorMsg.includes("TIMEOUT")) {
            errorType = "timeout";
          } else if (errorMsg.includes("429") || errorMsg.includes("rate limit")) {
            errorType = "rate_limit";
          } else if (errorMsg.includes("404") || errorMsg.includes("not found")) {
            errorType = "not_found";
          } else if (errorMsg.includes("network") || errorMsg.includes("ECONNREFUSED") || errorMsg.includes("ETIMEDOUT")) {
            errorType = "network";
          } else if (errorMsg.includes("500") || errorMsg.includes("502") || errorMsg.includes("503")) {
            errorType = "server_error";
          }
          
          errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
          
          // Keep last 10 errors for diagnostics
          if (recentErrors.length < 10) {
            recentErrors.push({ pkg, error: errorMsg.substring(0, 100) });
          }
        });
      
      allPromises.push(promise);
    }
    
    // Wait for all to complete
    await Promise.all(allPromises);

    // Final save and statistics
    const outputDir = path.join(projectRoot, "data");
    const files = [
      { name: "packages-versions.json", data: metadata.versions },
      { name: "packages-deps-count.json", data: metadata.depsCount },
      { name: "packages-repositories.json", data: metadata.repositories },
      { name: "packages-downloads.json", data: metadata.downloads },
      { name: "packages-descriptions.json", data: metadata.descriptions },
    ];

    console.log("=".repeat(60));
    console.log("Final Statistics");
    console.log("=".repeat(60));
    console.log(`Total packages processed: ${completed.toLocaleString()}`);
    console.log(`Successful: ${successCount.toLocaleString()}`);
    console.log(`Errors: ${errorCount.toLocaleString()}`);
    console.log(`Total time: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes`);
    
    // Error analysis
    if (errorCount > 0) {
      console.log(`\nError Analysis:`);
      const sortedErrors = Object.entries(errorTypes).sort(function (a, b) { return b[1] - a[1]; });
      for (const [type, count] of sortedErrors) {
        const percentage = ((count / errorCount) * 100).toFixed(1);
        console.log(`  ${type}: ${count} (${percentage}%)`);
      }
      
      if (recentErrors.length > 0) {
        console.log(`\nRecent errors (sample):`);
        for (const err of recentErrors.slice(0, 5)) {
          console.log(`  ${err.pkg}: ${err.error}`);
        }
      }
    }
    console.log();

    console.log("File Sizes:");
    let totalSize = 0;
    for (const file of files) {
      writeFileSync(
        path.join(outputDir, file.name),
        JSON.stringify(file.data),
        "utf-8"
      );
      const stats = statSync(path.join(outputDir, file.name));
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      const sizeKB = (stats.size / 1024).toFixed(2);
      totalSize += stats.size;
      
      if (stats.size > 100 * 1024 * 1024) {
        console.log(`  ⚠️  ${file.name}: ${sizeMB} MB (EXCEEDS 100MB!)`);
      } else if (stats.size > 1024 * 1024) {
        console.log(`  ✓ ${file.name}: ${sizeMB} MB`);
      } else {
        console.log(`  ✓ ${file.name}: ${sizeKB} KB`);
      }
    }

    const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);
    console.log(`\nTotal size: ${totalSizeMB} MB`);
    console.log("\n" + "=".repeat(60));
    console.log("Done!");
    console.log("=".repeat(60));
  } catch (err) {
    console.error("\n✗ Error:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}

