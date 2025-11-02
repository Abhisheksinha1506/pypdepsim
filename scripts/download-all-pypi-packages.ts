/* eslint-disable no-console */
import { existsSync, writeFileSync, mkdirSync, statSync } from "fs";
import path from "path";
import { PYPI_API_CONFIG } from "../lib/config";

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

// Rate limiting helper
const lastRequestTime = new Map<string, number>();
async function rateLimit(domain: string): Promise<void> {
  const last = lastRequestTime.get(domain) || 0;
  const now = Date.now();
  const elapsed = now - last;
  if (elapsed < PYPI_API_CONFIG.REQUEST_DELAY_MS) {
    await new Promise(function (resolve) { 
      setTimeout(resolve, PYPI_API_CONFIG.REQUEST_DELAY_MS - elapsed); 
    });
  }
  lastRequestTime.set(domain, Date.now());
}

// Fetch with retry and timeout
async function fetchWithRetry(url: string, retries: number = PYPI_API_CONFIG.MAX_RETRY_ATTEMPTS): Promise<Response> {
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < retries) {
    attempt += 1;
    try {
      const domain = new URL(url).hostname;
      await rateLimit(domain);

      const controller = new AbortController();
      const timeoutId = setTimeout(function () { 
        controller.abort(); 
      }, PYPI_API_CONFIG.FETCH_TIMEOUT_MS);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          const delay = Math.min(
            PYPI_API_CONFIG.RETRY_INITIAL_DELAY_MS * (2 ** (attempt - 1)),
            PYPI_API_CONFIG.RETRY_MAX_DELAY_MS
          ) + Math.floor(Math.random() * PYPI_API_CONFIG.RETRY_JITTER_MS);
          await new Promise(function (r) { setTimeout(r, delay); });
          continue;
        }
        throw new Error(`HTTP ${res.status} for ${url}`);
      }

      return res;
    } catch (err) {
      lastError = err as Error;
      if (attempt >= retries) {
        throw lastError;
      }
      const delay = Math.min(
        PYPI_API_CONFIG.RETRY_INITIAL_DELAY_MS * (2 ** (attempt - 1)),
        PYPI_API_CONFIG.RETRY_MAX_DELAY_MS
      ) + Math.floor(Math.random() * PYPI_API_CONFIG.RETRY_JITTER_MS);
      await new Promise(function (r) { setTimeout(r, delay); });
    }
  }

  throw lastError || new Error("Max retry attempts reached");
}

/**
 * Fetch all PyPI package names using the Simple API
 * PyPI Simple API (PEP 503) provides an HTML index of all packages
 * URL: https://pypi.org/simple/
 */
async function fetchAllPyPIPackages(): Promise<string[]> {
  const packages = new Set<string>();
  
  console.log("Fetching all PyPI package names from Simple API...");
  console.log("This may take a few seconds due to rate limiting...\n");

  try {
    // PyPI Simple API endpoint
    const simpleApiUrl = "https://pypi.org/simple/";
    
    console.log(`Fetching: ${simpleApiUrl}`);
    const response = await fetchWithRetry(simpleApiUrl);
    const html = await response.text();
    
    // Parse HTML to extract package names
    // The Simple API returns HTML with links like: <a href="/simple/{package}/">
    const packageRegex = /href="\/simple\/([^\/"]+)\/"/g;
    let match;
    let count = 0;

    while ((match = packageRegex.exec(html)) !== null) {
      const packageName = match[1];
      // Decode HTML entities (e.g., &#45; becomes -)
      const decoded = packageName
        .replace(/&#45;/g, "-")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&");
      
      packages.add(decoded);
      count += 1;
      
      // Progress update every 10000 packages
      if (count % 10000 === 0) {
        console.log(`  Parsed ${count.toLocaleString()} package links...`);
      }
    }

    console.log(`\n✓ Found ${packages.size.toLocaleString()} unique packages (parsed ${count.toLocaleString()} links)`);
    
    // Convert to sorted array
    const packageArray = Array.from(packages).sort();
    
    return packageArray;
  } catch (err) {
    console.error("Error fetching packages:", err);
    throw err;
  }
}

async function main(): Promise<void> {
  try {
    const projectRoot = getProjectRoot();
    const outputPath = path.join(projectRoot, "data", "popular.json");
    const outputDir = path.dirname(outputPath);
    
    // Ensure data directory exists
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    console.log("=".repeat(60));
    console.log("Downloading All PyPI Package Names");
    console.log("=".repeat(60));
    console.log();

    const startTime = Date.now();
    
    // Fetch all packages
    const packages = await fetchAllPyPIPackages();
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✓ Fetch completed in ${elapsed} seconds`);
    console.log(`✓ Total packages: ${packages.length.toLocaleString()}`);

    // Save to file
    console.log(`\nSaving to: ${outputPath}`);
    writeFileSync(outputPath, JSON.stringify(packages, null, 2), "utf-8");
    
    // Calculate file size
    const stats = statSync(outputPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    const sizeKB = (stats.size / 1024).toFixed(2);
    
    console.log(`✓ File saved successfully`);
    
    if (stats.size < 1024 * 1024) {
      console.log(`✓ File size: ${sizeKB} KB`);
    } else {
      console.log(`✓ File size: ${sizeMB} MB`);
    }
    
    if (stats.size > 100 * 1024 * 1024) {
      console.warn(`\n⚠️  WARNING: File size (${sizeMB} MB) exceeds GitHub's 100MB limit!`);
      console.warn("   Consider using Git LFS or splitting the file.");
    } else {
      console.log(`\n✓ File size is within GitHub's 100MB limit`);
    }

    // Show sample of packages
    console.log("\nSample packages (first 10):");
    packages.slice(0, 10).forEach(function (pkg, idx) {
      console.log(`  ${idx + 1}. ${pkg}`);
    });

    console.log("\n" + "=".repeat(60));
    console.log("Done!");
    console.log("=".repeat(60));
  } catch (err) {
    console.error("\n✗ Error:", err);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  void main();
}

