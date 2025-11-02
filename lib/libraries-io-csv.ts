/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, statSync } from "fs";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import path from "path";
import { ReverseDepsCache } from "./cache";

// Normalize package name (case-insensitive, handle separators)
function normalizePackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]/g, "-").trim();
}

// Helper to get project root
function getProjectRoot(): string {
  const cwd = process.cwd();
  const dataPath = path.join(cwd, "data", "libraries-io");
  if (existsSync(dataPath)) return cwd;
  try {
    const parentPath = path.resolve(cwd, "..", "data", "libraries-io");
    if (existsSync(parentPath)) return path.resolve(cwd, "..");
  } catch {
    // Continue
  }
  return cwd;
}

// Find CSV file in data/libraries-io directory
function findCSVFile(): string | null {
  const projectRoot = getProjectRoot();
  const dataDir = path.join(projectRoot, "data", "libraries-io");
  
  if (!existsSync(dataDir)) {
    return null;
  }
  
  // Look for CSV files (prefer non-compressed, but accept .gz)
  const candidates = [
    path.join(dataDir, "repository-dependencies.csv"),
    path.join(dataDir, "repository-dependencies-*.csv"),
  ];
  
  // Try to find any CSV file in the directory
  try {
    const fs = require("fs");
    const files = fs.readdirSync(dataDir);
    const csvFiles = files.filter(function (f: string) {
      return f.endsWith(".csv") && !f.endsWith(".csv.gz");
    });
    
    if (csvFiles.length > 0) {
      // Prefer repository-dependencies, but use any CSV found
      const preferred = csvFiles.find(function (f: string) {
        return f.includes("repository-dependencies");
      });
      return path.join(dataDir, preferred || csvFiles[0]);
    }
  } catch {
    // Directory read failed
  }
  
  return null;
}

// Track if we've warned about CSV file not found (only warn once per process)
let csvWarned = false;

/**
 * Parse Libraries.io CSV and build reverse dependency mapping
 * CSV format: repository_dependencies.csv typically has columns like:
 * - Repository ID, Repository Name, Repository Platform, Dependency Name, Dependency Platform, ...
 * 
 * We need to filter for Platform='Pypi' and build: { "dependency-name": ["repository1", "repository2", ...] }
 */
export async function loadReverseDepsFromCSV(): Promise<ReverseDepsCache> {
  const csvPath = findCSVFile();
  
  if (!csvPath) {
    // Only warn once per process - CSV is optional (we use API key for counts)
    if (!csvWarned) {
      console.warn("Libraries.io CSV file not found. Using API key for reverse dependency counts.");
      csvWarned = true;
    }
    return {};
  }
  
  console.log(`Parsing CSV file: ${csvPath}`);
  const stats = statSync(csvPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`File size: ${sizeMB} MB`);
  
  const reverseDeps: ReverseDepsCache = {};
  const fileStream = createReadStream(csvPath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  
  let lineNumber = 0;
  let header: string[] = [];
  let repoNameIdx = -1;
  let repoPlatformIdx = -1;
  let depNameIdx = -1;
  let depPlatformIdx = -1;
  
  // Map to track seen entries (avoid duplicates)
  const seenEntries = new Set<string>();
  
  for await (const line of rl) {
    lineNumber += 1;
    
    // Parse CSV line (simple CSV parsing - handles quoted fields)
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    fields.push(current.trim()); // Last field
    
    if (lineNumber === 1) {
      // Header row
      header = fields;
      repoNameIdx = header.findIndex(function (h) {
        return h.toLowerCase().includes("repository") && h.toLowerCase().includes("name");
      });
      repoPlatformIdx = header.findIndex(function (h) {
        return h.toLowerCase().includes("repository") && h.toLowerCase().includes("platform");
      });
      depNameIdx = header.findIndex(function (h) {
        return h.toLowerCase().includes("dependency") && h.toLowerCase().includes("name");
      });
      depPlatformIdx = header.findIndex(function (h) {
        return h.toLowerCase().includes("dependency") && h.toLowerCase().includes("platform");
      });
      
      // Alternative column names
      if (repoNameIdx === -1) {
        repoNameIdx = header.findIndex(function (h) {
          return h.toLowerCase() === "repository_name" || h.toLowerCase() === "name";
        });
      }
      if (repoPlatformIdx === -1) {
        repoPlatformIdx = header.findIndex(function (h) {
          return h.toLowerCase() === "platform" || h.toLowerCase() === "repository_platform";
        });
      }
      if (depNameIdx === -1) {
        depNameIdx = header.findIndex(function (h) {
          return h.toLowerCase() === "dependency_name" || h.toLowerCase() === "dependency";
        });
      }
      if (depPlatformIdx === -1) {
        depPlatformIdx = header.findIndex(function (h) {
          return h.toLowerCase() === "dependency_platform";
        });
      }
      
      if (repoNameIdx === -1 || depNameIdx === -1) {
        console.warn("Could not find required columns in CSV. Available columns:", header);
        continue;
      }
      
      console.log(`Found columns: repo_name=${repoNameIdx}, repo_platform=${repoPlatformIdx}, dep_name=${depNameIdx}, dep_platform=${depPlatformIdx}`);
      continue;
    }
    
    // Data row
    if (fields.length < header.length) {
      continue; // Skip incomplete rows
    }
    
    const repoName = fields[repoNameIdx]?.trim();
    const repoPlatform = repoPlatformIdx >= 0 ? fields[repoPlatformIdx]?.trim().toLowerCase() : "";
    const depName = fields[depNameIdx]?.trim();
    const depPlatform = depPlatformIdx >= 0 ? fields[depPlatformIdx]?.trim().toLowerCase() : "";
    
    // Filter for PyPI packages only
    if (!depName || depName === "") continue;
    
    // Check platform (either dependency platform or repository platform should be PyPI)
    const isPypi = depPlatform === "pypi" || repoPlatform === "pypi" || depPlatform === "pypi" || repoPlatform.includes("pypi");
    
    if (!isPypi && depPlatform !== "" && repoPlatform !== "") {
      continue; // Skip non-PyPI entries
    }
    
    // Normalize dependency name
    const normalizedDep = normalizePackageName(depName);
    
    if (!normalizedDep) continue;
    
    // Create unique key to avoid duplicates
    const entryKey = `${normalizedDep}::${repoName}`;
    if (seenEntries.has(entryKey)) {
      continue; // Skip duplicates
    }
    seenEntries.add(entryKey);
    
    // Add repository as dependent of the dependency
    if (repoName && normalizedDep) {
      if (!reverseDeps[normalizedDep]) {
        reverseDeps[normalizedDep] = [];
      }
      
      // Normalize repository name (for PyPI packages, repo name should be package name)
      const normalizedRepo = normalizePackageName(repoName);
      if (normalizedRepo && !reverseDeps[normalizedDep].includes(normalizedRepo)) {
        reverseDeps[normalizedDep].push(normalizedRepo);
      }
    }
    
    // Progress logging
    if (lineNumber % 100000 === 0) {
      const processedMB = ((csvPath.length * 0.5) * (lineNumber / 1000000)).toFixed(2);
      console.log(`  Processed ${lineNumber.toLocaleString()} lines (~${processedMB} MB), found ${Object.keys(reverseDeps).length} dependencies with reverse deps`);
    }
  }
  
  console.log(`\n✓ Parsing complete!`);
  console.log(`  Total lines processed: ${lineNumber.toLocaleString()}`);
  console.log(`  Dependencies with reverse deps: ${Object.keys(reverseDeps).length.toLocaleString()}`);
  
  // Log sample statistics
  const sampleDeps = Object.keys(reverseDeps).slice(0, 5);
  for (const dep of sampleDeps) {
    console.log(`  ${dep}: ${reverseDeps[dep].length} dependents`);
  }
  
  return reverseDeps;
}

/**
 * Get the prefix character for splitting files (first character of normalized package name)
 */
function getPrefixChar(packageName: string): string {
  const normalized = normalizePackageName(packageName);
  if (!normalized) return "other";
  const firstChar = normalized[0];
  // Group by first character: a-z, 0-9, and "other" for special characters
  if (/[a-z]/.test(firstChar)) return firstChar;
  if (/[0-9]/.test(firstChar)) return "0-9";
  return "other";
}

/**
 * Get all possible prefix characters (for file detection)
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
 * Load reverse dependencies from CSV, with caching to split JSON files
 * Files are split by first character of package name to keep each file under 100MB
 */
export async function loadReverseDepsFromCSVCached(): Promise<ReverseDepsCache> {
  const projectRoot = getProjectRoot();
  const csvPath = findCSVFile();
  const dataDir = path.join(projectRoot, "data");
  
  // Check if split JSON cache files exist and are newer than CSV
  const prefixChars = getAllPrefixChars();
  let allFilesExist = true;
  let newestFileTime = 0;
  
  if (csvPath && existsSync(dataDir)) {
    const csvStats = statSync(csvPath);
    newestFileTime = csvStats.mtime.getTime();
    
    for (const prefix of prefixChars) {
      const splitFilePath = path.join(dataDir, `reverseDeps-${prefix}.json`);
      if (existsSync(splitFilePath)) {
        const splitStats = statSync(splitFilePath);
        if (splitStats.mtime.getTime() > newestFileTime) {
          newestFileTime = splitStats.mtime.getTime();
        }
      } else {
        allFilesExist = false;
        break;
      }
    }
    
    // If all split files exist and are newer than CSV, load from cache
    if (allFilesExist && csvPath) {
      const csvStats = statSync(csvPath);
      if (newestFileTime >= csvStats.mtime.getTime()) {
        console.log(`Loading reverse dependencies from split JSON cache files`);
        const combined: ReverseDepsCache = {};
        let totalPackages = 0;
        
        for (const prefix of prefixChars) {
          const splitFilePath = path.join(dataDir, `reverseDeps-${prefix}.json`);
          try {
            const splitData = JSON.parse(readFileSync(splitFilePath, "utf-8"));
            Object.assign(combined, splitData);
            totalPackages += Object.keys(splitData).length;
          } catch (e) {
            console.warn(`Failed to load ${splitFilePath}:`, (e as Error).message);
          }
        }
        
        console.log(`  Loaded ${totalPackages.toLocaleString()} dependencies from ${prefixChars.length} files`);
        return combined;
      }
    }
  }
  
  // Parse CSV and build cache
  const reverseDeps = await loadReverseDepsFromCSV();
  
  // Split and save to multiple JSON files (by first character)
  if (Object.keys(reverseDeps).length > 0) {
    const { writeFileSync } = require("fs");
    
    // Group by prefix
    const splitData: Record<string, ReverseDepsCache> = {};
    for (const prefix of prefixChars) {
      splitData[prefix] = {};
    }
    
    for (const [pkg, deps] of Object.entries(reverseDeps)) {
      const prefix = getPrefixChar(pkg);
      splitData[prefix][pkg] = deps;
    }
    
    // Save each split file and check sizes
    let totalSize = 0;
    let maxSize = 0;
    let maxSizePrefix = "";
    
    console.log("\nSaving split JSON cache files:");
    for (const prefix of prefixChars) {
      const splitFilePath = path.join(dataDir, `reverseDeps-${prefix}.json`);
      const jsonContent = JSON.stringify(splitData[prefix]); // Compact JSON (no indentation)
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
    
    const totalSizeMB = totalSize / 1024 / 1024;
    console.log(`\nTotal size: ${totalSizeMB.toFixed(2)} MB across ${prefixChars.length} files`);
    console.log(`Largest file: reverseDeps-${maxSizePrefix}.json (${(maxSize / 1024 / 1024).toFixed(2)} MB)`);
    
    if (maxSize > 100 * 1024 * 1024) {
      console.warn(`\n⚠️  WARNING: reverseDeps-${maxSizePrefix}.json exceeds 100MB!`);
      console.warn(`Consider splitting by first two characters instead.`);
    }
  }
  
  return reverseDeps;
}

