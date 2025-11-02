import { NextRequest, NextResponse } from "next/server";
import { fetchPackageMeta, pickLatestDependencies } from "@/lib/pypi";
import { fetchDownloadStats } from "@/lib/pypi-stats";
import { getPackageMetadata } from "@/lib/packages-metadata";

export async function GET(_request: NextRequest, context: { params: Promise<{ pkg: string }> }) {
  try {
    const { pkg } = await context.params;
    
    // Try to get from pre-downloaded metadata first (fast lookup)
    const cachedMeta = getPackageMetadata(pkg);
    
    if (cachedMeta) {
      // Use cached metadata, but still fetch full dependencies list and keywords from API
      // (since we only store count in cache, not full list)
      const fullMeta = await fetchPackageMeta(pkg).catch(function () { return null; });
      const dependencies = fullMeta ? pickLatestDependencies(fullMeta) : [];
      const info = fullMeta?.info || {};
      const keywords = Array.isArray(info.keywords) 
        ? info.keywords 
        : (info.keywords ? info.keywords.split(",").map(function (k: string) { return k.trim(); }) : []);
      
      return NextResponse.json({
        name: cachedMeta.name,
        description: cachedMeta.description || info.summary || "",
        latest: cachedMeta.latest,
        dependencies: dependencies,
        keywords: keywords,
        repository: cachedMeta.repository,
        downloads: cachedMeta.downloads,
      }, { status: 200, headers: { "Cache-Control": "public, max-age=3600" } });
    }
    
    // Fallback to live API if not in cache
    const meta = await fetchPackageMeta(pkg);
    const latestDeps = pickLatestDependencies(meta);
    const info = meta?.info || {};
    
    // Fetch download stats in parallel (non-blocking)
    const downloadStatsPromise = fetchDownloadStats(pkg).catch(function () {
      return null;
    });
    
    const body = {
      name: info.name || pkg,
      description: info.summary || "",
      latest: info.version || null,
      dependencies: latestDeps,
      keywords: Array.isArray(info.keywords) ? info.keywords : (info.keywords ? info.keywords.split(",").map(function (k: string) { return k.trim(); }) : []),
      repository: info.project_urls?.Repository || info.project_urls?.Homepage || info.home_page || null,
      downloads: await downloadStatsPromise,
    };
    return NextResponse.json(body, { status: 200, headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch package meta" }, { status: 500 });
  }
}

