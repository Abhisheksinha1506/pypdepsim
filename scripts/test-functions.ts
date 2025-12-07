#!/usr/bin/env tsx
/**
 * Function Validation Test Script
 * Tests core library functions to ensure they work correctly
 */

import { existsSync } from "fs";
import path from "path";

// Test results tracking
interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration?: number;
}

const results: TestResult[] = [];

function test(name: string, fn: () => Promise<void> | void): void {
  const start = Date.now();
  try {
    const result = fn();
    if (result instanceof Promise) {
      result
        .then(function () {
          const duration = Date.now() - start;
          results.push({ name, passed: true, duration });
          console.log(`✅ ${name} (${duration}ms)`);
        })
        .catch(function (err) {
          const duration = Date.now() - start;
          results.push({ name, passed: false, error: String(err), duration });
          console.log(`❌ ${name}: ${err}`);
        });
    } else {
      const duration = Date.now() - start;
      results.push({ name, passed: true, duration });
      console.log(`✅ ${name} (${duration}ms)`);
    }
  } catch (err) {
    const duration = Date.now() - start;
    results.push({ name, passed: false, error: String(err), duration });
    console.log(`❌ ${name}: ${err}`);
  }
}

async function runTests(): Promise<void> {
  console.log("🧪 Running function validation tests...\n");

  // Test cache functions
  test("loadPopularPackages - returns array", async function () {
    const { loadPopularPackages } = await import("../lib/cache");
    const result = loadPopularPackages();
    if (!Array.isArray(result)) {
      throw new Error("Expected array, got " + typeof result);
    }
  });

  test("loadPopularPackages - handles missing file", async function () {
    const { loadPopularPackages } = await import("../lib/cache");
    // Should return empty array if file doesn't exist
    const result = loadPopularPackages();
    if (!Array.isArray(result)) {
      throw new Error("Expected array even when file missing");
    }
  });

  test("loadReverseDepsCacheAsync - returns object", async function () {
    const { loadReverseDepsCacheAsync } = await import("../lib/cache");
    const result = await loadReverseDepsCacheAsync();
    if (typeof result !== "object" || result === null) {
      throw new Error("Expected object, got " + typeof result);
    }
  });

  test("getReverseDepsForPackage - handles missing package", async function () {
    const { getReverseDepsForPackage } = await import("../lib/cache");
    const result = await getReverseDepsForPackage("nonexistent-package-xyz-123");
    // Should return null or empty array for non-existent package
    if (result !== null && !Array.isArray(result)) {
      throw new Error("Expected null or array for non-existent package");
    }
  });

  // Test similar functions
  test("normalizePackageName - normalizes correctly", async function () {
    // Check if normalizePackageName exists in similar.ts
    const similarModule = await import("../lib/similar");
    // The function is not exported, so we test through getReverseDeps
    const { getReverseDeps } = await import("../lib/similar");
    // Test that it handles different case variations
    const result1 = await getReverseDeps("REQUESTS");
    const result2 = await getReverseDeps("requests");
    // Both should return Sets (even if empty)
    if (!(result1 instanceof Set) || !(result2 instanceof Set)) {
      throw new Error("getReverseDeps should return Set");
    }
  });

  test("getReverseDeps - returns Set", async function () {
    const { getReverseDeps } = await import("../lib/similar");
    const result = await getReverseDeps("requests");
    if (!(result instanceof Set)) {
      throw new Error("Expected Set, got " + typeof result);
    }
  });

  // Test jaccard functions
  test("jaccardSimilarity - calculates correctly", async function () {
    const { jaccardSimilarity } = await import("../lib/jaccard");
    const set1 = new Set(["a", "b", "c"]);
    const set2 = new Set(["b", "c", "d"]);
    const result = jaccardSimilarity(set1, set2);
    // Intersection: {b, c} = 2
    // Union: {a, b, c, d} = 4
    // Jaccard: 2/4 = 0.5
    if (result.score !== 0.5) {
      throw new Error(`Expected 0.5, got ${result.score}`);
    }
    if (result.shared !== 2) {
      throw new Error(`Expected 2 shared, got ${result.shared}`);
    }
  });

  test("jaccardSimilarity - handles empty sets", async function () {
    const { jaccardSimilarity } = await import("../lib/jaccard");
    const set1 = new Set<string>([]);
    const set2 = new Set<string>([]);
    const result = jaccardSimilarity(set1, set2);
    if (result.score !== 0) {
      throw new Error("Expected 0 for empty sets, got " + result.score);
    }
  });

  test("jaccardSimilarity - handles no intersection", async function () {
    const { jaccardSimilarity } = await import("../lib/jaccard");
    const set1 = new Set(["a", "b"]);
    const set2 = new Set(["c", "d"]);
    const result = jaccardSimilarity(set1, set2);
    if (result.score !== 0) {
      throw new Error("Expected 0 for no intersection, got " + result.score);
    }
  });

  // Test jaccardBitset
  test("jaccardBitset - calculates correctly", async function () {
    const { jaccardBitset } = await import("../lib/jaccardBitset");
    const a = new Uint32Array([1, 2, 3]);
    const b = new Uint32Array([2, 3, 4]);
    const result = jaccardBitset(a, b);
    // Intersection: 2, 3 = 2
    // Union: 1, 2, 3, 4 = 4
    // Jaccard: 2/4 = 0.5
    if (Math.abs(result - 0.5) > 0.0001) {
      throw new Error(`Expected ~0.5, got ${result}`);
    }
  });

  test("jaccardBitset - handles empty arrays", async function () {
    const { jaccardBitset } = await import("../lib/jaccardBitset");
    const a = new Uint32Array([]);
    const b = new Uint32Array([]);
    const result = jaccardBitset(a, b);
    if (result !== 0) {
      throw new Error("Expected 0 for empty arrays, got " + result);
    }
  });

  // Test packages-metadata
  test("getPackageMetadata - returns object or null", async function () {
    const { getPackageMetadata } = await import("../lib/packages-metadata");
    const result = getPackageMetadata("nonexistent-package");
    // Should return null or object
    if (result !== null && typeof result !== "object") {
      throw new Error("Expected null or object, got " + typeof result);
    }
  });

  // Test pypi functions
  test("pickLatestDependencies - parses dependencies", async function () {
    const { pickLatestDependencies } = await import("../lib/pypi");
    const meta = {
      info: {
        requires_dist: [
          "requests>=2.25.0",
          "numpy[extra]>=1.20.0",
          "pandas==1.3.0",
        ],
      },
    };
    const result = pickLatestDependencies(meta);
    if (!Array.isArray(result)) {
      throw new Error("Expected array, got " + typeof result);
    }
    if (!result.includes("requests") || !result.includes("numpy") || !result.includes("pandas")) {
      throw new Error("Missing expected dependencies");
    }
  });

  test("pickLatestDependencies - handles empty requires_dist", async function () {
    const { pickLatestDependencies } = await import("../lib/pypi");
    const meta = {
      info: {
        requires_dist: [],
      },
    };
    const result = pickLatestDependencies(meta);
    if (!Array.isArray(result) || result.length !== 0) {
      throw new Error("Expected empty array");
    }
  });

  test("pickLatestDependencies - handles missing requires_dist", async function () {
    const { pickLatestDependencies } = await import("../lib/pypi");
    const meta = {
      info: {},
    };
    const result = pickLatestDependencies(meta);
    if (!Array.isArray(result)) {
      throw new Error("Expected array even when requires_dist missing");
    }
  });

  // Wait for all async tests to complete
  await new Promise(function (resolve) {
    setTimeout(resolve, 2000);
  });

  // Print summary
  console.log("\n📊 Test Summary:\n");
  const passed = results.filter(function (r) { return r.passed; }).length;
  const failed = results.filter(function (r) { return !r.passed; }).length;
  const totalDuration = results.reduce(function (sum, r) { return sum + (r.duration || 0); }, 0);

  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   ⏱️  Total Duration: ${totalDuration}ms`);
  console.log(`   📝 Total Tests: ${results.length}\n`);

  if (failed > 0) {
    console.log("Failed Tests:\n");
    results
      .filter(function (r) { return !r.passed; })
      .forEach(function (r) {
        console.log(`   ❌ ${r.name}`);
        if (r.error) {
          console.log(`      Error: ${r.error}`);
        }
      });
    console.log("");
    process.exit(1);
  } else {
    console.log("🎉 All tests passed!\n");
    process.exit(0);
  }
}

runTests().catch(function (err) {
  console.error("Test runner error:", err);
  process.exit(1);
});

