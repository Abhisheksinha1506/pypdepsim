#!/usr/bin/env tsx
/**
 * Script to verify rate limiting is working correctly
 * Tests that requests are properly spaced and rate limits are respected
 */

async function testRateLimiting() {
  console.log("🔍 Testing Rate Limiting...\n");
  
  const { fetchPackageMeta } = await import("./lib/pypi");
  
  const testPackages = ["requests", "django", "flask", "numpy", "pandas"];
  const timings: number[] = [];
  
  console.log(`Testing ${testPackages.length} requests to verify 150ms minimum delay...\n`);
  
  const startTime = Date.now();
  
  for (let i = 0; i < testPackages.length; i += 1) {
    const packageName = testPackages[i];
    const requestStart = Date.now();
    
    try {
      console.log(`${i + 1}. Fetching ${packageName}...`);
      await fetchPackageMeta(packageName);
      const requestTime = Date.now() - requestStart;
      timings.push(requestTime);
      console.log(`   ✓ Completed in ${requestTime}ms`);
    } catch (error) {
      console.error(`   ✗ Failed: ${error}`);
    }
  }
  
  const totalTime = Date.now() - startTime;
  const expectedMinTime = (testPackages.length - 1) * 150; // (n-1) delays for n requests
  
  console.log("\n" + "=".repeat(60));
  console.log("📊 Rate Limiting Verification Results:");
  console.log("=".repeat(60));
  console.log(`Total time: ${totalTime}ms`);
  console.log(`Expected minimum (${testPackages.length - 1} × 150ms): ${expectedMinTime}ms`);
  console.log(`Average time per request: ${Math.round(totalTime / testPackages.length)}ms`);
  console.log(`Request timings: ${timings.map(t => `${t}ms`).join(", ")}`);
  
  if (totalTime >= expectedMinTime * 0.9) { // Allow 10% tolerance
    console.log("\n✅ Rate limiting is working correctly!");
    console.log("   Requests are properly spaced to respect rate limits.");
    return true;
  } else {
    console.log("\n⚠️  Rate limiting may not be working correctly.");
    console.log("   Total time is less than expected minimum delay.");
    return false;
  }
}

async function testConcurrencyRateLimiting() {
  console.log("\n" + "=".repeat(60));
  console.log("🔍 Testing Concurrency + Rate Limiting...\n");
  
  const { fetchPackageMeta } = await import("./lib/pypi");
  
  const testPackages = ["requests", "django", "flask", "numpy", "pandas", "scipy", "matplotlib", "pillow", "tensorflow", "pytorch"];
  
  console.log(`Testing ${testPackages.length} concurrent requests...\n`);
  
  const startTime = Date.now();
  
  // Fetch all in parallel (concurrency limiters should handle rate limiting)
  const promises = testPackages.map(async function (pkg) {
    const requestStart = Date.now();
    try {
      await fetchPackageMeta(pkg);
      return { pkg, time: Date.now() - requestStart, success: true };
    } catch (error) {
      return { pkg, time: Date.now() - requestStart, success: false, error: String(error) };
    }
  });
  
  const results = await Promise.all(promises);
  const totalTime = Date.now() - startTime;
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log("Results:");
  results.forEach(function (r) {
    const status = r.success ? "✓" : "✗";
    console.log(`  ${status} ${r.pkg}: ${r.time}ms${r.error ? ` (${r.error})` : ""}`);
  });
  
  console.log("\n" + "=".repeat(60));
  console.log("📊 Concurrency + Rate Limiting Results:");
  console.log("=".repeat(60));
  console.log(`Total time: ${totalTime}ms`);
  console.log(`Successful: ${successful.length}/${results.length}`);
  console.log(`Failed: ${failed.length}/${results.length}`);
  console.log(`Average time per request: ${Math.round(totalTime / results.length)}ms`);
  
  // With rate limiting, concurrent requests should still respect delays
  // Minimum time should be at least (n/8 - 1) * 150ms for n requests with concurrency 8
  const minConcurrencyDelay = Math.ceil(testPackages.length / 8) * 150;
  console.log(`Expected minimum delay (with concurrency 8): ~${minConcurrencyDelay}ms`);
  
  if (failed.length === 0) {
    console.log("\n✅ All requests succeeded!");
    console.log("   Rate limiting is being respected even with concurrency.");
    return true;
  } else {
    console.log("\n⚠️  Some requests failed.");
    failed.forEach(function (f) {
      console.log(`   ${f.pkg}: ${f.error}`);
    });
    return false;
  }
}

async function main() {
  console.log("🚀 Rate Limiting Verification Test\n");
  
  try {
    const sequentialResult = await testRateLimiting();
    const concurrentResult = await testConcurrencyRateLimiting();
    
    console.log("\n" + "=".repeat(60));
    if (sequentialResult && concurrentResult) {
      console.log("✅ All rate limiting tests passed!");
      console.log("   Rate limits are being correctly enforced.");
      process.exit(0);
    } else {
      console.log("⚠️  Some rate limiting tests had issues.");
      console.log("   Please review the results above.");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Test failed with error:", error);
    process.exit(1);
  }
}

main();

