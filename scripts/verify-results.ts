/* eslint-disable no-console */
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fetchPackageMeta, pickLatestDependencies } from "../lib/pypi";
import { computeSimilarOnDemand, computeCooccurrence } from "../lib/similar";

type TestResult = {
  pkg: string;
  similarCount: number;
  cooccurCount: number;
  similar: Array<{ name: string; jaccard: number }>;
  cooccur: Array<{ name: string; jaccard: number }>;
};

// Helper to get project root
function getProjectRoot(): string {
  const cwd = process.cwd();
  const dataPath = path.join(cwd, "data", "popular.json");
  if (existsSync(dataPath)) return cwd;
  try {
    const parentPath = path.resolve(cwd, "..", "data", "popular.json");
    if (existsSync(parentPath)) return path.resolve(cwd, "..");
  } catch {
    // Continue
  }
  return cwd;
}

async function verifyPackage(pkg: string): Promise<void> {
  console.log(`\n=== Verifying ${pkg} ===`);
  
  // 1. Get package metadata from PyPI
  let pypiMeta: any = null;
  let pypiDeps: string[] = [];
  try {
    console.log(`  Fetching metadata from PyPI...`);
    pypiMeta = await fetchPackageMeta(pkg);
    pypiDeps = pickLatestDependencies(pypiMeta);
    console.log(`  ✓ Found ${pypiDeps.length} dependencies from PyPI`);
    if (pypiDeps.length > 0) {
      console.log(`  Sample deps: ${pypiDeps.slice(0, 5).join(", ")}`);
    }
  } catch (err) {
    console.log(`  ✗ Failed to fetch PyPI metadata: ${(err as Error).message}`);
  }
  
  // 2. Get our computed similar packages
  let ourSimilar: Array<{ name: string; jaccard: number }> = [];
  try {
    console.log(`  Computing similar packages...`);
    const similar = await computeSimilarOnDemand(pkg, 10, {
      restrictToPeerGroup: false,
      topSearchLimit: 100,
      maxDependentsToScan: 100,
      maxLiveCandidates: 100,
    });
    ourSimilar = similar.map(function (s) {
      return { name: s.name, jaccard: s.jaccard };
    });
    console.log(`  ✓ Found ${ourSimilar.length} similar packages`);
    if (ourSimilar.length > 0) {
      console.log(`  Top similar: ${ourSimilar.slice(0, 3).map(function (s) { return `${s.name} (${(s.jaccard * 100).toFixed(2)}%)`; }).join(", ")}`);
    }
  } catch (err) {
    console.log(`  ✗ Failed to compute similar: ${(err as Error).message}`);
  }
  
  // 3. Get our computed co-occurrence packages
  let ourCooccur: Array<{ name: string; jaccard: number; sharedDeps?: string[] }> = [];
  try {
    console.log(`  Computing co-occurrence packages...`);
    const cooccur = await computeCooccurrence(pkg, 10, { maxDependentsToScan: 100 });
    ourCooccur = cooccur.map(function (c) {
      return { name: c.name, jaccard: c.jaccard, sharedDependents: c.sharedDependents };
    });
    console.log(`  ✓ Found ${ourCooccur.length} co-occurring packages`);
    if (ourCooccur.length > 0) {
      console.log(`  Top co-occurring: ${ourCooccur.slice(0, 3).map(function (c) { return `${c.name} (${(c.jaccard * 100).toFixed(2)}%, ${(c as { sharedDependents?: number; sharedDeps?: string[] }).sharedDependents || (c.sharedDeps?.length || 0)} shared)`; }).join(", ")}`);
    }
  } catch (err) {
    console.log(`  ✗ Failed to compute co-occurrence: ${(err as Error).message}`);
  }
  
  // 4. Verify co-occurrence by checking if packages actually share dependencies
  if (pypiDeps.length > 0 && ourCooccur.length > 0) {
    console.log(`\n  Verifying co-occurrence accuracy (checking top 3)...`);
    const pypiDepsSet = new Set<string>(pypiDeps.map(function (d) { return d.toLowerCase(); }));
    
    for (let i = 0; i < Math.min(3, ourCooccur.length); i += 1) {
      const cooccurPkg = ourCooccur[i];
      try {
        const cooccurMeta = await fetchPackageMeta(cooccurPkg.name);
        const cooccurDeps = pickLatestDependencies(cooccurMeta);
        const cooccurDepsSet = new Set<string>(cooccurDeps.map(function (d) { return d.toLowerCase(); }));
        
        // Find shared dependencies
        const sharedDeps: string[] = [];
        for (const dep of pypiDepsSet) {
          if (cooccurDepsSet.has(dep)) {
            sharedDeps.push(dep);
          }
        }
        
        console.log(`    ${cooccurPkg.name}:`);
        console.log(`      - Our score: ${(cooccurPkg.jaccard * 100).toFixed(2)}%, shared: ${(cooccurPkg as { sharedDependents?: number }).sharedDependents || 0}`);
        console.log(`      - Actual shared deps: ${sharedDeps.length} (${sharedDeps.slice(0, 5).join(", ")})`);
        
        if (sharedDeps.length > 0) {
          console.log(`      ✓ VALID: They do share ${sharedDeps.length} dependencies`);
        } else {
          console.log(`      ⚠ WARNING: No shared dependencies found (may be name-based match)`);
        }
        
        // Small delay to avoid rate limiting
        await new Promise(function (resolve) { setTimeout(resolve, 200); });
      } catch (err) {
        console.log(`    ${cooccurPkg.name}: ✗ Failed to verify - ${(err as Error).message}`);
      }
    }
  }
  
  // 5. Check similar packages by looking at their dependencies overlap
  if (pypiDeps.length > 0 && ourSimilar.length > 0) {
    console.log(`\n  Verifying similar packages (checking top 2)...`);
    const pypiDepsSet = new Set<string>(pypiDeps.map(function (d) { return d.toLowerCase(); }));
    
    for (let i = 0; i < Math.min(2, ourSimilar.length); i += 1) {
      const similarPkg = ourSimilar[i];
      try {
        const similarMeta = await fetchPackageMeta(similarPkg.name);
        const similarDeps = pickLatestDependencies(similarMeta);
        const similarDepsSet = new Set<string>(similarDeps.map(function (d) { return d.toLowerCase(); }));
        
        // Find shared dependencies
        const sharedDeps: string[] = [];
        for (const dep of pypiDepsSet) {
          if (similarDepsSet.has(dep)) {
            sharedDeps.push(dep);
          }
        }
        
        // Jaccard similarity of dependencies
        const union = new Set<string>([...pypiDepsSet, ...similarDepsSet]);
        const jaccard = union.size > 0 ? sharedDeps.length / union.size : 0;
        
        console.log(`    ${similarPkg.name}:`);
        console.log(`      - Our Jaccard: ${(similarPkg.jaccard * 100).toFixed(2)}%`);
        console.log(`      - Actual shared deps: ${sharedDeps.length} out of ${union.size} (Jaccard: ${(jaccard * 100).toFixed(2)}%)`);
        console.log(`      - Shared: ${sharedDeps.slice(0, 5).join(", ")}`);
        
        if (sharedDeps.length > 0) {
          console.log(`      ✓ VALID: They share dependencies`);
        } else {
          console.log(`      ⚠ WARNING: No shared dependencies (may be name-based or reverse deps match)`);
        }
        
        await new Promise(function (resolve) { setTimeout(resolve, 200); });
      } catch (err) {
        console.log(`    ${similarPkg.name}: ✗ Failed to verify - ${(err as Error).message}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const projectRoot = getProjectRoot();
  const testResultsPath = path.join(projectRoot, "data", "test-results.json");
  
  if (!existsSync(testResultsPath)) {
    console.error(`Test results file not found at ${testResultsPath}`);
    console.error("Please run test-popular-packages.ts first");
    process.exit(1);
  }
  
  const testResults: TestResult[] = JSON.parse(readFileSync(testResultsPath, "utf-8"));
  
  // Select packages for verification:
  // 1. One with both similar and co-occurrence
  // 2. One with only co-occurrence
  // 3. One with only similar
  // 4. One with many results
  
  const withBoth = testResults.filter(function (r) {
    return r.similarCount > 0 && r.cooccurCount > 0;
  });
  
  const withOnlyCooccur = testResults.filter(function (r) {
    return r.similarCount === 0 && r.cooccurCount > 0;
  });
  
  const withOnlySimilar = testResults.filter(function (r) {
    return r.similarCount > 0 && r.cooccurCount === 0;
  });
  
  const packagesToVerify: string[] = [];
  
  if (withBoth.length > 0) {
    packagesToVerify.push(withBoth[0].pkg); // Example: django, alembic
  }
  if (withOnlyCooccur.length > 0) {
    packagesToVerify.push(withOnlyCooccur[0].pkg); // Example: aiohttp
  }
  if (withOnlySimilar.length > 0) {
    packagesToVerify.push(withOnlySimilar[0].pkg); // Example: Pillow-SIMD
  }
  
  // Add a popular package with many dependencies
  packagesToVerify.push("requests");
  packagesToVerify.push("numpy");
  
  console.log(`\n=== Verification Report ===`);
  console.log(`Verifying ${packagesToVerify.length} packages against PyPI API\n`);
  
  for (let i = 0; i < packagesToVerify.length; i += 1) {
    const pkg = packagesToVerify[i];
    try {
      await verifyPackage(pkg);
      
      // Delay between packages
      if (i < packagesToVerify.length - 1) {
        console.log(`\n  Waiting 2 seconds before next package...`);
        await new Promise(function (resolve) { setTimeout(resolve, 2000); });
      }
    } catch (err) {
      console.error(`  ✗ Error verifying ${pkg}:`, (err as Error).message);
    }
  }
  
  console.log(`\n=== Verification Complete ===`);
}

main().catch(function (e) {
  console.error("Fatal error:", e);
  process.exit(1);
});

