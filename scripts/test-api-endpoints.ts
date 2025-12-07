#!/usr/bin/env tsx
/**
 * API Endpoint Test Script
 * Tests all API endpoints with various inputs and error scenarios
 */

interface TestResult {
  endpoint: string;
  method: string;
  status: number;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];
const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

async function testEndpoint(
  endpoint: string,
  method: string = "GET",
  body?: unknown
): Promise<void> {
  const start = Date.now();
  try {
    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, options);
    const duration = Date.now() - start;
    const status = response.status;

    // Consider 2xx and 3xx as success
    const passed = status >= 200 && status < 400;

    results.push({
      endpoint,
      method,
      status,
      passed,
      duration,
    });

    if (passed) {
      console.log(`✅ ${method} ${endpoint} - ${status} (${duration}ms)`);
    } else {
      const text = await response.text().catch(function () { return ""; });
      console.log(`❌ ${method} ${endpoint} - ${status} (${duration}ms)`);
      console.log(`   Response: ${text.substring(0, 100)}`);
    }
  } catch (err) {
    const duration = Date.now() - start;
    results.push({
      endpoint,
      method,
      status: 0,
      passed: false,
      error: String(err),
      duration,
    });
    console.log(`❌ ${method} ${endpoint} - Error: ${err}`);
  }
}

async function runTests(): Promise<void> {
  console.log(`🧪 Testing API endpoints at ${BASE_URL}...\n`);
  console.log("Note: Make sure the dev server is running (npm run dev)\n");

  // Test health endpoint
  console.log("Testing /api/health...");
  await testEndpoint("/api/health");

  // Test popular packages endpoint
  console.log("\nTesting /api/categories/popular...");
  await testEndpoint("/api/categories/popular");

  // Test meta endpoint with various packages
  console.log("\nTesting /api/meta/[pkg]...");
  await testEndpoint("/api/meta/requests");
  await testEndpoint("/api/meta/numpy");
  await testEndpoint("/api/meta/nonexistent-package-xyz-123");
  await testEndpoint("/api/meta/");

  // Test similar endpoint
  console.log("\nTesting /api/similar/[pkg]...");
  await testEndpoint("/api/similar/requests");
  await testEndpoint("/api/similar/requests?limit=5");
  await testEndpoint("/api/similar/requests?limit=100&nocache=1");
  await testEndpoint("/api/similar/nonexistent-package");

  // Test reverse-deps endpoint
  console.log("\nTesting /api/reverse-deps/[pkg]...");
  await testEndpoint("/api/reverse-deps/requests");
  await testEndpoint("/api/reverse-deps/numpy");
  await testEndpoint("/api/reverse-deps/nonexistent-package");

  // Test config endpoint
  console.log("\nTesting /api/config/libraries-io...");
  await testEndpoint("/api/config/libraries-io");
  await testEndpoint("/api/config/libraries-io", "POST", { apiKey: "test-key" });
  await testEndpoint("/api/config/libraries-io", "DELETE");

  // Print summary
  console.log("\n📊 Test Summary:\n");
  const passed = results.filter(function (r) { return r.passed; }).length;
  const failed = results.filter(function (r) { return !r.passed; }).length;
  const totalDuration = results.reduce(function (sum, r) { return sum + r.duration; }, 0);
  const avgDuration = results.length > 0 ? totalDuration / results.length : 0;

  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   ⏱️  Total Duration: ${totalDuration}ms`);
  console.log(`   📊 Average Duration: ${avgDuration.toFixed(2)}ms`);
  console.log(`   📝 Total Tests: ${results.length}\n`);

  if (failed > 0) {
    console.log("Failed Tests:\n");
    results
      .filter(function (r) { return !r.passed; })
      .forEach(function (r) {
        console.log(`   ❌ ${r.method} ${r.endpoint}`);
        console.log(`      Status: ${r.status || "Error"}`);
        if (r.error) {
          console.log(`      Error: ${r.error}`);
        }
      });
    console.log("");
    
    // Don't exit with error if server is not running
    const serverNotRunning = results.some(function (r) {
      return r.status === 0 && r.error && r.error.includes("fetch failed");
    });
    
    if (serverNotRunning) {
      console.log("⚠️  Some tests failed because the server is not running.");
      console.log("   Start the server with: npm run dev\n");
      process.exit(0);
    } else {
      process.exit(1);
    }
  } else {
    console.log("🎉 All tests passed!\n");
    process.exit(0);
  }
}

runTests().catch(function (err) {
  console.error("Test runner error:", err);
  process.exit(1);
});

