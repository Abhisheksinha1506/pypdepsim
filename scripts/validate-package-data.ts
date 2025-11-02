/* eslint-disable no-console */
import { existsSync, readFileSync } from "fs";
import path from "path";

// Load .env.local manually (since scripts don't auto-load it like Next.js)
function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const equalIndex = trimmed.indexOf("=");
        if (equalIndex > 0) {
          const key = trimmed.substring(0, equalIndex).trim();
          const value = trimmed.substring(equalIndex + 1).trim().replace(/^["']|["']$/g, "");
          if (key && value) {
            process.env[key] = value;
          }
        }
      }
    }
  }
}

// Load env before importing config
loadEnvLocal();

// Now import modules (which will read from process.env)
import { fetchPackageMeta, pickLatestDependencies } from "../lib/pypi";
import { loadReverseDepsCache } from "../lib/cache";

// Normalize package name
function normalizePackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]/g, "-").trim();
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

// Fetch package info from Libraries.io API
async function fetchLibrariesIOInfo(pkg: string): Promise<{
  dependents_count: number | null;
  description: string | null;
  homepage: string | null;
} | null> {
  const apiKey = process.env.LIBRARIES_IO_API_KEY;
  if (!apiKey) return null;
  
  try {
    const url = `https://libraries.io/api/pypi/${encodeURIComponent(pkg.toLowerCase())}?api_key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    
    const data = await response.json() as {
      dependents_count?: number;
      description?: string;
      homepage?: string;
    };
    
    return {
      dependents_count: data.dependents_count ?? null,
      description: data.description ?? null,
      homepage: data.homepage ?? null,
    };
  } catch {
    return null;
  }
}

// Fetch reverse dependencies from Libraries.io API (may be disabled)
async function fetchLibrariesIOReverseDeps(pkg: string): Promise<string[] | null> {
  const apiKey = process.env.LIBRARIES_IO_API_KEY;
  if (!apiKey) return null;
  
  try {
    const url = `https://libraries.io/api/pypi/${encodeURIComponent(pkg.toLowerCase())}/dependents?api_key=${apiKey}&per_page=250`;
    const response = await fetch(url);
    if (!response.ok) return null;
    
    const data = await response.json();
    if (Array.isArray(data)) {
      return data.map(function (item: any) { return item.name; }).filter(Boolean);
    }
    return null;
  } catch {
    return null;
  }
}

// Compare dependencies
function compareDependencies(ours: string[], theirs: string[]): {
  match: boolean;
  oursOnly: string[];
  theirsOnly: string[];
  matchCount: number;
} {
  const oursSet = new Set(ours.map(function (d) { return normalizePackageName(d); }));
  const theirsSet = new Set(theirs.map(function (d) { return normalizePackageName(d); }));
  
  const oursOnly = ours.filter(function (d) {
    return !theirsSet.has(normalizePackageName(d));
  });
  const theirsOnly = theirs.filter(function (d) {
    return !oursSet.has(normalizePackageName(d));
  });
  
  const matchCount = Array.from(oursSet).filter(function (d) {
    return theirsSet.has(d);
  }).length;
  
  const match = oursOnly.length === 0 && theirsOnly.length === 0 && ours.length === theirs.length;
  
  return { match, oursOnly, theirsOnly, matchCount };
}

// Compare reverse dependencies
function compareReverseDeps(ours: string[], theirs: string[] | null, count: number | null): {
  match: boolean;
  ourCount: number;
  theirCount: number | null;
  sampleMismatches: string[];
} {
  const ourCount = ours.length;
  const theirCount = theirs ? theirs.length : count;
  
  let match = false;
  let sampleMismatches: string[] = [];
  
  if (theirs) {
    // Compare actual lists
    const oursSet = new Set(ours.map(function (d) { return normalizePackageName(d); }));
    const theirsSet = new Set(theirs.map(function (d) { return normalizePackageName(d); }));
    
    const ourOnly = ours.filter(function (d) {
      return !theirsSet.has(normalizePackageName(d));
    });
    const theirOnly = theirs.filter(function (d) {
      return !oursSet.has(normalizePackageName(d));
    });
    
    match = ourOnly.length === 0 && theirOnly.length === 0 && ourCount === theirCount;
    sampleMismatches = [...ourOnly.slice(0, 10), ...theirOnly.slice(0, 10)];
  } else if (count !== null) {
    // Only compare counts
    match = Math.abs(ourCount - count) <= Math.max(1, count * 0.05); // Allow 5% difference
  }
  
  return { match, ourCount, theirCount, sampleMismatches };
}

async function validatePackage(pkg: string): Promise<void> {
  console.log("\n" + "=".repeat(80));
  console.log(`Validating: ${pkg}`);
  console.log("=".repeat(80));
  
  // 1. Get our metadata
  console.log("\n1. Fetching our metadata...");
  let ourMeta: any = null;
  let ourDeps: string[] = [];
  try {
    ourMeta = await fetchPackageMeta(pkg);
    if (ourMeta) {
      ourDeps = pickLatestDependencies(ourMeta);
      console.log(`   ✓ Package: ${ourMeta.info?.name || pkg}`);
      console.log(`   ✓ Version: ${ourMeta.info?.version || "N/A"}`);
      console.log(`   ✓ Dependencies: ${ourDeps.length}`);
      if (ourDeps.length > 0) {
        console.log(`   ✓ Sample deps: ${ourDeps.slice(0, 5).join(", ")}${ourDeps.length > 5 ? "..." : ""}`);
      }
    } else {
      console.log(`   ✗ Failed to fetch metadata`);
    }
  } catch (err) {
    console.log(`   ✗ Error: ${(err as Error).message}`);
  }
  
  // 2. Get our reverse dependencies
  console.log("\n2. Fetching our reverse dependencies...");
  let ourReverseDeps: string[] = [];
  try {
    const cache = loadReverseDepsCache();
    const normalized = normalizePackageName(pkg);
    ourReverseDeps = cache[normalized] || cache[pkg.toLowerCase()] || [];
    console.log(`   ✓ Reverse dependencies: ${ourReverseDeps.length}`);
    if (ourReverseDeps.length > 0) {
      console.log(`   ✓ Sample reverse deps: ${ourReverseDeps.slice(0, 5).join(", ")}${ourReverseDeps.length > 5 ? "..." : ""}`);
    } else {
      console.log(`   ⚠️  No reverse dependencies found in cache`);
    }
  } catch (err) {
    console.log(`   ✗ Error: ${(err as Error).message}`);
  }
  
  // 3. Get Libraries.io info
  console.log("\n3. Fetching Libraries.io data...");
  const libIOInfo = await fetchLibrariesIOInfo(pkg);
  if (libIOInfo) {
    console.log(`   ✓ Dependents count: ${libIOInfo.dependents_count?.toLocaleString() || "N/A"}`);
    if (libIOInfo.description) {
      console.log(`   ✓ Description: ${libIOInfo.description.substring(0, 100)}${libIOInfo.description.length > 100 ? "..." : ""}`);
    }
  } else {
    console.log(`   ⚠️  Libraries.io API not available or package not found`);
  }
  
  // 4. Get Libraries.io reverse dependencies (may be disabled)
  console.log("\n4. Fetching Libraries.io reverse dependencies...");
  const libIOReverseDeps = await fetchLibrariesIOReverseDeps(pkg);
  if (libIOReverseDeps) {
    console.log(`   ✓ Reverse dependencies: ${libIOReverseDeps.length}`);
    if (libIOReverseDeps.length > 0) {
      console.log(`   ✓ Sample reverse deps: ${libIOReverseDeps.slice(0, 5).join(", ")}${libIOReverseDeps.length > 5 ? "..." : ""}`);
    }
  } else {
    console.log(`   ⚠️  Libraries.io /dependents endpoint disabled or unavailable`);
  }
  
  // 5. Compare dependencies
  console.log("\n5. Comparing dependencies...");
  if (ourMeta && ourMeta.info?.requires_dist) {
    const pyPIDeps = (ourMeta.info.requires_dist as string[]).filter(function (d: string) {
      return typeof d === "string";
    });
    const depComparison = compareDependencies(ourDeps, pyPIDeps);
    
    if (depComparison.match) {
      console.log(`   ✓ Dependencies match perfectly (${depComparison.matchCount} dependencies)`);
    } else {
      console.log(`   ⚠️  Dependencies differ:`);
      console.log(`      Matches: ${depComparison.matchCount}`);
      if (depComparison.oursOnly.length > 0) {
        console.log(`      Only in our extraction: ${depComparison.oursOnly.slice(0, 5).join(", ")}${depComparison.oursOnly.length > 5 ? ` (+${depComparison.oursOnly.length - 5} more)` : ""}`);
      }
      if (depComparison.theirsOnly.length > 0) {
        console.log(`      Only in PyPI raw: ${depComparison.theirsOnly.slice(0, 5).join(", ")}${depComparison.theirsOnly.length > 5 ? ` (+${depComparison.theirsOnly.length - 5} more)` : ""}`);
      }
    }
  } else {
    console.log(`   ⚠️  Cannot compare - no PyPI metadata available`);
  }
  
  // 6. Compare reverse dependencies
  console.log("\n6. Comparing reverse dependencies...");
  const revDepComparison = compareReverseDeps(
    ourReverseDeps,
    libIOReverseDeps,
    libIOInfo?.dependents_count ?? null
  );
  
  if (revDepComparison.match) {
    console.log(`   ✓ Reverse dependencies match!`);
    console.log(`      Our count: ${revDepComparison.ourCount}`);
    if (revDepComparison.theirCount !== null) {
      console.log(`      Their count: ${revDepComparison.theirCount}`);
    }
  } else {
    console.log(`   ⚠️  Reverse dependencies differ:`);
    console.log(`      Our count: ${revDepComparison.ourCount}`);
    if (revDepComparison.theirCount !== null) {
      console.log(`      Their count: ${revDepComparison.theirCount}`);
      const diff = Math.abs(revDepComparison.ourCount - revDepComparison.theirCount);
      const diffPercent = revDepComparison.theirCount > 0
        ? ((diff / revDepComparison.theirCount) * 100).toFixed(1)
        : "N/A";
      console.log(`      Difference: ${diff} (${diffPercent}%)`);
    }
    if (revDepComparison.sampleMismatches.length > 0) {
      console.log(`      Sample mismatches: ${revDepComparison.sampleMismatches.slice(0, 5).join(", ")}${revDepComparison.sampleMismatches.length > 5 ? "..." : ""}`);
    }
  }
  
  // 7. Summary
  console.log("\n7. Summary:");
  const issues: string[] = [];
  
  if (!ourMeta) {
    issues.push("Missing metadata");
  }
  if (ourDeps.length === 0 && ourMeta?.info?.requires_dist) {
    issues.push("No dependencies extracted (but PyPI has some)");
  }
  if (ourReverseDeps.length === 0 && (libIOInfo?.dependents_count ?? 0) > 0) {
    issues.push(`No reverse deps in cache (but Libraries.io shows ${libIOInfo.dependents_count})`);
  }
  if (libIOInfo && ourReverseDeps.length > 0) {
    const countDiff = Math.abs(ourReverseDeps.length - (libIOInfo.dependents_count ?? 0));
    if (countDiff > (libIOInfo.dependents_count ?? 0) * 0.1) {
      issues.push(`Reverse deps count differs significantly (>10%)`);
    }
  }
  
  if (issues.length === 0) {
    console.log(`   ✓ All checks passed`);
  } else {
    console.log(`   ⚠️  Issues found:`);
    for (const issue of issues) {
      console.log(`      - ${issue}`);
    }
  }
  
  // 8. Links for manual verification
  console.log("\n8. Manual verification links:");
  console.log(`   PyPI: https://pypi.org/project/${encodeURIComponent(pkg)}/`);
  console.log(`   Libraries.io: https://libraries.io/pypi/${encodeURIComponent(pkg.toLowerCase())}`);
  if (ourReverseDeps.length > 0) {
    console.log(`   Our reverse deps: ${ourReverseDeps.length} packages`);
  }
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
    
    if (packages.length === 0) {
      console.error("Error: No packages found in popular.json");
      process.exit(1);
    }
    
    // Pick 5 random packages
    const randomPackages: string[] = [];
    const indices = new Set<number>();
    while (randomPackages.length < 5 && indices.size < packages.length) {
      const idx = Math.floor(Math.random() * packages.length);
      if (!indices.has(idx)) {
        indices.add(idx);
        randomPackages.push(packages[idx]);
      }
    }
    
    console.log("=".repeat(80));
    console.log("Package Data Validation");
    console.log("=".repeat(80));
    console.log(`Total packages available: ${packages.length.toLocaleString()}`);
    console.log(`Random packages selected: ${randomPackages.join(", ")}`);
    console.log("\nNote: This will validate metadata and reverse dependencies against");
    console.log("      third-party sources (PyPI, Libraries.io)");
    
    // Validate each package
    for (const pkg of randomPackages) {
      await validatePackage(pkg);
      // Add delay between packages to avoid rate limiting
      if (randomPackages.indexOf(pkg) < randomPackages.length - 1) {
        await new Promise(function (resolve) { setTimeout(resolve, 2000); });
      }
    }
    
    console.log("\n" + "=".repeat(80));
    console.log("Validation Complete");
    console.log("=".repeat(80));
    console.log("\nIf you see any issues, check:");
    console.log("1. Reverse dependencies cache was built: npm run build-reverse-deps");
    console.log("2. Metadata was downloaded: npm run download-packages-metadata");
    console.log("3. API keys are configured: LIBRARIES_IO_API_KEY in .env.local");
  } catch (err) {
    console.error("\n✗ Error:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}

