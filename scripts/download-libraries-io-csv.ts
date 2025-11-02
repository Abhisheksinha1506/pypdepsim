/* eslint-disable no-console */
import { existsSync, mkdirSync, statSync, createWriteStream, unlinkSync, createReadStream } from "fs";
import { createGunzip } from "zlib";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { ReadableStream as WebReadableStream } from "stream/web";
import path from "path";

// Libraries.io data dump URLs
// Note: Libraries.io provides monthly data dumps at https://libraries.io/data
// The exact URL may vary, but typically includes repository-dependencies CSV
const LIBRARIES_IO_DATA_BASE = "https://zenodo.org/api/records" as const;
const LIBRARIES_IO_CSV_PATTERN = /repository-dependencies.*\.csv\.gz$/i;

interface ZenodoRecord {
  files?: Array<{ filename: string; links: { download: string } }>;
  metadata?: { title?: string; version?: string };
}

// Helper function to get project root
function getProjectRoot(): string {
  const cwd = process.cwd();
  const dataPath = path.join(cwd, "data", "libraries-io");
  if (existsSync(dataPath) || existsSync(path.join(cwd, "data"))) {
    return cwd;
  }
  try {
    const parentPath = path.resolve(cwd, "..", "data", "libraries-io");
    if (existsSync(parentPath) || existsSync(path.resolve(cwd, "..", "data"))) {
      return path.resolve(cwd, "..");
    }
  } catch {
    // Continue
  }
  return cwd;
}

// Alternative: Direct download from Libraries.io data page (if available)
// Fallback: Use a known Libraries.io data dump URL
async function findLatestCSVUrl(): Promise<string | null> {
  try {
    // Try to fetch from Libraries.io data page
    // Libraries.io may provide direct download links
    const dataPageUrl = "https://libraries.io/data";
    
    // Alternative approach: Search Zenodo for Libraries.io datasets
    // Libraries.io publishes datasets on Zenodo
    const searchUrl = `${LIBRARIES_IO_DATA_BASE}?q=libraries.io&type=dataset&sort=mostrecent&size=10`;
    
    try {
      const response = await fetch(searchUrl);
      if (!response.ok) {
        throw new Error(`Zenodo API returned ${response.status}`);
      }
      
      const data = await response.json();
      const hits = (data as { hits?: { hits?: ZenodoRecord[] } })?.hits?.hits || [];
      
      // Find the latest Libraries.io dataset with repository-dependencies CSV
      for (const record of hits) {
        const files = record.files || [];
        for (const file of files) {
          if (LIBRARIES_IO_CSV_PATTERN.test(file.filename)) {
            console.log(`Found CSV in dataset: ${record.metadata?.title || "Unknown"} (${record.metadata?.version || "Unknown"})`);
            return file.links.download;
          }
        }
      }
    } catch (zenodoError) {
      console.warn("Could not fetch from Zenodo, trying direct URL approach:", (zenodoError as Error).message);
    }
    
    // Fallback: Try known Libraries.io data dump patterns
    // Note: These URLs may need to be updated based on Libraries.io's current structure
    const knownPatterns = [
      "https://zenodo.org/record/123456/files/repository-dependencies.csv.gz", // Placeholder
    ];
    
    // For now, return null and let the user know they need to provide the URL
    return null;
  } catch (err) {
    console.error("Error finding CSV URL:", (err as Error).message);
    return null;
  }
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  console.log(`Downloading from: ${url}`);
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  const contentLength = response.headers.get("content-length");
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
  let downloadedBytes = 0;
  
  if (!response.body) {
    throw new Error("Response body is null");
  }
  
  const writeStream = createWriteStream(outputPath);
  
  // Handle .gz files: pipe through gunzip
  if (url.endsWith(".gz")) {
    const gunzip = createGunzip();
    // Convert Web ReadableStream to Node.js Readable stream
    // Cast to Web Streams API ReadableStream type
    const nodeStream = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
    await pipeline(nodeStream, gunzip, writeStream);
  } else {
    // Non-compressed file
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        downloadedBytes += value.length;
        if (totalBytes > 0) {
          const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
          process.stdout.write(`\rProgress: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(2)} MB / ${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
        }
        
        await new Promise<void>(function (resolve, reject) {
          writeStream.write(value, function (err) {
            if (err) reject(err);
            else resolve();
          });
        });
      }
      console.log(); // New line after progress
    } finally {
      reader.releaseLock();
    }
    
    writeStream.end();
  }
  
  console.log(`Downloaded to: ${outputPath}`);
}

async function main(): Promise<void> {
  const projectRoot = getProjectRoot();
  const dataDir = path.join(projectRoot, "data", "libraries-io");
  
  // Create data directory if it doesn't exist
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    console.log(`Created directory: ${dataDir}`);
  }
  
  // Check for CSV URL from environment variable (allows manual override)
  const manualUrl = process.env.LIBRARIES_IO_CSV_URL;
  let csvUrl: string | null = null;
  
  if (manualUrl) {
    console.log(`Using manual CSV URL from environment: ${manualUrl}`);
    csvUrl = manualUrl;
  } else {
    console.log("Searching for latest Libraries.io CSV dump...");
    csvUrl = await findLatestCSVUrl();
  }
  
  if (!csvUrl) {
    console.error("\n❌ Could not automatically find CSV URL.");
    console.error("\nTo download manually:");
    console.error("1. Visit https://libraries.io/data");
    console.error("2. Find the 'repository-dependencies' CSV file");
    console.error("3. Download it and run:");
    console.error(`   LIBRARIES_IO_CSV_URL=<your-url> npm run download-csv`);
    console.error("\nOr set LIBRARIES_IO_CSV_URL environment variable:");
    console.error('   export LIBRARIES_IO_CSV_URL="https://zenodo.org/record/XXXXXX/files/repository-dependencies.csv.gz"');
    process.exit(1);
  }
  
  const filename = csvUrl.split("/").pop() || "repository-dependencies.csv.gz";
  const compressedPath = path.join(dataDir, filename);
  const decompressedPath = csvUrl.endsWith(".gz") 
    ? path.join(dataDir, filename.replace(".gz", ""))
    : compressedPath;
  
  // Check if file already exists
  if (existsSync(decompressedPath)) {
    const stats = statSync(decompressedPath);
    const ageDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
    
    if (ageDays < 30) {
      console.log(`✓ CSV file already exists (${ageDays.toFixed(1)} days old): ${decompressedPath}`);
      console.log("Skipping download. Delete the file to force re-download.");
      process.exit(0);
    } else {
      console.log(`⚠ CSV file is ${ageDays.toFixed(1)} days old. Re-downloading...`);
    }
  }
  
  try {
    // Download compressed file
    if (csvUrl.endsWith(".gz")) {
      await downloadFile(csvUrl, compressedPath);
      
      // Decompress
      console.log("Decompressing file...");
      const readStream = createReadStream(compressedPath);
      const gunzip = createGunzip();
      const writeStream = createWriteStream(decompressedPath);
      
      await pipeline(readStream, gunzip, writeStream);
      console.log(`Decompressed to: ${decompressedPath}`);
      
      // Optionally remove compressed file to save space
      const keepCompressed = process.env.KEEP_COMPRESSED === "true";
      if (!keepCompressed) {
        unlinkSync(compressedPath);
        console.log("Removed compressed file to save space.");
      }
    } else {
      await downloadFile(csvUrl, decompressedPath);
    }
    
    const stats = statSync(decompressedPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`\n✓ Download complete!`);
    console.log(`  File: ${decompressedPath}`);
    console.log(`  Size: ${sizeMB} MB`);
    console.log(`\nNext step: Run the CSV parser to build reverse dependencies cache.`);
  } catch (err) {
    console.error("\n❌ Download failed:", (err as Error).message);
    process.exit(1);
  }
}

main().catch(function (e) {
  console.error("Fatal error:", e);
  process.exit(1);
});

