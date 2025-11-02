/* eslint-disable no-console */
import { writeFileSync, readFileSync, existsSync } from "fs";
import path from "path";
import { fetchReverseDependentsApprox } from "../lib/pypi";
import { loadPopularPackages } from "../lib/cache";
import { loadReverseDepsFromCSVCached } from "../lib/libraries-io-csv";

// Normalize package name (PyPI package names are case-insensitive and normalized)
function normalizePackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]/g, "-").toLowerCase();
}

async function main(): Promise<void> {
  const limit = Number(process.env.TOP || 1000);
  const useCSV = process.env.USE_CSV !== "false"; // Default to true, set USE_CSV=false to disable
  
  console.log(`Building reverseDeps for top ${limit} packages...`);
  
  // Strategy 1: Parse CSV and build cache (preferred - no API key needed)
  if (useCSV) {
    try {
      console.log("Attempting to build from Libraries.io CSV dump...");
      const csvCache = await loadReverseDepsFromCSVCached();
      
      if (Object.keys(csvCache).length > 0) {
        console.log(`✓ Loaded ${Object.keys(csvCache).length} dependencies from CSV`);
        
        // If we only want popular packages, filter the CSV cache
        const popular = loadPopularPackages();
        let filteredCache: Record<string, string[]> = {};
        
        if (popular.length > 0) {
          console.log(`Filtering to ${popular.length} popular packages...`);
          const popularSet = new Set(popular.map(function (p) { return normalizePackageName(p); }));
          
          for (const [dep, dependents] of Object.entries(csvCache)) {
            // Include if the dependency itself is popular
            if (popularSet.has(normalizePackageName(dep))) {
              filteredCache[dep] = dependents;
            }
            // Also include if any dependent is popular (to get reverse deps of popular packages)
            const hasPopularDependent = dependents.some(function (d) {
              return popularSet.has(normalizePackageName(d));
            });
            if (hasPopularDependent) {
              filteredCache[dep] = dependents;
            }
          }
        } else {
          filteredCache = csvCache;
        }
        
        const filePath = path.join(process.cwd(), "data", "reverseDeps.1000.json");
        writeFileSync(filePath, JSON.stringify(filteredCache, null, 2));
        console.log(`✓ Wrote ${filePath}`);
        console.log(`  Processed ${Object.keys(filteredCache).length} dependencies from CSV`);
        return;
      }
    } catch (e) {
      console.warn("CSV approach failed, falling back to API:", (e as Error).message);
    }
  }
  
  // Strategy 2: Use API/CSV hybrid approach (via fetchReverseDependentsApprox)
  console.log("Using API/CSV hybrid approach...");
  
  // Use popular packages list or fall back to manual list
  let names: string[] = [];
  const popular = loadPopularPackages();
  if (popular.length > 0) {
    names = popular.slice(0, limit);
    console.log(`Using ${names.length} packages from popular.json`);
  } else {
    // Fallback: use a manual list of top packages if popular.json doesn't exist
    console.warn("popular.json not found, using hardcoded top packages");
    names = [
      "requests", "numpy", "pandas", "django", "flask", "fastapi", "matplotlib",
      "pytest", "scipy", "setuptools", "pip", "wheel", "six", "python-dateutil",
      "pytz", "certifi", "urllib3", "idna", "charset-normalizer", "pillow",
    ].slice(0, limit);
  }
  
  const out: Record<string, string[]> = {};
  let i = 0;
  const concurrency = 3; // Lower concurrency for PyPI rate limits
  const batchSize = concurrency;
  
  for (let j = 0; j < names.length; j += batchSize) {
    const batch = names.slice(j, j + batchSize);
    const batchPromises = batch.map(async function (n) {
      try {
        const deps = await fetchReverseDependentsApprox(n);
        const normalized = normalizePackageName(n);
        out[normalized] = deps;
        out[n] = deps; // Also store with original name for backward compatibility
        i += 1;
        if (i % 50 === 0) {
          console.log(`Processed ${i}/${names.length}`);
        }
        return { name: n, success: true, count: deps.length };
      } catch (e) {
        console.warn(`Failed ${n}:`, (e as Error).message);
        return { name: n, success: false, count: 0 };
      }
    });
    
    await Promise.all(batchPromises);
    
    // Small delay between batches to be nice to PyPI
    if (j + batchSize < names.length) {
      await new Promise(function (r) { setTimeout(r, 200); });
    }
  }
  
  const filePath = path.join(process.cwd(), "data", "reverseDeps.1000.json");
  writeFileSync(filePath, JSON.stringify(out, null, 2));
  console.log(`Wrote ${filePath}`);
  console.log(`Successfully processed ${Object.keys(out).length} packages`);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});

