/* eslint-disable no-console */
import { existsSync, writeFileSync, mkdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { fetchPackageMeta, pickLatestDependencies } from "../lib/pypi";
import { ReverseDepsCache } from "../lib/cache";

// Normalize package name
function normalizePackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]/g, "-").trim();
}

// Get prefix for file splitting (single or two characters)
function getPrefixChar(packageName: string, useTwoChars: boolean = false): string {
  const normalized = normalizePackageName(packageName);
  if (!normalized) return "other";
  const firstChar = normalized[0];
  let prefix = "";
  
  if (/[a-z]/.test(firstChar)) {
    if (useTwoChars && normalized.length > 1) {
      const secondChar = normalized[1];
      if (/[a-z0-9]/.test(secondChar)) {
        prefix = firstChar + secondChar;
      } else {
        prefix = firstChar; // Fall back to single char if second is invalid
      }
    } else {
      prefix = firstChar;
    }
  } else if (/[0-9]/.test(firstChar)) {
    if (useTwoChars && normalized.length > 1) {
      const secondChar = normalized[1];
      if (/[0-9]/.test(secondChar)) {
        prefix = "0-9-" + firstChar + secondChar;
      } else if (/[a-z]/.test(secondChar)) {
        prefix = "0-9-" + firstChar + secondChar;
      } else {
        prefix = "0-9";
      }
    } else {
      prefix = "0-9";
    }
  } else {
    prefix = "other";
  }
  
  return prefix;
}

// Get all prefix characters (single char)
function getAllPrefixChars(): string[] {
  const prefixes: string[] = [];
  for (let i = 97; i <= 122; i += 1) {
    prefixes.push(String.fromCharCode(i));
  }
  prefixes.push("0-9", "other");
  return prefixes;
}

// Get all two-character prefix combinations
function getAllTwoCharPrefixes(): string[] {
  const prefixes: string[] = [];
  // aa-zz
  for (let i = 97; i <= 122; i += 1) {
    for (let j = 97; j <= 122; j += 1) {
      prefixes.push(String.fromCharCode(i) + String.fromCharCode(j));
    }
  }
  // a0-a9, b0-b9, ... z0-z9
  for (let i = 97; i <= 122; i += 1) {
    for (let j = 48; j <= 57; j += 1) {
      prefixes.push(String.fromCharCode(i) + String.fromCharCode(j));
    }
  }
  // 0-9 variants (keep single char format for compatibility)
  for (let i = 48; i <= 57; i += 1) {
    for (let j = 48; j <= 57; j += 1) {
      prefixes.push("0-9-" + String.fromCharCode(i) + String.fromCharCode(j));
    }
  }
  // Single char fallbacks
  for (let i = 97; i <= 122; i += 1) {
    prefixes.push(String.fromCharCode(i));
  }
  prefixes.push("0-9", "other");
  return prefixes;
}

// Split data further if a file exceeds 100MB
function splitLargeFiles(
  splitData: Record<string, ReverseDepsCache>,
  outputDir: string,
  maxSizeMB: number = 100
): void {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  const prefixChars = getAllPrefixChars();
  const filesToResplit: string[] = [];
  
  // Check which files exceed 100MB
  for (const prefix of prefixChars) {
    const splitFilePath = path.join(outputDir, `reverseDeps-${prefix}.json`);
    if (existsSync(splitFilePath)) {
      const stats = statSync(splitFilePath);
      if (stats.size > maxSizeBytes) {
        filesToResplit.push(prefix);
      }
    }
  }
  
  if (filesToResplit.length === 0) {
    return; // No files to resplit
  }
  
  console.log(`\n⚠️  Found ${filesToResplit.length} file(s) exceeding ${maxSizeMB}MB, splitting further...`);
  
  // For each large file, split by two characters
  for (const prefix of filesToResplit) {
    console.log(`  Splitting reverseDeps-${prefix}.json...`);
    const originalData = splitData[prefix];
    if (!originalData) continue;
    
    // Delete original file
    const originalPath = path.join(outputDir, `reverseDeps-${prefix}.json`);
    if (existsSync(originalPath)) {
      const fs = require("fs");
      fs.unlinkSync(originalPath);
    }
    
    // Create two-character split
    const twoCharSplit: Record<string, ReverseDepsCache> = {};
    
    for (const [pkg, deps] of Object.entries(originalData)) {
      const twoCharPrefix = getPrefixChar(pkg, true);
      if (!twoCharSplit[twoCharPrefix]) {
        twoCharSplit[twoCharPrefix] = {};
      }
      twoCharSplit[twoCharPrefix][pkg] = deps;
    }
    
    // Save two-character split files
    for (const [twoCharPrefix, data] of Object.entries(twoCharSplit)) {
      const newFilePath = path.join(outputDir, `reverseDeps-${prefix}-${twoCharPrefix}.json`);
      const jsonContent = JSON.stringify(data);
      writeFileSync(newFilePath, jsonContent, "utf-8");
      
      const stats = statSync(newFilePath);
      const sizeMB = stats.size / 1024 / 1024;
      
      if (stats.size > maxSizeBytes) {
        console.warn(`    ⚠️  reverseDeps-${prefix}-${twoCharPrefix}.json still exceeds ${maxSizeMB}MB (${sizeMB.toFixed(2)} MB)`);
        console.warn(`    Consider splitting by three characters or adjusting strategy.`);
      } else {
        console.log(`    ✓ reverseDeps-${prefix}-${twoCharPrefix}.json: ${sizeMB.toFixed(2)} MB`);
      }
    }
    
    // Remove from original splitData
    delete splitData[prefix];
  }
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

async function main(): Promise<void> {
  try {
    const projectRoot = getProjectRoot();
    const popularPath = path.join(projectRoot, "data", "popular.json");
    
    if (!existsSync(popularPath)) {
      console.error("Error: popular.json not found. Run 'npm run download-all-packages' first.");
      process.exit(1);
    }

    const packages: string[] = JSON.parse(readFileSync(popularPath, "utf-8"));
    
    const CONCURRENCY = Number(process.env.REVERSE_DEPS_CONCURRENCY || 10);
    
    console.log("=".repeat(60));
    console.log("Building Reverse Dependencies from PyPI API");
    console.log("=".repeat(60));
    console.log(`Total packages: ${packages.length.toLocaleString()}`);
    console.log(`Concurrency: ${CONCURRENCY} concurrent requests`);
    console.log(`Estimated time: ~${Math.ceil(packages.length / CONCURRENCY / 20 / 60)} minutes\n`);

    // Build reverse dependency map
    // Structure: { "dependency-package": ["dependent1", "dependent2", ...] }
    const reverseDeps: ReverseDepsCache = {};
    let completed = 0;
    let successCount = 0;
    let errorCount = 0;
    let totalDependencies = 0;

    const startTime = Date.now();
    const limiter = createLimiter(CONCURRENCY);

    // Process all packages
    const allPromises = packages.map(function (pkg) {
      return limiter(function () {
        return fetchPackageMeta(pkg)
          .then(function (meta) {
            if (!meta) {
              completed += 1;
              errorCount += 1;
              return;
            }

            // Extract dependencies
            const deps = pickLatestDependencies(meta);
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
          })
          .catch(function (err) {
            completed += 1;
            errorCount += 1;
            // Silent error handling - just continue
          });
      });
    });

    await Promise.all(allPromises);

    // Save to split files
    const outputDir = path.join(projectRoot, "data");
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

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

    // Save each split file
    console.log("\nSaving split JSON cache files:");
    let totalSize = 0;
    let maxSize = 0;
    let maxSizePrefix = "";

    for (const prefix of prefixChars) {
      const splitFilePath = path.join(outputDir, `reverseDeps-${prefix}.json`);
      const jsonContent = JSON.stringify(splitData[prefix]); // Compact JSON
      writeFileSync(splitFilePath, jsonContent, "utf-8");
      
      const stats = statSync(splitFilePath);
      const sizeMB = stats.size / 1024 / 1024;
      totalSize += stats.size;
      
      if (stats.size > maxSize) {
        maxSize = stats.size;
        maxSizePrefix = prefix;
      }
      
      const packageCount = Object.keys(splitData[prefix]).length;
      const status = sizeMB > 100 ? "⚠️  EXCEEDS 100MB!" : "✓";
      console.log(`  ${status} reverseDeps-${prefix}.json: ${sizeMB.toFixed(2)} MB (${packageCount.toLocaleString()} packages)`);
    }
    
    // Check for files exceeding 100MB and split them further
    splitLargeFiles(splitData, outputDir, 100);
    
    // Recalculate sizes after potential resplitting
    totalSize = 0;
    maxSize = 0;
    maxSizePrefix = "";
    const allFiles: Array<{ path: string; size: number; prefix: string }> = [];
    
    // Check all reverseDeps-*.json files
    const fs = require("fs");
    const files = fs.readdirSync(outputDir);
    for (const file of files) {
      if (file.startsWith("reverseDeps-") && file.endsWith(".json")) {
        const filePath = path.join(outputDir, file);
        const stats = statSync(filePath);
        allFiles.push({ path: file, size: stats.size, prefix: file });
        totalSize += stats.size;
        if (stats.size > maxSize) {
          maxSize = stats.size;
          maxSizePrefix = file;
        }
      }
    }
    
    // Display final file sizes
    if (allFiles.length > prefixChars.length) {
      console.log("\nFinal file sizes (after resplitting):");
      for (const file of allFiles.sort((a, b) => b.size - a.size)) {
        const sizeMB = file.size / 1024 / 1024;
        const status = sizeMB > 100 ? "⚠️  EXCEEDS 100MB!" : "✓";
        console.log(`  ${status} ${file.path}: ${sizeMB.toFixed(2)} MB`);
      }
    }

    const totalSizeMB = totalSize / 1024 / 1024;
    const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const maxSizeMB = maxSize / 1024 / 1024;
    
    console.log("\n" + "=".repeat(60));
    console.log("Build Complete");
    console.log("=".repeat(60));
    console.log(`Total packages processed: ${packages.length.toLocaleString()}`);
    console.log(`Successful: ${successCount.toLocaleString()}`);
    console.log(`Errors: ${errorCount.toLocaleString()}`);
    console.log(`Total dependencies extracted: ${totalDependencies.toLocaleString()}`);
    console.log(`Packages with reverse deps: ${Object.keys(reverseDeps).length.toLocaleString()}`);
    console.log(`Total reverse dependencies: ${Object.values(reverseDeps).reduce((sum, deps) => sum + deps.length, 0).toLocaleString()}`);
    console.log(`Total time: ${totalTime} minutes`);
    console.log(`\nTotal size: ${totalSizeMB.toFixed(2)} MB across ${allFiles.length} file(s)`);
    console.log(`Largest file: ${maxSizePrefix} (${maxSizeMB.toFixed(2)} MB)`);
    
    if (maxSize > 100 * 1024 * 1024) {
      console.warn(`\n⚠️  WARNING: ${maxSizePrefix} still exceeds 100MB (${maxSizeMB.toFixed(2)} MB)!`);
      console.warn(`This file may need further splitting or optimization.`);
    } else {
      console.log(`✓ All files are under 100MB limit`);
    }
    console.log("=".repeat(60));
  } catch (err) {
    console.error("\n✗ Error:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}

