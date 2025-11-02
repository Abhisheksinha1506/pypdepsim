import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, readFileSync, existsSync } from "fs";
import path from "path";

const CONFIG_FILE = path.join(process.cwd(), ".env.local");
const LIBRARIES_IO_API_KEY = "LIBRARIES_IO_API_KEY";

// Validate Libraries.io API key by making a test request
async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const testUrl = `https://libraries.io/api/pypi/requests/dependents?api_key=${encodeURIComponent(apiKey)}&per_page=1`;
    const response = await fetch(testUrl);
    
    // 200 OK means valid key
    if (response.ok) {
      return true;
    }
    
    // 401 Unauthorized means invalid key
    if (response.status === 401) {
      return false;
    }
    
    // Other errors might be temporary - consider valid but log warning
    console.warn("Libraries.io API validation returned status:", response.status);
    return true;
  } catch (err) {
    console.error("Error validating Libraries.io API key:", (err as Error).message);
    return false;
  }
}

// Read API key from .env.local file
function readApiKey(): string | null {
  if (!existsSync(CONFIG_FILE)) {
    return null;
  }
  
  try {
    const content = readFileSync(CONFIG_FILE, "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      const match = line.match(new RegExp(`^${LIBRARIES_IO_API_KEY}=(.+)$`));
      if (match) {
        return match[1].trim().replace(/^["']|["']$/g, ""); // Remove quotes if present
      }
    }
  } catch {
    // File read failed
  }
  
  return null;
}

// Write API key to .env.local file
function writeApiKey(apiKey: string): void {
  let content = "";
  if (existsSync(CONFIG_FILE)) {
    content = readFileSync(CONFIG_FILE, "utf-8");
  }
  
  const lines = content.split("\n");
  let found = false;
  
  // Update existing key or add new line
  const updatedLines = lines.map(function (line) {
    if (line.match(new RegExp(`^${LIBRARIES_IO_API_KEY}=`))) {
      found = true;
      return `${LIBRARIES_IO_API_KEY}=${apiKey}`;
    }
    return line;
  });
  
  if (!found) {
    // Add new key at the end
    updatedLines.push(`${LIBRARIES_IO_API_KEY}=${apiKey}`);
  }
  
  // Remove trailing empty lines and add one newline
  const finalContent = updatedLines.filter(function (line, idx) {
    return idx < updatedLines.length - 1 || line.trim() !== "";
  }).join("\n") + "\n";
  
  writeFileSync(CONFIG_FILE, finalContent);
}

// GET: Check if API key is configured
export async function GET(): Promise<NextResponse> {
  try {
    const apiKey = readApiKey();
    const envKey = process.env.LIBRARIES_IO_API_KEY;
    
    // Check both .env.local and environment variables
    const configured = !!(apiKey || envKey);
    
    return NextResponse.json({
      configured: configured,
      hasKey: configured,
      source: apiKey ? "file" : envKey ? "env" : "none",
    }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: "Failed to check API key configuration" }, { status: 500 });
  }
}

// POST: Store API key
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const apiKey = body.apiKey || body.key;
    
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim() === "") {
      return NextResponse.json({ error: "API key is required" }, { status: 400 });
    }
    
    // Validate API key
    const isValid = await validateApiKey(apiKey.trim());
    if (!isValid) {
      return NextResponse.json({ error: "Invalid API key. Please check your Libraries.io API key." }, { status: 400 });
    }
    
    // Store API key in .env.local
    writeApiKey(apiKey.trim());
    
    // Also set in environment for current process (won't persist after restart)
    process.env.LIBRARIES_IO_API_KEY = apiKey.trim();
    
    return NextResponse.json({
      success: true,
      message: "API key configured successfully",
    }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: "Failed to store API key" }, { status: 500 });
  }
}

// DELETE: Remove API key
export async function DELETE(): Promise<NextResponse> {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return NextResponse.json({ success: true, message: "No API key configured" }, { status: 200 });
    }
    
    const content = readFileSync(CONFIG_FILE, "utf-8");
    const lines = content.split("\n");
    const updatedLines = lines.filter(function (line) {
      return !line.match(new RegExp(`^${LIBRARIES_IO_API_KEY}=`));
    });
    
    // Write back without the API key line
    writeFileSync(CONFIG_FILE, updatedLines.join("\n") + "\n");
    
    // Clear from environment
    delete process.env.LIBRARIES_IO_API_KEY;
    
    return NextResponse.json({
      success: true,
      message: "API key removed successfully",
    }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: "Failed to remove API key" }, { status: 500 });
  }
}

