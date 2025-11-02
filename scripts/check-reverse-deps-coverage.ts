/* eslint-disable no-console */
import { existsSync, readFileSync } from "fs";
import path from "path";
import { loadReverseDepsCache } from "../lib/cache";

// Normalize package name (same logic as cache.ts)
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

interface CoverageStats {
  totalPackages: number;
  packagesWithReverseDeps: number;
  packagesWithoutReverseDeps: number;
  totalReverseDeps: number;
  packagesByReverseDepCount: Array<{ name: string; count: number }>;
  missingPackages: string[];
}

async function main(): Promise<void> {
  try {
    const projectRoot = getProjectRoot();
    const popularPath = path.join(projectRoot, "data", "popular.json");
    
    if (!existsSync(popularPath)) {
      console.error("Error: popular.json not found. Run 'npm run download-all-packages' first.");
      process.exit(1);
    }

    console.log("=".repeat(60));
    console.log("Reverse Dependencies Coverage Check");
    console.log("=".repeat(60));
    console.log("Loading packages from popular.json...");
    
    const packages: string[] = JSON.parse(readFileSync(popularPath, "utf-8"));
    console.log(`Loaded ${packages.length.toLocaleString()} packages\n`);

    console.log("Loading reverse dependencies cache...");
    const reverseDepsCache = loadReverseDepsCache();
    const cacheKeys = Object.keys(reverseDepsCache);
    console.log(`Cache contains ${cacheKeys.length.toLocaleString()} packages with reverse dependencies\n`);

    if (cacheKeys.length === 0) {
      console.log("=".repeat(60));
      console.log("⚠️  No Reverse Dependencies Found");
      console.log("=".repeat(60));
      console.log("The reverse dependencies cache is empty.");
      console.log("\nTo generate reverse dependencies:");
      console.log("1. Download Libraries.io CSV: npm run download-csv");
      console.log("2. The CSV parser will automatically generate cache files");
      console.log("   (reverseDeps-*.json files will be created)");
      console.log("=".repeat(60));
      return;
    }

    console.log("Checking coverage...");
    const stats: CoverageStats = {
      totalPackages: packages.length,
      packagesWithReverseDeps: 0,
      packagesWithoutReverseDeps: 0,
      totalReverseDeps: 0,
      packagesByReverseDepCount: [],
      missingPackages: [],
    };

    // Check each package
    for (const pkg of packages) {
      const normalized = normalizePackageName(pkg);
      const cached = reverseDepsCache[normalized] || reverseDepsCache[pkg.toLowerCase()];
      
      if (Array.isArray(cached) && cached.length > 0) {
        stats.packagesWithReverseDeps += 1;
        stats.totalReverseDeps += cached.length;
        stats.packagesByReverseDepCount.push({
          name: pkg,
          count: cached.length,
        });
      } else {
        stats.packagesWithoutReverseDeps += 1;
        stats.missingPackages.push(pkg);
      }
    }

    // Sort by reverse dependency count (descending)
    stats.packagesByReverseDepCount.sort(function (a, b) {
      return b.count - a.count;
    });

    // Calculate percentages
    const coveragePercent = ((stats.packagesWithReverseDeps / stats.totalPackages) * 100).toFixed(2);
    const missingPercent = ((stats.packagesWithoutReverseDeps / stats.totalPackages) * 100).toFixed(2);

    // Calculate average reverse deps
    const avgReverseDeps = stats.packagesWithReverseDeps > 0
      ? (stats.totalReverseDeps / stats.packagesWithReverseDeps).toFixed(2)
      : "0";

    // Display results
    console.log("\n" + "=".repeat(60));
    console.log("Coverage Statistics");
    console.log("=".repeat(60));
    console.log(`Total packages checked: ${stats.totalPackages.toLocaleString()}`);
    console.log(`Packages with reverse deps: ${stats.packagesWithReverseDeps.toLocaleString()} (${coveragePercent}%)`);
    console.log(`Packages without reverse deps: ${stats.packagesWithoutReverseDeps.toLocaleString()} (${missingPercent}%)`);
    console.log(`Total reverse dependencies: ${stats.totalReverseDeps.toLocaleString()}`);
    console.log(`Average reverse deps per package: ${avgReverseDeps}`);

    // Top packages by reverse dependency count
    if (stats.packagesByReverseDepCount.length > 0) {
      console.log("\n" + "=".repeat(60));
      console.log("Top 20 Packages by Reverse Dependency Count");
      console.log("=".repeat(60));
      const top20 = stats.packagesByReverseDepCount.slice(0, 20);
      for (let i = 0; i < top20.length; i += 1) {
        const item = top20[i];
        console.log(`${(i + 1).toString().padStart(2)}. ${item.name.padEnd(40)} ${item.count.toLocaleString().padStart(8)} dependents`);
      }
    }

    // Distribution of reverse dependency counts
    if (stats.packagesByReverseDepCount.length > 0) {
      const distribution = {
        "0": 0,
        "1-10": 0,
        "11-50": 0,
        "51-100": 0,
        "101-500": 0,
        "501-1000": 0,
        "1001-5000": 0,
        "5000+": 0,
      };

      for (const item of stats.packagesByReverseDepCount) {
        if (item.count === 0) {
          distribution["0"] += 1;
        } else if (item.count <= 10) {
          distribution["1-10"] += 1;
        } else if (item.count <= 50) {
          distribution["11-50"] += 1;
        } else if (item.count <= 100) {
          distribution["51-100"] += 1;
        } else if (item.count <= 500) {
          distribution["101-500"] += 1;
        } else if (item.count <= 1000) {
          distribution["501-1000"] += 1;
        } else if (item.count <= 5000) {
          distribution["1001-5000"] += 1;
        } else {
          distribution["5000+"] += 1;
        }
      }

      // Count packages without reverse deps (they're in missingPackages)
      distribution["0"] = stats.packagesWithoutReverseDeps;

      console.log("\n" + "=".repeat(60));
      console.log("Distribution of Reverse Dependency Counts");
      console.log("=".repeat(60));
      for (const [range, count] of Object.entries(distribution)) {
        if (count > 0) {
          const percent = ((count / stats.totalPackages) * 100).toFixed(1);
          console.log(`${range.padEnd(10)}: ${count.toLocaleString().padStart(8)} packages (${percent}%)`);
        }
      }
    }

    // Sample of packages missing reverse dependencies
    if (stats.missingPackages.length > 0) {
      console.log("\n" + "=".repeat(60));
      console.log("Sample of Packages Without Reverse Dependencies");
      console.log("=".repeat(60));
      const sample = stats.missingPackages.slice(0, 20);
      for (let i = 0; i < sample.length; i += 1) {
        console.log(`${(i + 1).toString().padStart(2)}. ${sample[i]}`);
      }
      if (stats.missingPackages.length > 20) {
        console.log(`\n... and ${(stats.missingPackages.length - 20).toLocaleString()} more`);
      }
    }

    // Summary and recommendations
    console.log("\n" + "=".repeat(60));
    console.log("Summary");
    console.log("=".repeat(60));
    if (coveragePercent === "100.00") {
      console.log("✓ Perfect coverage! All packages have reverse dependencies.");
    } else if (parseFloat(coveragePercent) >= 90) {
      console.log(`✓ Good coverage (${coveragePercent}%). Most packages have reverse dependencies.`);
    } else if (parseFloat(coveragePercent) >= 50) {
      console.log(`⚠️  Partial coverage (${coveragePercent}%). Consider updating the Libraries.io CSV.`);
    } else {
      console.log(`⚠️  Low coverage (${coveragePercent}%). Reverse dependencies may need to be generated.`);
      console.log("\nTo improve coverage:");
      console.log("1. Run: npm run download-csv");
      console.log("2. The CSV parser will generate reverse dependency cache files");
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

