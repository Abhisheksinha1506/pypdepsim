import { NextRequest } from "next/server";
import { LRUCache } from "lru-cache";
import { computeSimilarOnDemand, getPrecomputedSimilar, computeCooccurrence } from "@/lib/similar";
import { PROGRESSIVE_REFINEMENT_CONFIG, QUALITY_THRESHOLDS, LIMITS_CONFIG } from "@/lib/config";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ pkg: string }> }
) {
  // Simple in-memory cache to avoid recomputing similar results repeatedly within TTL
  // Keyed by pkg + limit to keep semantics clear
  const cache: LRUCache<string, { similar: unknown[]; cooccur: unknown[] }> = (globalThis as never as { __similarCache?: LRUCache<string, { similar: unknown[]; cooccur: unknown[] }> }).__similarCache
    || new LRUCache<string, { similar: unknown[]; cooccur: unknown[] }>({ max: 1000, ttl: 15 * 60 * 1000 });
  (globalThis as never as { __similarCache?: LRUCache<string, { similar: unknown[]; cooccur: unknown[] }> }).__similarCache = cache;

  const { pkg } = await context.params;
  if (!pkg || typeof pkg !== "string") {
    return Response.json({ error: "Invalid package name" }, { status: 400 });
  }

  try {
    const urlLimit = Number(new URL(request.url).searchParams.get("limit")) || 20;
    const limit = Math.max(1, Math.min(100, urlLimit));
    const urlNocache = new URL(request.url).searchParams.get("nocache");
    const nocache = urlNocache === "1"; // Only bypass if explicitly requested
    const cacheKey = "pypi:" + pkg.toLowerCase() + "::" + String(limit);
    
    // Check in-memory cache first (unless nocache is explicitly set)
    if (!nocache) {
      const cachedResp = cache.get(cacheKey);
      if (cachedResp) {
        // Ensure both fields exist (backward compatibility for old cache entries)
        const response = { similar: cachedResp.similar || [], cooccur: cachedResp.cooccur || [] };
        return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300, s-maxage=300" } });
      }
    }
    
    // Check precomputed cache
    const cached = !nocache ? getPrecomputedSimilar(pkg, limit) : null;
    const qualityOk = function (list: Array<{ jaccard: number }> | null | undefined): boolean {
      if (!list || list.length === 0) return false;
      const topScore = list[0]?.jaccard || 0;
      // Heuristic: at least some breadth and a reasonable top score
      return list.length >= QUALITY_THRESHOLDS.MIN_RESULTS_FOR_QUALITY && topScore >= QUALITY_THRESHOLDS.MIN_TOP_SCORE_FOR_QUALITY;
    };

    let best = cached; // Use precomputed if available
    const start = Date.now();
    const BUDGET_MS = PROGRESSIVE_REFINEMENT_CONFIG.BUDGET_MS;
    
    // Start co-occurrence computation in parallel (independent of similarity)
    const cooccurPromise = computeCooccurrence(pkg, limit, { maxDependentsToScan: PROGRESSIVE_REFINEMENT_CONFIG.INITIAL_MAX_DEPENDENTS_TO_SCAN });
    
    if (!best || !qualityOk(best)) {
      // Initial on-demand attempt with configured limits
      best = await computeSimilarOnDemand(pkg, limit, { 
        restrictToPeerGroup: false, 
        topSearchLimit: LIMITS_CONFIG.DEFAULT_TOP_SEARCH_LIMIT, 
        maxDependentsToScan: PROGRESSIVE_REFINEMENT_CONFIG.INITIAL_MAX_DEPENDENTS_TO_SCAN, 
        maxLiveCandidates: PROGRESSIVE_REFINEMENT_CONFIG.INITIAL_MAX_LIVE_CANDIDATES 
      });
    }

    // Progressive refinement if results are weak; escalate scan limits
    if (!qualityOk(best)) {
      const attempts = PROGRESSIVE_REFINEMENT_CONFIG.REFINEMENT_STEPS;
      for (const step of attempts) {
        if (Date.now() - start > BUDGET_MS) break;
        const next = await computeSimilarOnDemand(pkg, limit, { 
          restrictToPeerGroup: false, 
          topSearchLimit: LIMITS_CONFIG.DEFAULT_TOP_SEARCH_LIMIT, 
          maxDependentsToScan: step.maxDependentsToScan, 
          maxLiveCandidates: step.maxLiveCandidates 
        });
        // Prefer the list with the higher top score
        const bestTop = best && best.length > 0 ? best[0].jaccard : 0;
        const nextTop = next && next.length > 0 ? next[0].jaccard : 0;
        if (nextTop > bestTop || (next?.length || 0) > (best?.length || 0)) {
          best = next;
        }
        if (qualityOk(best)) break;
      }
    }

    // Wait for co-occurrence to complete
    const cooccur = await cooccurPromise;

    const responseBody = { similar: best || [], cooccur: cooccur || [] };
    
    // Cache the response in-memory for future requests (unless nocache was set)
    if (!nocache) {
      cache.set(cacheKey, responseBody);
    }
    
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300, s-maxage=300" } });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

