import { fetchReverseDependentsApprox, searchTopPackages, fetchPackageMeta, pickLatestDependencies } from "./pypi";
import { jaccardSimilarity } from "./jaccard";
import { loadReverseDepsCache, loadReverseDepsCacheAsync, loadSimilarIndexCache, loadPopularPackages } from "./cache";
import { UI_FRAMEWORKS, isUiFramework } from "./seeds";
import { getDependentsBitset } from "./bitsetCache";
import { jaccardBitset } from "./jaccardBitset";
import {
  SIMILARITY_CONFIG,
  CONCURRENCY_CONFIG,
  LIMITS_CONFIG,
  QUALITY_THRESHOLDS,
  BASE_SIZE_THRESHOLDS,
  DEPS_COUNT_THRESHOLDS,
  EARLY_TERMINATION_CONFIG,
  getJaccardThreshold,
  getBitsetJaccardThreshold,
  getSharedThreshold,
  getRelaxedJaccardThreshold,
  getForwardDepsRatioThreshold,
  getCooccurForwardDepsRatioThreshold,
  getCooccurJaccardThreshold,
} from "./config";

// Normalize Python package name (case-insensitive, normalize separators)
function normalizePackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]/g, "-").toLowerCase();
}

// Timeout utility with dynamic timeout calculation
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage?: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(function (_, reject) {
      setTimeout(function () {
        reject(new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}

// Calculate dynamic timeout based on operation size
function calculateTimeout(operationSize: number, baseTimeout: number, maxTimeout: number): number {
  // Base timeout + proportional increase based on size, capped at maxTimeout
  const multiplier = SIMILARITY_CONFIG.TIMEOUT_MULTIPLIER_PER_ITEM;
  const dynamicTimeout = baseTimeout + Math.min(operationSize * multiplier, maxTimeout - baseTimeout);
  return Math.min(dynamicTimeout, maxTimeout);
}

// Simple concurrency limiter without Node.js-specific APIs
function createLimiter(concurrency: number) {
  let running = 0;
  const queue: Array<() => void> = [];
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise(function (resolve, reject) {
      function run() {
        running += 1;
        fn()
          .then(function (v) {
            running -= 1;
            resolve(v);
            if (queue.length > 0) {
              const next = queue.shift();
              if (next) next();
            }
          })
          .catch(function (e) {
            running -= 1;
            reject(e);
            if (queue.length > 0) {
              const next = queue.shift();
              if (next) next();
            }
          });
      }
      if (running < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

export type SimilarItem = { name: string; jaccard: number; sharedDependents: number };

// Pre-filtering: Check if candidate can possibly meet the minimum threshold
// Calculates maximum possible Jaccard score without computing actual intersection
function canMeetThreshold(candidateSize: number, baseSize: number, minJaccard: number): boolean {
  if (candidateSize === 0 || baseSize === 0) return false;
  
  // Maximum possible intersection is min(candidateSize, baseSize)
  const maxPossibleIntersection = Math.min(candidateSize, baseSize);
  
  // Maximum possible union is candidateSize + baseSize (if no overlap)
  // Minimum possible union is max(candidateSize, baseSize) (if one is subset of other)
  // For max Jaccard calculation, we use minimum union (maximum overlap scenario)
  const minPossibleUnion = Math.max(candidateSize, baseSize);
  
  // Maximum possible Jaccard = maxIntersection / minUnion
  const maxPossibleJaccard = maxPossibleIntersection / minPossibleUnion;
  
  return maxPossibleJaccard >= minJaccard;
}

export async function getReverseDeps(pkg: string): Promise<Set<string>> {
  // Re-enable file-based cache check (30 min effective TTL via file cache)
  // Still fetch live if cache miss for freshness
  const normalized = normalizePackageName(pkg);
  // Use async version to avoid blocking the event loop
  const cache = await loadReverseDepsCacheAsync();
  const cached = cache[normalized] || cache[pkg.toLowerCase()];
  if (Array.isArray(cached) && cached.length > 0) {
    return new Set<string>(cached);
  }
  const live = await fetchReverseDependentsApprox(pkg);
  return new Set<string>(live);
}

export async function computeSimilarOnDemand(
  pkg: string,
  limit: number,
  options?: { restrictToPeerGroup?: boolean; topSearchLimit?: number; maxDependentsToScan?: number; maxLiveCandidates?: number }
): Promise<SimilarItem[]> {
  const t0 = Date.now();
  const base = await getReverseDeps(pkg);
  // Dynamic fallback for packages with no reverse dependencies: use forward dependencies
  if (base.size < 1) {
    try {
      // Strategy: Find packages that share dependencies with the target package
      // This is similar to co-occurrence but for similarity computation
      const meta = await fetchPackageMeta(pkg);
      const pkgDeps = pickLatestDependencies(meta);
      
      if (pkgDeps.length === 0) {
        // If package has no dependencies, fall back to name-based matching
        return computeSimilarNameBasedFallback(pkg, limit);
      }
      
      // Find popular packages that share dependencies with the target package
      const popular = loadPopularPackages();
      const similar = new Map<string, { count: number; sharedDeps: string[] }>();
      const normalizedPkg = normalizePackageName(pkg);
      const pkgDepsSet = new Set<string>(pkgDeps.map(function (d) { return normalizePackageName(d); }));
      
      // Limit how many popular packages to check
      const packagesToCheck = Math.min(popular.length, limit * LIMITS_CONFIG.CANDIDATES_MULTIPLIER_PER_LIMIT, LIMITS_CONFIG.MAX_PACKAGES_TO_CHECK_FORWARD_DEPS);
      const checkLimit = createLimiter(CONCURRENCY_CONFIG.FORWARD_DEPS_CHECK);
      
      const checkTimeout = calculateTimeout(packagesToCheck, SIMILARITY_CONFIG.BASE_TIMEOUT_FORWARD_DEPS_MS, SIMILARITY_CONFIG.MAX_TIMEOUT_FORWARD_DEPS_MS);
      
      try {
        await withTimeout(
          Promise.all(popular.slice(0, packagesToCheck).map(function (candidate) {
            return checkLimit(function () {
              return withTimeout(
                (async function () {
                  try {
                    const normalizedCandidate = normalizePackageName(candidate);
                    if (normalizedCandidate === normalizedPkg) return;
                    
                    const candidateMeta = await fetchPackageMeta(candidate);
                    const candidateDeps = pickLatestDependencies(candidateMeta);
                    const candidateDepsSet = new Set<string>(candidateDeps.map(function (d) { return normalizePackageName(d); }));
                    
                    // Find shared dependencies
                    const sharedDeps: string[] = [];
                    pkgDepsSet.forEach(function (dep) {
                      if (candidateDepsSet.has(dep)) {
                        sharedDeps.push(dep);
                      }
                    });
                    
                    if (sharedDeps.length > 0) {
                      similar.set(candidate, { count: sharedDeps.length, sharedDeps });
                    }
                  } catch {
                    // ignore individual failures
                  }
                })(),
                SIMILARITY_CONFIG.TIMEOUT_PER_FETCH_MS,
                `Fetching metadata for similar candidate ${candidate} timed out`
              );
            });
          })),
          checkTimeout,
          `Similar computation using forward deps timed out after ${checkTimeout}ms`
        );
      } catch (err) {
        // Continue with whatever data we have
        try {
          console.warn(`computeSimilarOnDemand: Forward deps approach timed out for ${pkg}, continuing with ${similar.size} candidates`);
        } catch {
          // ignore logging errors
        }
      }
      
      // Convert to SimilarItem format with Jaccard-like scoring
      const totalDeps = pkgDeps.length;
      if (totalDeps === 0) {
        return computeSimilarNameBasedFallback(pkg, limit);
      }
      
      const results: SimilarItem[] = Array.from(similar.entries())
        .map(function ([name, data]) {
          // Use Jaccard-like score: shared deps / (total unique deps)
          // Since we don't have candidate's total deps, use shared / pkg's total deps
          const score = data.count / totalDeps;
          return { 
            name, 
            jaccard: Number(score.toFixed(6)), 
            sharedDependents: data.count 
          } as SimilarItem;
        })
        .filter(function (r) {
          // Require at least 1 shared dependency and minimum ratio
          const minRatio = getForwardDepsRatioThreshold(totalDeps);
          return r.sharedDependents >= 1 && r.jaccard >= minRatio;
        })
        .sort(function (a, b) {
          // Sort by shared count first, then by jaccard score
          if (b.sharedDependents !== a.sharedDependents) {
            return b.sharedDependents - a.sharedDependents;
          }
          return b.jaccard - a.jaccard;
        })
        .slice(0, limit);
      
      // If we got results, return them
      if (results.length > 0) {
        return results;
      }
      
      // If no results from dependency overlap, fall back to name-based
      return computeSimilarNameBasedFallback(pkg, limit);
    } catch (err) {
      // If all else fails, try name-based fallback
      return computeSimilarNameBasedFallback(pkg, limit);
    }
  }

  // Candidate shortlist
  // Optionally restrict to peer group; otherwise use broad candidates
  // Optimized: Don't load entire cache (139k+ packages), only use popular packages + dependents' dependencies
  const candidates = new Set<string>();
  const restrict = options?.restrictToPeerGroup === true;
  if (restrict && isUiFramework(pkg)) {
    UI_FRAMEWORKS.forEach(function (n) { if (normalizePackageName(n) !== normalizePackageName(pkg)) candidates.add(n); });
  } else {
    // Only use popular packages instead of iterating through entire cache
    const localPopular = loadPopularPackages();
    const topSearchLimit = Math.min(options?.topSearchLimit || LIMITS_CONFIG.DEFAULT_TOP_SEARCH_LIMIT, LIMITS_CONFIG.MAX_TOP_SEARCH_LIMIT);
    const top = localPopular.length > 0
      ? localPopular.slice(0, topSearchLimit)
      : await searchTopPackages(topSearchLimit);
    top.forEach(function (n) { candidates.add(n); });
  }

  // Derive co-occurring dependency candidates from a sample of dependents of the base package
  // Optimized: Add early termination when enough candidates collected
  const MAX_DEPENDENTS_TO_SCAN = Math.min(options?.maxDependentsToScan || LIMITS_CONFIG.DEFAULT_MAX_DEPENDENTS_TO_SCAN, LIMITS_CONFIG.MAX_MAX_DEPENDENTS_TO_SCAN);
  const baseDependents = Array.from(base).slice(0, MAX_DEPENDENTS_TO_SCAN);
  const depLimit = createLimiter(CONCURRENCY_CONFIG.DEPENDENTS_SCAN);
  const MAX_CANDIDATES_TO_COLLECT = LIMITS_CONFIG.MAX_CANDIDATES_TO_COLLECT;
  const EARLY_TERMINATE_CANDIDATES = LIMITS_CONFIG.EARLY_TERMINATE_CANDIDATES;
  
  // Calculate dynamic timeout based on number of dependents to scan
  const dependentsScanTimeout = calculateTimeout(MAX_DEPENDENTS_TO_SCAN, SIMILARITY_CONFIG.BASE_TIMEOUT_DEPENDENTS_SCAN_MS, SIMILARITY_CONFIG.MAX_TIMEOUT_DEPENDENTS_SCAN_MS);
  
  try {
    // Process dependents with early termination
    let processedCount = 0;
    let shouldStopEarly = false;
    
    // Process in batches to allow early termination checks
    const BATCH_SIZE = 20;
    for (let i = 0; i < baseDependents.length && !shouldStopEarly; i += BATCH_SIZE) {
      const batch = baseDependents.slice(i, i + BATCH_SIZE);
      
      await withTimeout(
        Promise.all(batch.map(function (depPkg) {
          return depLimit(function () {
            return withTimeout(
              (async function () {
                try {
                  const meta = await fetchPackageMeta(depPkg);
                  const deps = pickLatestDependencies(meta);
                  for (let j = 0; j < deps.length; j += 1) {
                    const d = deps[j];
                    if (normalizePackageName(d) !== normalizePackageName(pkg)) {
                      candidates.add(d);
                      // Early termination if we have enough candidates
                      if (candidates.size >= EARLY_TERMINATE_CANDIDATES) {
                        shouldStopEarly = true;
                        break;
                      }
                    }
                  }
                  processedCount += 1;
                } catch {
                  // ignore individual failures
                }
              })(),
                SIMILARITY_CONFIG.TIMEOUT_PER_FETCH_MS,
              `Fetching metadata for ${depPkg} timed out`
            );
          });
        })),
        dependentsScanTimeout,
        `Scanning dependents for candidates timed out after ${dependentsScanTimeout}ms`
      );
      
      // Check if we should stop early
      if (candidates.size >= EARLY_TERMINATE_CANDIDATES) {
        shouldStopEarly = true;
        break;
      }
    }
  } catch (err) {
    // If timeout occurs, continue with whatever candidates we have so far
    // Log but don't fail the entire operation
    try {
      console.warn(`computeSimilarOnDemand: Candidate collection timed out for ${pkg}, continuing with ${candidates.size} candidates`);
    } catch {
      // ignore logging errors
    }
  }
  
  // Limit candidates to maximum if we collected more
  if (candidates.size > MAX_CANDIDATES_TO_COLLECT) {
    const candidateArray = Array.from(candidates);
    candidates.clear();
    candidateArray.slice(0, MAX_CANDIDATES_TO_COLLECT).forEach(function (c) {
      candidates.add(c);
    });
  }

  // Load cache lazily only when needed for candidate evaluation (not during collection)
  // This avoids loading the entire cache (139k+ packages) when we only need popular packages
  // Use async version to avoid blocking the event loop
  const cache = await loadReverseDepsCacheAsync();

  // Bounded top-K structure (min-heap by jaccard)
  const heap: SimilarItem[] = [];
  function heapSwap(i: number, j: number): void {
    const t = heap[i];
    heap[i] = heap[j];
    heap[j] = t;
  }
  function heapSiftUp(i: number): void {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (heap[p].jaccard <= heap[i].jaccard) break;
      heapSwap(i, p);
      i = p;
    }
  }
  function heapSiftDown(i: number): void {
    const n = heap.length;
    while (true) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && heap[l].jaccard < heap[m].jaccard) m = l;
      if (r < n && heap[r].jaccard < heap[m].jaccard) m = r;
      if (m === i) break;
      heapSwap(i, m);
      i = m;
    }
  }
  function heapPushBounded(item: SimilarItem): void {
    if (heap.length < limit) {
      heap.push(item);
      heapSiftUp(heap.length - 1);
      return;
    }
    if (limit <= 0) return;
    if (heap[0].jaccard >= item.jaccard) return;
    heap[0] = item;
    heapSiftDown(0);
  }
  const MAX_LIVE_CANDIDATES = Math.min(options?.maxLiveCandidates || LIMITS_CONFIG.DEFAULT_MAX_LIVE_CANDIDATES, LIMITS_CONFIG.MAX_MAX_LIVE_CANDIDATES);
  let liveFetches = 0;
  const candLimit = createLimiter(CONCURRENCY_CONFIG.CANDIDATES_EVALUATION);

  // Try bitset for base once
  const baseBitset = await getDependentsBitset(pkg);

  // Limit candidate evaluation to prevent excessive computation
  // Evaluate popular packages first, then packages with similar reverse dep counts
  const allCandidates = Array.from(candidates);
  const popular = loadPopularPackages();
  const popularSet = new Set(popular.map(function (p) { return normalizePackageName(p); }));
  // Reuse the cache variable loaded earlier (line 338) instead of loading again
  const baseSize = base.size;
  
  // Sort candidates by priority: 1) Popular packages, 2) Similar size packages, 3) Others
  const sortedCandidates = allCandidates.sort(function (a, b) {
    const aNorm = normalizePackageName(a);
    const bNorm = normalizePackageName(b);
    const aPopular = popularSet.has(aNorm);
    const bPopular = popularSet.has(bNorm);
    
    // Priority 1: Popular packages first
    if (aPopular && !bPopular) return -1;
    if (!aPopular && bPopular) return 1;
    
    // Priority 2: Packages with similar reverse dep counts (if both are popular or both are not)
    const aDeps = (cache[aNorm] || cache[a.toLowerCase()] || []) as string[];
    const bDeps = (cache[bNorm] || cache[b.toLowerCase()] || []) as string[];
    const aSize = aDeps.length;
    const bSize = bDeps.length;
    const aDiff = Math.abs(aSize - baseSize);
    const bDiff = Math.abs(bSize - baseSize);
    
    // Prefer candidates with reverse deps count closer to base size
    if (aSize > 0 && bSize > 0 && aDiff !== bDiff) {
      return aDiff - bDiff;
    }
    
    // Priority 3: Prefer candidates with some reverse deps over none
    if (aSize > 0 && bSize === 0) return -1;
    if (aSize === 0 && bSize > 0) return 1;
    
    return 0;
  });
  
  // Limit to reasonable number of candidates to evaluate (e.g., 5000 max)
  // This prevents evaluating 140k+ candidates which takes forever
  const MAX_CANDIDATES_TO_EVALUATE = Math.min(5000, allCandidates.length);
  const candArray = sortedCandidates.slice(0, MAX_CANDIDATES_TO_EVALUATE);
  
  // Calculate dynamic timeout based on number of candidates
  const candidatesScanTimeout = calculateTimeout(candArray.length, SIMILARITY_CONFIG.BASE_TIMEOUT_CANDIDATES_SCAN_MS, SIMILARITY_CONFIG.MAX_TIMEOUT_CANDIDATES_SCAN_MS);
  
  // Early termination configuration
  const MIN_CHECKED = limit * EARLY_TERMINATION_CONFIG.MIN_CHECKED_MULTIPLIER;
  const BATCH_SIZE = EARLY_TERMINATION_CONFIG.BATCH_SIZE;
  const MIN_SCORE_FOR_EARLY_EXIT = EARLY_TERMINATION_CONFIG.MIN_SCORE_FOR_EARLY_EXIT;
  let checkedCount = 0;
  let shouldEarlyExit = false;
  
  // Function to check if we should early exit
  function checkEarlyExit(): boolean {
    if (heap.length < limit) return false;
    if (checkedCount < MIN_CHECKED) return false;
    const minScore = heap.length > 0 ? heap[0].jaccard : 0;
    return minScore >= MIN_SCORE_FOR_EARLY_EXIT;
  }
  
  // Helper to evaluate a single candidate
  const evaluateCandidate = function (cand: string): Promise<void> {
    return candLimit(function () {
      return withTimeout(
        (async function () {
              const normalizedCand = normalizePackageName(cand);
              const normalizedPkg = normalizePackageName(pkg);
              if (normalizedCand === normalizedPkg) return;
              // Prefer cache
              const normalizedCandCache = normalizePackageName(cand);
              let depSet = new Set<string>(cache[normalizedCandCache] || cache[cand.toLowerCase()] || []);
              
              // If no cached set, try bitset path first
              let usedScore = 0;
              let usedShared = 0;

              if (depSet.size === 0 && baseBitset && baseBitset.length > 0) {
                try {
                  const candBitset = await getDependentsBitset(cand);
                  if (candBitset && candBitset.length > 0) {
                    const scoreBs = jaccardBitset(baseBitset, candBitset);
                    // Quality threshold: adaptive based on base size (bitset path doesn't have shared count)
                      const minJaccardBs = getBitsetJaccardThreshold(base.size);
                    if (scoreBs >= minJaccardBs) {
                      usedScore = Number(scoreBs.toFixed(6));
                      usedShared = 0; // unknown with bitset-only path
                      heapPushBounded({ name: cand, jaccard: usedScore, sharedDependents: usedShared });
                      return;
                    }
                  }
                } catch {
                  // ignore bitset fetch failures
                }
              }

              // Fallback to live fetch of reverse dependents if allowed
              if (depSet.size === 0 && liveFetches < MAX_LIVE_CANDIDATES) {
                try {
                  const live = await fetchReverseDependentsApprox(cand);
                  depSet = new Set<string>(live);
                  liveFetches += 1;
                } catch {
                  // ignore fetch failures, continue with empty set
                }
              }
              if (depSet.size === 0) return;
              
              // Pre-filtering: Skip candidates that can't possibly meet threshold
              const minShared = getSharedThreshold(base.size);
              const minJaccard = getJaccardThreshold(base.size);
              if (!canMeetThreshold(depSet.size, base.size, minJaccard)) {
                return; // Skip candidate - can't possibly meet threshold
              }
              
              const jr = jaccardSimilarity(base, depSet);
              
              // Track checked count for early termination (after Jaccard calculation)
              checkedCount += 1;
              
              // Quality threshold: adaptive based on base size
              if (jr.score >= minJaccard && jr.shared >= minShared) {
                heapPushBounded({ name: cand, jaccard: Number(jr.score.toFixed(6)), sharedDependents: jr.shared });
              }
            })(),
            SIMILARITY_CONFIG.TIMEOUT_PER_CANDIDATE_MS,
            `Evaluating candidate ${cand} timed out`
          );
        });
  };
  
  // Process candidates in batches for early termination
  try {
    for (let i = 0; i < candArray.length && !shouldEarlyExit; i += BATCH_SIZE) {
      const batch = candArray.slice(i, i + BATCH_SIZE);
      
      // Process batch
      await Promise.all(batch.map(evaluateCandidate));
      
      // Check if we should early exit after this batch
      if (checkEarlyExit()) {
        shouldEarlyExit = true;
        break;
      }
    }
  } catch (err) {
    // If timeout occurs, continue with whatever results we have so far
    try {
      console.warn(`computeSimilarOnDemand: Candidate evaluation timed out for ${pkg}, continuing with ${heap.length} results`);
    } catch {
      // ignore logging errors
    }
  }
  // Drain heap to sorted array desc
  let results = heap.slice(0).sort(function (a, b) { return b.jaccard - a.jaccard; });
  // Final dynamic fallback: if empty, try progressively relaxed strategies
  if (results.length === 0) {
    // Strategy 1: Cache-only pass with relaxed thresholds
    const alt: SimilarItem[] = [];
    // Limit fallback evaluation too (evaluate max 2000 candidates from the sorted list)
    const MAX_FALLBACK_CANDIDATES = Math.min(2000, sortedCandidates.length);
    const candArray2 = sortedCandidates.slice(0, MAX_FALLBACK_CANDIDATES);
    for (let i = 0; i < candArray2.length; i += 1) {
      const cand = candArray2[i];
      const normalizedCand = normalizePackageName(cand);
      const normalizedPkg = normalizePackageName(pkg);
      if (normalizedCand === normalizedPkg) continue;
      const depSetArr = cache[normalizedCand] || cache[cand.toLowerCase()];
      if (!Array.isArray(depSetArr) || depSetArr.length === 0) continue;
      const depSet = new Set<string>(depSetArr);
      const jr = jaccardSimilarity(base, depSet);
      // Dynamically relax threshold based on base size
      const relaxedThreshold = getRelaxedJaccardThreshold(base.size);
      if (jr.score >= relaxedThreshold && jr.shared > 0) {
        alt.push({ name: cand, jaccard: Number(jr.score.toFixed(6)), sharedDependents: jr.shared });
      }
    }
    alt.sort(function (a, b) { return b.jaccard - a.jaccard; });
    results = alt.slice(0, limit);
    
    // Strategy 2: If still empty and base is small, try name-based similarity
    if (results.length === 0 && base.size > 0 && base.size < BASE_SIZE_THRESHOLDS.SMALL) {
      const popular = loadPopularPackages();
      const lower = normalizePackageName(pkg);
      const nameParts = lower.split(/[-_.\/]/);
      const mainName = nameParts[0] || lower;
      
      const nameBased: SimilarItem[] = [];
      for (let i = 0; i < Math.min(popular.length, LIMITS_CONFIG.MAX_POPULAR_FOR_NAME_BASED); i += 1) {
        const pop = popular[i];
        const normalizedPop = normalizePackageName(pop);
        if (normalizedPop === lower) continue;
        const popLower = normalizedPop;
        const popParts = popLower.split(/[-_.\/]/);
        const popMain = popParts[0] || popLower;
        
        // Check for similar names (Python doesn't use @ scopes)
        if (popMain === mainName || popLower.includes(mainName) || lower.includes(popMain)) {
          nameBased.push({ name: pop, jaccard: QUALITY_THRESHOLDS.NAME_BASED_FALLBACK_SCORE, sharedDependents: 0 });
        }
        
        if (nameBased.length >= limit) break;
      }
      
      if (nameBased.length > 0) {
        results = nameBased.slice(0, limit);
      }
    }
  }
  const t1 = Date.now();
  try {
    console.log("similar:onDemand", {
      pkg,
      baseDependents: base.size,
      candidates: candidates.size,
      liveFetches,
      results: results.length,
      ms: t1 - t0,
    });
    if (results.length === 0 && candidates.size > 0) {
      console.warn(`No similar packages found for ${pkg} despite ${candidates.size} candidates. Base size: ${base.size}`);
    }
  } catch {
    // ignore logging errors
  }
  return results;
}

export async function computeCooccurrence(
  pkg: string,
  limit: number,
  options?: { maxDependentsToScan?: number }
): Promise<SimilarItem[]> {
  const base = await getReverseDeps(pkg);
  
  // Strategy 1: If we have reverse dependencies, use the traditional approach
  if (base.size > 0) {
    return await computeCooccurrenceFromReverseDeps(pkg, limit, base, options);
  }
  
  // Strategy 2: Dynamic approach using forward dependencies (package's own dependencies)
  // This works even when reverse dependencies are unavailable
  return await computeCooccurrenceFromForwardDeps(pkg, limit);
}

// Traditional co-occurrence computation using reverse dependencies
// Optimized: Add early termination, batch processing, and limit dependents scanning
async function computeCooccurrenceFromReverseDeps(
  pkg: string,
  limit: number,
  base: Set<string>,
  options?: { maxDependentsToScan?: number }
): Promise<SimilarItem[]> {
  const MAX_DEPENDENTS_TO_SCAN = Math.min(options?.maxDependentsToScan || LIMITS_CONFIG.DEFAULT_MAX_DEPENDENTS_TO_SCAN, LIMITS_CONFIG.MAX_MAX_DEPENDENTS_TO_SCAN);
  const baseDependents = Array.from(base).slice(0, MAX_DEPENDENTS_TO_SCAN);
  const cooccur = new Map<string, number>();
  const baseSize = base.size || 1;
  
  const depLimit = createLimiter(CONCURRENCY_CONFIG.DEPENDENTS_SCAN);
  let successfulFetches = 0;
  
  // Early termination configuration: stop when we have enough co-occurrences
  // Need roughly limit * multiplier to have good quality results after filtering
  const MIN_COOCCUR_FOR_EARLY_EXIT = limit * 3;
  const BATCH_SIZE = 20;
  let shouldStopEarly = false;
  
  // Calculate dynamic timeout based on number of dependents to scan
  const cooccurTimeout = calculateTimeout(MAX_DEPENDENTS_TO_SCAN, SIMILARITY_CONFIG.BASE_TIMEOUT_DEPENDENTS_SCAN_MS, SIMILARITY_CONFIG.MAX_TIMEOUT_DEPENDENTS_SCAN_MS);
  
  try {
    // Process in batches to allow early termination checks
    for (let i = 0; i < baseDependents.length && !shouldStopEarly; i += BATCH_SIZE) {
      const batch = baseDependents.slice(i, i + BATCH_SIZE);
      
      await withTimeout(
        Promise.all(batch.map(function (depPkg) {
          return depLimit(function () {
            return withTimeout(
              (async function () {
                try {
                  const meta = await fetchPackageMeta(depPkg);
                  successfulFetches += 1;
                  const deps = pickLatestDependencies(meta);
                  const normalizedPkg = normalizePackageName(pkg);
                  for (let j = 0; j < deps.length; j += 1) {
                    const d = deps[j];
                    if (normalizePackageName(d) !== normalizedPkg) {
                      cooccur.set(d, (cooccur.get(d) || 0) + 1);
                      // Early termination if we have enough co-occurrences
                      if (cooccur.size >= MIN_COOCCUR_FOR_EARLY_EXIT) {
                        shouldStopEarly = true;
                        break;
                      }
                    }
                  }
                } catch {
                  // ignore individual failures
                }
              })(),
                SIMILARITY_CONFIG.TIMEOUT_PER_FETCH_MS,
              `Fetching metadata for co-occurrence ${depPkg} timed out`
            );
          });
        })),
        cooccurTimeout,
        `Co-occurrence computation timed out after ${cooccurTimeout}ms`
      );
      
      // Check if we should stop early
      if (cooccur.size >= MIN_COOCCUR_FOR_EARLY_EXIT) {
        shouldStopEarly = true;
        break;
      }
    }
  } catch (err) {
    // If timeout occurs, continue with whatever co-occurrence data we have so far
    try {
      console.warn(`computeCooccurrence: Timed out for ${pkg}, continuing with ${cooccur.size} co-occurrences`);
    } catch {
      // ignore logging errors
    }
  }
  
  // If we couldn't fetch many dependencies, relax thresholds dynamically
  const fetchSuccessRate = baseDependents.length > 0 ? successfulFetches / baseDependents.length : 0;
  
  // Calculate co-occurrence score based on scanned dependents, not total reverse dependencies
  // This represents: "Of the dependents we scanned, what percentage have this package?"
  const scannedCount = successfulFetches > 0 ? successfulFetches : baseDependents.length;
  
  // Adjust threshold for scanned sample size instead of full baseSize
  // Since scores are now based on scannedCount (typically 150), not baseSize (45k+), 
  // we need different thresholds. For a 150-sample, we want to include packages that
  // appear in at least 1% of scanned dependents, but allow lower for larger samples.
  const minJaccardForScanned = scannedCount < 200 
    ? 0.01  // For small samples (150), require at least 1% (1.5 occurrences)
    : Math.max(0.005, QUALITY_THRESHOLDS.COOCCUR_MIN_JACCARD_DEFAULT); // For larger samples, use standard threshold
  const minSharedForScanned = scannedCount < 200
    ? Math.max(1, Math.ceil(scannedCount * 0.01)) // At least 1% of scanned dependents for small samples
    : 1; // For larger samples, just require 1 occurrence
  
  // Use adjusted threshold when we have small sample size, otherwise use standard threshold
  const threshold = scannedCount < 500 
    ? { minShared: minSharedForScanned, minJaccard: minJaccardForScanned }
    : getCooccurJaccardThreshold(baseSize, fetchSuccessRate);
  
  const coRes: SimilarItem[] = Array.from(cooccur.entries())
    .map(function ([name, count]) {
      // Use scanned count instead of total baseSize for accurate percentage
      const score = scannedCount > 0 ? count / scannedCount : 0;
      return { name, jaccard: Number(score.toFixed(6)), sharedDependents: count } as SimilarItem;
    })
    .filter(function (r) { 
      return r.sharedDependents >= threshold.minShared && r.jaccard >= threshold.minJaccard; 
    })
    .sort(function (a, b) { return b.jaccard - a.jaccard; })
    .slice(0, limit);
  
  // If still empty and we have some data, try even more relaxed thresholds
  if (coRes.length === 0 && cooccur.size > 0) {
    const relaxed = Array.from(cooccur.entries())
      .map(function ([name, count]) {
        // Use scanned count for consistency with main calculation
        const score = scannedCount > 0 ? count / scannedCount : 0;
        return { name, jaccard: Number(score.toFixed(6)), sharedDependents: count } as SimilarItem;
      })
      .filter(function (r) { return r.sharedDependents >= 1 && r.jaccard >= QUALITY_THRESHOLDS.RELAXED_JACCARD_VERY_SMALL; })
      .sort(function (a, b) { return b.jaccard - a.jaccard; })
      .slice(0, limit);
    
    if (relaxed.length > 0) {
      return relaxed;
    }
  }
  
  return coRes;
}

// Dynamic co-occurrence computation using forward dependencies (package's own dependencies)
// This strategy finds packages that share dependencies with the target package
async function computeCooccurrenceFromForwardDeps(
  pkg: string,
  limit: number
): Promise<SimilarItem[]> {
  try {
    // Step 1: Get the package's own dependencies
    const meta = await fetchPackageMeta(pkg);
    const pkgDeps = pickLatestDependencies(meta);
    
    if (pkgDeps.length === 0) {
      // If package has no dependencies, try name-based fallback
      return computeCooccurrenceNameBasedFallback(pkg, limit);
    }
    
    // Step 2: Find other popular packages that share these dependencies
    const popular = loadPopularPackages();
    const cooccur = new Map<string, { count: number; sharedDeps: string[] }>();
    const normalizedPkg = normalizePackageName(pkg);
    const pkgDepsSet = new Set<string>(pkgDeps.map(function (d) { return normalizePackageName(d); }));
    
    // IMPORTANT: First, add pandas' own dependencies as co-occurring packages
    // These are packages that "use pandas also use" by definition (e.g., numpy, scipy)
    const popularSet = new Set<string>(popular.map(function (p) { return normalizePackageName(p); }));
    for (const dep of pkgDeps) {
      const normalizedDep = normalizePackageName(dep);
      // Add pandas' dependencies if they're in the popular packages list
      // These should definitely appear in "Packages that use pandas also use"
      if (popularSet.has(normalizedDep)) {
        // Set count to 1 (it's a direct dependency - shares 1 dependency: itself)
        // We'll boost the score in the scoring phase
        cooccur.set(dep, { count: 1, sharedDeps: [dep] });
      }
    }
    
    // Limit how many popular packages to check (dynamic based on limit requested)
    const packagesToCheck = Math.min(popular.length, limit * LIMITS_CONFIG.COOCCUR_MULTIPLIER_PER_LIMIT, LIMITS_CONFIG.MAX_PACKAGES_TO_CHECK_COOCCUR);
    const checkLimit = createLimiter(CONCURRENCY_CONFIG.FORWARD_DEPS_CHECK);
    
    const checkTimeout = calculateTimeout(packagesToCheck, SIMILARITY_CONFIG.BASE_TIMEOUT_FORWARD_DEPS_MS, SIMILARITY_CONFIG.MAX_TIMEOUT_FORWARD_DEPS_MS);
    
    try {
      await withTimeout(
        Promise.all(popular.slice(0, packagesToCheck).map(function (pop) {
          return checkLimit(function () {
            return withTimeout(
              (async function () {
                const normalizedPop = normalizePackageName(pop);
                if (normalizedPop === normalizedPkg) return;
                
                // Skip if it's already a direct dependency (we already added those)
                if (pkgDepsSet.has(normalizedPop)) return;
                
                try {
                  const popMeta = await fetchPackageMeta(pop);
                  const popDeps = pickLatestDependencies(popMeta);
                  const popDepsSet = new Set<string>(popDeps.map(function (d) { return normalizePackageName(d); }));
                  
                  // Count shared dependencies
                  let sharedCount = 0;
                  const sharedDepsList: string[] = [];
                  for (const dep of pkgDepsSet) {
                    if (popDepsSet.has(dep)) {
                      sharedCount += 1;
                      sharedDepsList.push(dep);
                    }
                  }
                  
                  // If they share at least 1 dependency, add to co-occurrence map
                  if (sharedCount > 0) {
                    const existing = cooccur.get(pop);
                    if (!existing || existing.count < sharedCount) {
                      cooccur.set(pop, { count: sharedCount, sharedDeps: sharedDepsList });
                    }
                  }
                } catch {
                  // ignore individual failures
                }
              })(),
              SIMILARITY_CONFIG.TIMEOUT_PER_PACKAGE_CHECK_MS,
              `Checking co-occurrence for ${pop} timed out`
            );
          });
        })),
        checkTimeout,
        `Co-occurrence forward deps check timed out after ${checkTimeout}ms`
      );
    } catch (err) {
      // Continue with whatever data we have
      try {
        console.warn(`computeCooccurrenceFromForwardDeps: Timed out for ${pkg}, continuing with ${cooccur.size} candidates`);
      } catch {
        // ignore logging errors
      }
    }
    
    // Step 3: Convert to SimilarItem format with dynamic scoring
    const totalDeps = pkgDeps.length;
    if (totalDeps === 0) {
      return computeCooccurrenceNameBasedFallback(pkg, limit);
    }
    
    const coRes: SimilarItem[] = Array.from(cooccur.entries())
      .map(function ([name, data]) {
        // Score based on shared dependencies ratio
        // The more dependencies shared relative to the target package's total deps, the higher the score
        // For direct dependencies of pandas, use a higher score
        const isDirectDep = pkgDepsSet.has(normalizePackageName(name));
        const baseScore = data.count / totalDeps;
        const score = isDirectDep ? Math.max(baseScore, QUALITY_THRESHOLDS.DIRECT_DEPENDENCY_BOOST_SCORE) : baseScore; // Boost direct dependencies
        return { 
          name, 
          jaccard: Number(score.toFixed(6)), 
          sharedDependents: data.count 
        } as SimilarItem;
      })
      .filter(function (r) {
        // Dynamic thresholds: require at least 1 shared dependency
        // For packages with few deps, require higher ratio; for packages with many deps, allow lower ratio
        // Direct dependencies always pass
        const isDirectDep = pkgDepsSet.has(normalizePackageName(r.name));
        if (isDirectDep) return true; // Always include direct dependencies
        
        const minShared = 1;
        const minRatio = getCooccurForwardDepsRatioThreshold(totalDeps);
        return r.sharedDependents >= minShared && r.jaccard >= minRatio;
      })
      .sort(function (a, b) {
        // Sort by: 1) direct dependencies first, 2) shared count, 3) jaccard score
        const aIsDirect = pkgDepsSet.has(normalizePackageName(a.name));
        const bIsDirect = pkgDepsSet.has(normalizePackageName(b.name));
        if (aIsDirect && !bIsDirect) return -1;
        if (!aIsDirect && bIsDirect) return 1;
        
        if (b.sharedDependents !== a.sharedDependents) {
          return b.sharedDependents - a.sharedDependents;
        }
        return b.jaccard - a.jaccard;
      })
      .slice(0, limit);
    
    // If we got results, return them
    if (coRes.length > 0) {
      return coRes;
    }
    
    // If no results from dependency overlap, try relaxed thresholds
    const relaxed: SimilarItem[] = Array.from(cooccur.entries())
      .map(function ([name, data]) {
        const score = data.count / totalDeps;
        return { 
          name, 
          jaccard: Number(score.toFixed(6)), 
          sharedDependents: data.count 
        } as SimilarItem;
      })
      .filter(function (r) {
        return r.sharedDependents >= 1 && r.jaccard >= QUALITY_THRESHOLDS.RELAXED_JACCARD_MINIMUM;
      })
      .sort(function (a, b) {
        if (b.sharedDependents !== a.sharedDependents) {
          return b.sharedDependents - a.sharedDependents;
        }
        return b.jaccard - a.jaccard;
      })
      .slice(0, limit);
    
    if (relaxed.length > 0) {
      return relaxed;
    }
    
    // Last resort: name-based fallback
    return computeCooccurrenceNameBasedFallback(pkg, limit);
    
  } catch (err) {
    // If all else fails, try name-based fallback
    return computeCooccurrenceNameBasedFallback(pkg, limit);
  }
}

// Name-based fallback for similar packages when dependency analysis fails
function computeSimilarNameBasedFallback(
  pkg: string,
  limit: number
): SimilarItem[] {
  const lower = normalizePackageName(pkg);
  const popular = loadPopularPackages();
  const cache = loadReverseDepsCache();
  
  // Dynamic pattern matching: find packages with similar names
  const nameParts = lower.split(/[-_.\/]/);
  const mainName = nameParts[0] || lower;
  
  // Try to find packages with similar names from popular packages
  const similarNames: string[] = [];
  for (let i = 0; i < popular.length; i += 1) {
    const pop = popular[i];
    if (normalizePackageName(pop) === lower) continue;
    const popLower = normalizePackageName(pop);
    const popParts = popLower.split(/[-_.\/]/);
    const popMain = popParts[0] || popLower;
    
    // Python packages don't use @ scopes, but may share namespace patterns
    // Check for similar name patterns
    if (popMain === mainName || popLower.includes(mainName) || lower.includes(popMain)) {
      if (popLower !== lower && !similarNames.includes(pop)) {
        similarNames.push(pop);
      }
    }
    
    // Also check cached reverse deps for potential matches
    const normalizedPop = normalizePackageName(pop);
    if (cache[normalizedPop] && Array.isArray(cache[normalizedPop]) && cache[normalizedPop].length > 0) {
      const popDeps = new Set<string>(cache[normalizedPop]);
      const normalizedPkg = normalizePackageName(pkg);
      if (popDeps.has(normalizedPkg) || popDeps.has(pkg) || similarNames.includes(pop)) {
        if (popLower !== lower && !similarNames.includes(pop)) {
          similarNames.push(pop);
        }
      }
    }
    
    if (similarNames.length >= limit * 2) break;
  }
  
  // Return dynamically found similar packages with low confidence scores
  if (similarNames.length > 0) {
    return similarNames.slice(0, limit).map(function (name) {
        return { name, jaccard: QUALITY_THRESHOLDS.NAME_BASED_FALLBACK_SCORE, sharedDependents: 0 } as SimilarItem;
    });
  }
  
  // Last resort: return empty
  return [];
}

// Name-based fallback for co-occurrence when dependency analysis fails
function computeCooccurrenceNameBasedFallback(
  pkg: string,
  limit: number
): SimilarItem[] {
  const popular = loadPopularPackages();
  const lower = normalizePackageName(pkg);
  const nameParts = lower.split(/[-_.\/]/);
  const mainName = nameParts[0] || lower;
  
  const cooccurCandidates: string[] = [];
  
  // Check for packages with similar names or same namespace
  for (let i = 0; i < Math.min(popular.length, LIMITS_CONFIG.MAX_POPULAR_FOR_NAME_BASED); i += 1) {
    const pop = popular[i];
    const normalizedPop = normalizePackageName(pop);
    if (normalizedPop === lower) continue;
    const popLower = normalizedPop;
    const popParts = popLower.split(/[-_.\/]/);
    const popMain = popParts[0] || popLower;
    
    // Check for similar name patterns
    if (popMain === mainName || popLower.includes(mainName) || lower.includes(popMain)) {
      if (!cooccurCandidates.includes(pop)) {
        cooccurCandidates.push(pop);
      }
    }
    
    if (cooccurCandidates.length >= limit * 2) break;
  }
  
  // Return dynamically found co-occurring packages with low confidence scores
  if (cooccurCandidates.length > 0) {
    return cooccurCandidates.slice(0, limit).map(function (name) {
      return { name, jaccard: QUALITY_THRESHOLDS.NAME_BASED_FALLBACK_SCORE, sharedDependents: 0 } as SimilarItem;
    });
  }
  
  return [];
}

export async function computeSimilarPeerOnly(pkg: string, limit: number): Promise<SimilarItem[]> {
  const normalized = normalizePackageName(pkg);
  if (!isUiFramework(normalized)) {
    return await computeSimilarOnDemand(pkg, limit);
  }
  const base = await getReverseDeps(normalized);
  if (base.size === 0) return [];
  // Load cache once before the loop to avoid blocking in forEach
  const cache = await loadReverseDepsCacheAsync();
  const results: SimilarItem[] = [];
  UI_FRAMEWORKS.forEach(function (cand) {
    const normalizedCand = normalizePackageName(cand);
    if (normalizedCand === normalized) return;
    const normalizedCandCache = normalizePackageName(cand);
    let depSet = new Set<string>(cache[normalizedCandCache] || cache[cand.toLowerCase()] || []);
    if (depSet.size === 0) {
      // best-effort live fetch when missing
      // Note: awaited sequentially to avoid burst; small set size
    }
    if (depSet.size === 0) return;
    const { score, shared } = jaccardSimilarity(base, depSet);
    if (score > 0) {
      results.push({ name: cand, jaccard: Number(score.toFixed(6)), sharedDependents: shared });
    }
  });
  results.sort(function (a, b) { return b.jaccard - a.jaccard; });
  return results.slice(0, limit);
}

export function getPrecomputedSimilar(pkg: string, limit: number): SimilarItem[] | null {
  const normalized = normalizePackageName(pkg);
  const cache = loadSimilarIndexCache();
  const list = cache[normalized] || cache[pkg.toLowerCase()];
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.slice(0, limit);
}


