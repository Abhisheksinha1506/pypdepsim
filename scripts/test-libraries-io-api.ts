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

// Load env first
loadEnvLocal();

// Now dynamically import config
async function testLibrariesIOAPI(): Promise<void> {
  const { PYPI_API_CONFIG } = await import("../lib/config");
  const apiKey = PYPI_API_CONFIG.LIBRARIES_IO_API_KEY;
  
  if (!apiKey || apiKey === "") {
    console.log("=".repeat(60));
    console.log("❌ LIBRARIES_IO_API_KEY Not Found");
    console.log("=".repeat(60));
    console.log("Please set LIBRARIES_IO_API_KEY in .env.local");
    console.log("Example:");
    console.log('  LIBRARIES_IO_API_KEY=your-api-key-here');
    console.log("=".repeat(60));
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("Testing Libraries.io API");
  console.log("=".repeat(60));
  console.log(`API Key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)} (length: ${apiKey.length})`);
  console.log(`API Base: ${PYPI_API_CONFIG.LIBRARIES_IO_API_BASE}`);
  console.log(`Per Page: ${PYPI_API_CONFIG.LIBRARIES_IO_PER_PAGE}`);
  console.log();

  // Test 1: Check package info endpoint (should work)
  console.log("Test 1: Package Info Endpoint");
  console.log("-".repeat(60));
  try {
    const infoUrl = `${PYPI_API_CONFIG.LIBRARIES_IO_API_BASE}/pypi/requests?api_key=${encodeURIComponent(apiKey)}`;
    console.log(`Fetching: ${infoUrl.replace(apiKey, "***")}`);
    const infoResponse = await fetch(infoUrl);
    console.log(`Status: ${infoResponse.status} ${infoResponse.statusText}`);
    
    if (infoResponse.ok) {
      const infoData = await infoResponse.json() as { name?: string; dependents_count?: number };
      console.log(`✓ Package Info API working!`);
      console.log(`  Package: ${infoData.name || "N/A"}`);
      console.log(`  Dependents Count: ${infoData.dependents_count?.toLocaleString() || "N/A"}`);
    } else {
      const errorText = await infoResponse.text();
      console.log(`❌ Error: ${errorText}`);
    }
  } catch (err) {
    console.log(`❌ Error: ${(err as Error).message}`);
  }
  console.log();

  // Test 2: Check dependents endpoint (may be disabled)
  console.log("Test 2: Dependents Endpoint (List)");
  console.log("-".repeat(60));
  try {
    const depsUrl = `${PYPI_API_CONFIG.LIBRARIES_IO_API_BASE}/pypi/requests/dependents?api_key=${encodeURIComponent(apiKey)}&per_page=${PYPI_API_CONFIG.LIBRARIES_IO_PER_PAGE}`;
    console.log(`Fetching: ${depsUrl.replace(apiKey, "***")}`);
    const depsResponse = await fetch(depsUrl);
    console.log(`Status: ${depsResponse.status} ${depsResponse.statusText}`);
    
    if (depsResponse.ok) {
      const depsData = await depsResponse.json();
      
      if (Array.isArray(depsData)) {
        console.log(`✓ Dependents API working! Got ${depsData.length} results`);
        if (depsData.length > 0) {
          console.log(`  Sample result:`, JSON.stringify(depsData[0], null, 2));
          // Check if there's pagination info in headers
          const linkHeader = depsResponse.headers.get("link");
          if (linkHeader) {
            console.log(`  Pagination: ${linkHeader}`);
          }
        } else {
          console.log(`  Note: Empty result (package may have no dependents)`);
        }
      } else if (depsData && typeof depsData === "object" && "message" in depsData) {
        console.log(`⚠️  Response message: ${(depsData as { message: string }).message}`);
        if (String((depsData as { message: string }).message).includes("Disabled")) {
          console.log(`  ❌ The /dependents endpoint is disabled by Libraries.io`);
          console.log(`  This means we can only get dependents_count, not the actual list`);
        }
      } else {
        console.log(`  Response:`, JSON.stringify(depsData, null, 2));
      }
    } else {
      const errorText = await depsResponse.text();
      console.log(`❌ Error (${depsResponse.status}): ${errorText}`);
    }
  } catch (err) {
    console.log(`❌ Error: ${(err as Error).message}`);
  }
  console.log();

  // Test 3: Try pagination
  console.log("Test 3: Pagination Test");
  console.log("-".repeat(60));
  try {
    const page1Url = `${PYPI_API_CONFIG.LIBRARIES_IO_API_BASE}/pypi/requests/dependents?api_key=${encodeURIComponent(apiKey)}&per_page=5&page=1`;
    console.log(`Fetching page 1: ${page1Url.replace(apiKey, "***")}`);
    const page1Response = await fetch(page1Url);
    
    if (page1Response.ok) {
      const page1Data = await page1Response.json();
      if (Array.isArray(page1Data)) {
        console.log(`✓ Pagination supported! Got ${page1Data.length} results on page 1`);
        
        // Try page 2
        const page2Url = `${PYPI_API_CONFIG.LIBRARIES_IO_API_BASE}/pypi/requests/dependents?api_key=${encodeURIComponent(apiKey)}&per_page=5&page=2`;
        const page2Response = await fetch(page2Url);
        if (page2Response.ok) {
          const page2Data = await page2Response.json();
          if (Array.isArray(page2Data)) {
            console.log(`✓ Page 2 also works! Got ${page2Data.length} results`);
          }
        }
      }
    }
  } catch (err) {
    console.log(`⚠️  Pagination test failed: ${(err as Error).message}`);
  }
  console.log();

  // Test 4: Rate limit check
  console.log("Test 4: Rate Limit Check");
  console.log("-".repeat(60));
  try {
    const startTime = Date.now();
    const requests = [];
    for (let i = 0; i < 5; i += 1) {
      const testUrl = `${PYPI_API_CONFIG.LIBRARIES_IO_API_BASE}/pypi/requests?api_key=${encodeURIComponent(apiKey)}`;
      requests.push(fetch(testUrl));
    }
    await Promise.all(requests);
    const elapsed = Date.now() - startTime;
    console.log(`✓ Made 5 requests in ${elapsed}ms`);
    console.log(`  Average: ${(elapsed / 5).toFixed(0)}ms per request`);
  } catch (err) {
    console.log(`⚠️  Rate limit test: ${(err as Error).message}`);
  }

  console.log();
  console.log("=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));
  console.log("If the dependents endpoint works, we can fetch reverse dependencies from API");
  console.log("If it's disabled, we can only get dependents_count, not the actual list");
  console.log("=".repeat(60));
}

if (require.main === module) {
  void testLibrariesIOAPI();
}
