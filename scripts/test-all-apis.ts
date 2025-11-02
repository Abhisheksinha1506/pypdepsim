/* eslint-disable no-console */
import { spawn } from "child_process";

const BASE_URL = process.env.TEST_URL || "http://localhost:3000";
const TEST_PACKAGE = "requests";

type ApiTest = {
  name: string;
  path: string;
  method?: string;
  body?: any;
  expectedStatus?: number;
};

const tests: ApiTest[] = [
  {
    name: "Health Check",
    path: "/api/health",
    expectedStatus: 200,
  },
  {
    name: "Popular Packages",
    path: "/api/categories/popular",
    expectedStatus: 200,
  },
  {
    name: "Package Metadata",
    path: `/api/meta/${TEST_PACKAGE}`,
    expectedStatus: 200,
  },
  {
    name: "Similar Packages",
    path: `/api/similar/${TEST_PACKAGE}?limit=5`,
    expectedStatus: 200,
  },
  {
    name: "Reverse Dependencies",
    path: `/api/reverse-deps/${TEST_PACKAGE}`,
    expectedStatus: 200,
  },
  {
    name: "Libraries.io Config (GET)",
    path: "/api/config/libraries-io",
    expectedStatus: 200,
  },
];

async function testApi(test: ApiTest): Promise<{ success: boolean; status: number; error?: string; duration: number }> {
  const startTime = Date.now();
  
  try {
    const url = `${BASE_URL}${test.path}`;
    const options: RequestInit = {
      method: test.method || "GET",
      headers: {
        "Content-Type": "application/json",
      },
    };
    
    if (test.body) {
      options.body = JSON.stringify(test.body);
    }
    
    const response = await fetch(url, options);
    const duration = Date.now() - startTime;
    const status = response.status;
    
    let data: any;
    try {
      data = await response.json();
    } catch {
      data = { raw: await response.text() };
    }
    
    const expectedStatus = test.expectedStatus || 200;
    const success = status === expectedStatus;
    
    return {
      success,
      status,
      error: success ? undefined : `Expected ${expectedStatus}, got ${status}`,
      duration,
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    return {
      success: false,
      status: 0,
      error: (err as Error).message || String(err),
      duration,
    };
  }
}

async function waitForServer(maxWait: number = 30000): Promise<boolean> {
  console.log(`Waiting for server at ${BASE_URL}...`);
  const start = Date.now();
  
  while (Date.now() - start < maxWait) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) {
        console.log("✓ Server is running\n");
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise(function (resolve) { setTimeout(resolve, 1000); });
  }
  
  console.log("✗ Server did not start in time");
  return false;
}

async function main(): Promise<void> {
  console.log("=== API Endpoint Tests ===\n");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Test Package: ${TEST_PACKAGE}\n`);
  
  // Check if server is running
  const serverRunning = await waitForServer();
  if (!serverRunning) {
    console.log("\nTo start the server, run:");
    console.log("  npm run dev\n");
    process.exit(1);
  }
  
  console.log(`Running ${tests.length} API tests...\n`);
  
  const results: Array<{ test: ApiTest; result: { success: boolean; status: number; error?: string; duration: number } }> = [];
  
  for (let i = 0; i < tests.length; i += 1) {
    const test = tests[i];
    process.stdout.write(`[${i + 1}/${tests.length}] ${test.name}... `);
    
    const result = await testApi(test);
    results.push({ test, result });
    
    if (result.success) {
      console.log(`✓ (${result.status}, ${result.duration}ms)`);
    } else {
      console.log(`✗ (${result.status}, ${result.duration}ms) - ${result.error || "Failed"}`);
    }
    
    // Small delay between tests
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
  }
  
  console.log("\n=== Summary ===\n");
  
  const passed = results.filter(function (r) { return r.result.success; }).length;
  const failed = results.filter(function (r) { return !r.result.success; }).length;
  
  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}\n`);
  
  if (failed > 0) {
    console.log("Failed Tests:\n");
    results.filter(function (r) { return !r.result.success; }).forEach(function ({ test, result }) {
      console.log(`  ✗ ${test.name}`);
      console.log(`    Path: ${test.path}`);
      console.log(`    Status: ${result.status}`);
      if (result.error) {
        console.log(`    Error: ${result.error}`);
      }
      console.log();
    });
  }
  
  // Additional info
  console.log("=== Additional Info ===\n");
  
  const configTest = results.find(function (r) { return r.test.name.includes("Libraries.io Config"); });
  if (configTest && configTest.result.success) {
    try {
      const response = await fetch(`${BASE_URL}/api/config/libraries-io`);
      const config = await response.json();
      console.log("Libraries.io API Key Status:");
      console.log(`  Configured: ${config.configured ? "Yes" : "No"}`);
      console.log(`  Source: ${config.source || "N/A"}\n`);
    } catch {
      // Ignore
    }
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (e) {
  console.error("Fatal error:", e);
  process.exit(1);
});




