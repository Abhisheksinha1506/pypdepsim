import { NextRequest, NextResponse } from "next/server";
import { getReverseDeps } from "@/lib/similar";

// Fetch dependents_count from Libraries.io API if available
async function getDependentsCountFromLibrariesIO(pkg: string): Promise<number | null> {
  const apiKey = process.env.LIBRARIES_IO_API_KEY;
  if (!apiKey) return null;
  
  try {
    const url = `https://libraries.io/api/pypi/${encodeURIComponent(pkg.toLowerCase())}?api_key=${apiKey}`;
    // Use 'no-store' to disable Next.js data cache (2MB limit)
    // Caching is handled via in-memory LRU cache in lib/pypi.ts
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    
    const data = await res.json() as { dependents_count?: number };
    return data.dependents_count ?? null;
  } catch {
    return null;
  }
}

export async function GET(_request: NextRequest, context: { params: Promise<{ pkg: string }> }) {
  try {
    const { pkg } = await context.params;
    const set = await getReverseDeps(pkg);
    const list = Array.from(set);
    
    // If we don't have reverse dependencies from CSV/API list, try to get count from Libraries.io API
    let count = list.length;
    if (count === 0) {
      const apiCount = await getDependentsCountFromLibrariesIO(pkg);
      if (apiCount !== null) {
        count = apiCount;
      }
    }
    
    return NextResponse.json({ pkg, dependents: list, count }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch reverse deps" }, { status: 500 });
  }
}

