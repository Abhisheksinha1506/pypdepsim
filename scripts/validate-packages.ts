/* eslint-disable no-console */
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import path from "path";
import { fetchPackageMeta } from "../lib/pypi";

// Optimize rate limiting for bulk validation
if (!process.env.PYPI_REQUEST_DELAY_MS) {
  process.env.PYPI_REQUEST_DELAY_MS = "50";
}
if (!process.env.PYPI_FETCH_TIMEOUT_MS) {
  process.env.PYPI_FETCH_TIMEOUT_MS = "5000"; // 5s timeout for quick checks
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

async function checkPackageExists(pkg: string): Promise<boolean> {
  try {
    const meta = await fetchPackageMeta(pkg).catch(function () { return null; });
    return meta !== null && meta !== undefined;
  } catch {
    return false;
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
    
    const CONCURRENCY = Number(process.env.VALIDATE_CONCURRENCY || 30);
    
    console.log("=".repeat(60));
    console.log("Validating Packages Against PyPI");
    console.log("=".repeat(60));
    console.log(`Total packages: ${packages.length.toLocaleString()}`);
    console.log(`Concurrency: ${CONCURRENCY} concurrent checks`);
    console.log(`Estimated time: ~${Math.ceil(packages.length / CONCURRENCY / 20 / 60)} minutes\n`);

    const validPackages: string[] = [];
    const invalidPackages: string[] = [];
    let completed = 0;
    let validCount = 0;
    let invalidCount = 0;

    const startTime = Date.now();
    const limiter = createLimiter(CONCURRENCY);

    // Check all packages
    const allPromises = packages.map(function (pkg) {
      return limiter(function () {
        return checkPackageExists(pkg);
      })
        .then(function (exists) {
          completed += 1;
          if (exists) {
            validPackages.push(pkg);
            validCount += 1;
          } else {
            invalidPackages.push(pkg);
            invalidCount += 1;
          }

          // Progress logging every 500 packages
          if (completed % 500 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000);
            const rate = elapsed > 0 ? (completed / elapsed) : 0;
            const remaining = packages.length - completed;
            const eta = rate > 0 ? remaining / rate : 0;
            
            console.log(`Progress: ${completed.toLocaleString()}/${packages.length.toLocaleString()} (${((completed / packages.length) * 100).toFixed(1)}%)`);
            console.log(`  Valid: ${validCount.toLocaleString()}, Invalid: ${invalidCount.toLocaleString()}`);
            if (rate > 0) {
              console.log(`  Rate: ${rate.toFixed(2)} pkg/s, ETA: ${Math.ceil(eta / 60)} minutes`);
            }
            console.log();
          }
        })
        .catch(function () {
          // On error, assume invalid
          completed += 1;
          invalidPackages.push(pkg);
          invalidCount += 1;
        });
    });

    await Promise.all(allPromises);

    // Save results
    const outputDir = path.join(projectRoot, "data");
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // Save valid packages (overwrite popular.json with validated list)
    const validPath = path.join(outputDir, "popular.json");
    writeFileSync(validPath, JSON.stringify(validPackages.sort(), null, 2), "utf-8");
    console.log(`✓ Saved ${validCount.toLocaleString()} valid packages to: ${validPath}`);

    // Save invalid packages for review
    if (invalidPackages.length > 0) {
      const invalidPath = path.join(outputDir, "popular-invalid.json");
      writeFileSync(invalidPath, JSON.stringify(invalidPackages.sort(), null, 2), "utf-8");
      console.log(`✓ Saved ${invalidCount.toLocaleString()} invalid packages to: ${invalidPath}`);
    }

    const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    
    console.log("\n" + "=".repeat(60));
    console.log("Validation Complete");
    console.log("=".repeat(60));
    console.log(`Total packages checked: ${packages.length.toLocaleString()}`);
    console.log(`Valid: ${validCount.toLocaleString()} (${((validCount / packages.length) * 100).toFixed(1)}%)`);
    console.log(`Invalid: ${invalidCount.toLocaleString()} (${((invalidCount / packages.length) * 100).toFixed(1)}%)`);
    console.log(`Total time: ${totalTime} minutes`);
    console.log("\n" + "=".repeat(60));
    console.log("Next Steps:");
    console.log("1. Review invalid packages in: data/popular-invalid.json");
    console.log("2. The validated list is saved in: data/popular.json");
    console.log("3. Run 'npm run download-packages-metadata' with the cleaned list");
    console.log("=".repeat(60));
  } catch (err) {
    console.error("\n✗ Error:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}

