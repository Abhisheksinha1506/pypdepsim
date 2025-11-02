/* eslint-disable no-console */
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { computeSimilarOnDemand, computeCooccurrence, getReverseDeps } from "../lib/similar";
import { fetchPackageMeta } from "../lib/pypi";

type TestResult = {
  pkg: string;
  hasReverseDeps: boolean;
  reverseDepsCount: number;
  similarCount: number;
  cooccurCount: number;
  similarError?: string;
  cooccurError?: string;
  reverseDepsError?: string;
  metaError?: string;
  hasMeta: boolean;
  timeout?: boolean;
};

// Timeout wrapper to prevent hanging
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage?: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(function (_, reject) {
      setTimeout(function () {
        reject(new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}

// Calculate dynamic timeout based on package name (for logging/debugging)
function calculateTestTimeout(pkg: string, baseTimeout: number): number {
  // Longer package names might need slightly more time
  const complexityMultiplier = pkg.length > 15 ? 1.1 : 1.0;
  return Math.floor(baseTimeout * complexityMultiplier);
}

async function testPackage(pkg: string): Promise<TestResult> {
  const result: TestResult = {
    pkg,
    hasReverseDeps: false,
    reverseDepsCount: 0,
    similarCount: 0,
    cooccurCount: 0,
    hasMeta: false,
  };

  // Dynamic timeout calculation - allow more time for complex operations
  const REVERSE_DEPS_TIMEOUT = 15000; // 15s for reverse deps
  const META_TIMEOUT = 10000; // 10s for metadata
  const SIMILAR_TIMEOUT = 120000; // 2min for similarity computation (it can be slow)
  const COOCCUR_TIMEOUT = 120000; // 2min for co-occurrence computation

  try {
    const reverseDeps = await withTimeout(
      getReverseDeps(pkg),
      calculateTestTimeout(pkg, REVERSE_DEPS_TIMEOUT),
      `getReverseDeps timed out for ${pkg}`
    );
    result.hasReverseDeps = reverseDeps.size > 0;
    result.reverseDepsCount = reverseDeps.size;
  } catch (err) {
    const errMsg = (err as Error).message || String(err);
    result.reverseDepsError = errMsg;
    if (errMsg.includes("timed out")) {
      result.timeout = true;
    }
  }

  try {
    const meta = await withTimeout(
      fetchPackageMeta(pkg),
      calculateTestTimeout(pkg, META_TIMEOUT),
      `fetchPackageMeta timed out for ${pkg}`
    );
    result.hasMeta = meta !== null && meta !== undefined;
  } catch (err) {
    const errMsg = (err as Error).message || String(err);
    result.metaError = errMsg;
    if (errMsg.includes("timed out")) {
      result.timeout = true;
    }
  }

  try {
    const similar = await withTimeout(
      computeSimilarOnDemand(pkg, 20, {
        restrictToPeerGroup: false,
        topSearchLimit: 250,
        maxDependentsToScan: 300,
        maxLiveCandidates: 400,
      }),
      calculateTestTimeout(pkg, SIMILAR_TIMEOUT),
      `computeSimilarOnDemand timed out for ${pkg}`
    );
    result.similarCount = similar.length;
  } catch (err) {
    const errMsg = (err as Error).message || String(err);
    result.similarError = errMsg;
    if (errMsg.includes("timed out")) {
      result.timeout = true;
    }
  }

  try {
    const cooccur = await withTimeout(
      computeCooccurrence(pkg, 20, { maxDependentsToScan: 300 }),
      calculateTestTimeout(pkg, COOCCUR_TIMEOUT),
      `computeCooccurrence timed out for ${pkg}`
    );
    result.cooccurCount = cooccur.length;
  } catch (err) {
    const errMsg = (err as Error).message || String(err);
    result.cooccurError = errMsg;
    if (errMsg.includes("timed out")) {
      result.timeout = true;
    }
  }

  return result;
}

// Helper function to get project root reliably
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
    const grandparentPath = path.resolve(cwd, "..", "..", "data", "popular.json");
    if (existsSync(grandparentPath)) {
      return path.resolve(cwd, "..", "..");
    }
  } catch {
    // Continue if resolution fails
  }
  return cwd;
}

async function main(): Promise<void> {
  const projectRoot = getProjectRoot();
  const popularPath = path.join(projectRoot, "data", "popular.json");
  if (!existsSync(popularPath)) {
    console.error(`Error: Could not find popular.json at ${popularPath}`);
    process.exit(1);
  }
  const popular: string[] = JSON.parse(readFileSync(popularPath, "utf-8"));

  console.log(`Testing ${popular.length} packages from popular.json...\n`);

  const results: TestResult[] = [];
  const concurrency = 3; // Reduced concurrency to avoid overwhelming the system
  let completed = 0;

  // Test each package with individual timeout protection
  for (let i = 0; i < popular.length; i += concurrency) {
    const batch = popular.slice(i, i + concurrency);
    
    // Use Promise.allSettled to ensure we don't stop if one package hangs
    // Also add per-package timeout as a safety measure
    const batchPromises = batch.map(function (pkg) {
      return withTimeout(
        testPackage(pkg),
        180000, // 3min absolute maximum per package
        `testPackage timed out for ${pkg}`
      ).catch(function (err) {
        // Return a result even if the test itself times out
        return {
          pkg,
          hasReverseDeps: false,
          reverseDepsCount: 0,
          similarCount: 0,
          cooccurCount: 0,
          hasMeta: false,
          similarError: (err as Error).message || String(err),
          timeout: true,
        } as TestResult;
      });
    });
    
    const batchSettled = await Promise.allSettled(batchPromises);
    const batchResults = batchSettled.map(function (settled, idx) {
      if (settled.status === "fulfilled") {
        return settled.value;
      } else {
        // If Promise.allSettled somehow fails, return error result
        return {
          pkg: batch[idx],
          hasReverseDeps: false,
          reverseDepsCount: 0,
          similarCount: 0,
          cooccurCount: 0,
          hasMeta: false,
          similarError: (settled.reason as Error)?.message || String(settled.reason) || "Unknown error",
          timeout: true,
        } as TestResult;
      }
    });
    
    results.push(...batchResults);
    completed += batch.length;
    
    const successCount = batchResults.filter(function (r) {
      return (r.similarCount > 0 || r.cooccurCount > 0) && !r.timeout;
    }).length;
    
    console.log(`Progress: ${completed}/${popular.length} (${Math.round((completed / popular.length) * 100)}%) - Batch: ${successCount}/${batch.length} succeeded`);
    
    // Small delay between batches to avoid rate limiting
    if (i + concurrency < popular.length) {
      await new Promise(function (resolve) {
        setTimeout(resolve, 1000); // Increased delay to 1s
      });
    }
  }

  // Analyze results
  const total = results.length;
  const withReverseDeps = results.filter(function (r) { return r.hasReverseDeps; }).length;
  const withSimilar = results.filter(function (r) { return r.similarCount > 0; }).length;
  const withCooccur = results.filter(function (r) { return r.cooccurCount > 0; }).length;
  const withMeta = results.filter(function (r) { return r.hasMeta; }).length;
  
  const similarErrors = results.filter(function (r) { return r.similarError; });
  const cooccurErrors = results.filter(function (r) { return r.cooccurError; });
  const reverseDepsErrors = results.filter(function (r) { return r.reverseDepsError; });
  const metaErrors = results.filter(function (r) { return r.metaError; });

  console.log("\n=== SUMMARY ===");
  console.log(`Total packages tested: ${total}`);
  console.log(`Packages with reverse deps: ${withReverseDeps} (${Math.round((withReverseDeps / total) * 100)}%)`);
  console.log(`Packages with similar results: ${withSimilar} (${Math.round((withSimilar / total) * 100)}%)`);
  console.log(`Packages with cooccur results: ${withCooccur} (${Math.round((withCooccur / total) * 100)}%)`);
  console.log(`Packages with valid meta: ${withMeta} (${Math.round((withMeta / total) * 100)}%)`);

  const timeoutCount = results.filter(function (r) { return r.timeout; }).length;
  
  console.log(`\n=== ERRORS ===`);
  console.log(`Similar errors: ${similarErrors.length}`);
  console.log(`Cooccur errors: ${cooccurErrors.length}`);
  console.log(`Reverse deps errors: ${reverseDepsErrors.length}`);
  console.log(`Meta errors: ${metaErrors.length}`);
  console.log(`Timeout errors: ${timeoutCount}`);

  // Find packages with issues
  const noResults = results.filter(function (r) {
    return !r.similarError && !r.cooccurError && r.similarCount === 0 && r.cooccurCount === 0 && r.hasReverseDeps;
  });

  const noReverseDeps = results.filter(function (r) {
    return !r.reverseDepsError && !r.hasReverseDeps;
  });

  console.log(`\n=== ISSUES ===`);
  console.log(`Packages with reverse deps but no similar/cooccur results: ${noResults.length}`);
  if (noResults.length > 0 && noResults.length <= 20) {
    console.log("Examples:", noResults.slice(0, 10).map(function (r) { return r.pkg; }).join(", "));
  }

  console.log(`Packages with no reverse deps: ${noReverseDeps.length}`);
  if (noReverseDeps.length > 0 && noReverseDeps.length <= 20) {
    console.log("Examples:", noReverseDeps.slice(0, 10).map(function (r) { return r.pkg; }).join(", "));
  }

  // Show error details
  if (similarErrors.length > 0) {
    console.log("\n=== SIMILAR ERRORS (first 10) ===");
    similarErrors.slice(0, 10).forEach(function (r) {
      console.log(`  ${r.pkg}: ${r.similarError}`);
    });
  }

  if (cooccurErrors.length > 0) {
    console.log("\n=== COOCCUR ERRORS (first 10) ===");
    cooccurErrors.slice(0, 10).forEach(function (r) {
      console.log(`  ${r.pkg}: ${r.cooccurError}`);
    });
  }

  // Show successful similar and co-occurrence examples
  const withBothSimilarAndCooccur = results.filter(function (r) {
    return r.similarCount > 0 && r.cooccurCount > 0 && !r.timeout && !r.similarError && !r.cooccurError;
  });
  
  console.log("\n=== SUCCESSFUL RESULTS ===");
  console.log(`Packages with both similar AND co-occurrence results: ${withBothSimilarAndCooccur.length}`);
  if (withBothSimilarAndCooccur.length > 0) {
    console.log("\nExamples of packages with successful similar AND co-occurrence results:");
    withBothSimilarAndCooccur.slice(0, 10).forEach(function (r) {
      console.log(`  ${r.pkg}: ${r.similarCount} similar, ${r.cooccurCount} co-occurring`);
    });
  }
  
  const withSimilarOnly = results.filter(function (r) {
    return r.similarCount > 0 && r.cooccurCount === 0 && !r.timeout && !r.similarError;
  });
  console.log(`\nPackages with similar results only: ${withSimilarOnly.length}`);
  
  const withCooccurOnly = results.filter(function (r) {
    return r.similarCount === 0 && r.cooccurCount > 0 && !r.timeout && !r.cooccurError;
  });
  console.log(`Packages with co-occurrence results only: ${withCooccurOnly.length}`);

  // Write detailed results to file
  const outputPath = path.join(getProjectRoot(), "data", "test-results.json");
  writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nDetailed results written to: ${outputPath}`);
}

main().catch(function (e) {
  console.error("Fatal error:", e);
  process.exit(1);
});

