/**
 * Centralized configuration for all dynamic values
 * All hardcoded values are now configurable via environment variables with sensible defaults
 */

// Timeout Configuration
export const SIMILARITY_CONFIG = {
  // Individual operation timeouts
  TIMEOUT_PER_FETCH_MS: Number(process.env.SIMILARITY_TIMEOUT_PER_FETCH_MS || 8000),
  TIMEOUT_PER_CANDIDATE_MS: Number(process.env.SIMILARITY_TIMEOUT_PER_CANDIDATE_MS || 10000),
  TIMEOUT_PER_PACKAGE_CHECK_MS: Number(process.env.SIMILARITY_TIMEOUT_PER_PACKAGE_CHECK_MS || 5000),
  
  // Base timeouts for dynamic calculation
  BASE_TIMEOUT_FORWARD_DEPS_MS: Number(process.env.SIMILARITY_BASE_TIMEOUT_FORWARD_DEPS_MS || 10000),
  BASE_TIMEOUT_DEPENDENTS_SCAN_MS: Number(process.env.SIMILARITY_BASE_TIMEOUT_DEPENDENTS_SCAN_MS || 15000),
  BASE_TIMEOUT_CANDIDATES_SCAN_MS: Number(process.env.SIMILARITY_BASE_TIMEOUT_CANDIDATES_SCAN_MS || 20000),
  
  // Max timeouts (caps for dynamic calculation)
  MAX_TIMEOUT_FORWARD_DEPS_MS: Number(process.env.SIMILARITY_MAX_TIMEOUT_FORWARD_DEPS_MS || 45000),
  MAX_TIMEOUT_DEPENDENTS_SCAN_MS: Number(process.env.SIMILARITY_MAX_TIMEOUT_DEPENDENTS_SCAN_MS || 60000),
  MAX_TIMEOUT_CANDIDATES_SCAN_MS: Number(process.env.SIMILARITY_MAX_TIMEOUT_CANDIDATES_SCAN_MS || 90000),
  
  // Dynamic timeout multiplier (for calculateTimeout function)
  TIMEOUT_MULTIPLIER_PER_ITEM: Number(process.env.SIMILARITY_TIMEOUT_MULTIPLIER_PER_ITEM || 10),
};

// Concurrency Limits
export const CONCURRENCY_CONFIG = {
  DEPENDENTS_SCAN: Number(process.env.CONCURRENCY_DEPENDENTS_SCAN || 8),
  CANDIDATES_EVALUATION: Number(process.env.CONCURRENCY_CANDIDATES_EVALUATION || 10),
  FORWARD_DEPS_CHECK: Number(process.env.CONCURRENCY_FORWARD_DEPS_CHECK || 5),
};

// Default Limits and Thresholds
export const LIMITS_CONFIG = {
  // Scan limits
  DEFAULT_MAX_DEPENDENTS_TO_SCAN: Number(process.env.SIMILARITY_DEFAULT_MAX_DEPENDENTS_TO_SCAN || 150),
  DEFAULT_MAX_LIVE_CANDIDATES: Number(process.env.SIMILARITY_DEFAULT_MAX_LIVE_CANDIDATES || 200),
  MAX_MAX_DEPENDENTS_TO_SCAN: Number(process.env.SIMILARITY_MAX_MAX_DEPENDENTS_TO_SCAN || 1000),
  MAX_MAX_LIVE_CANDIDATES: Number(process.env.SIMILARITY_MAX_MAX_LIVE_CANDIDATES || 1000),
  
  // Popular packages limits
  DEFAULT_TOP_SEARCH_LIMIT: Number(process.env.SIMILARITY_DEFAULT_TOP_SEARCH_LIMIT || 250),
  MAX_TOP_SEARCH_LIMIT: Number(process.env.SIMILARITY_MAX_TOP_SEARCH_LIMIT || 250),
  
  // Candidate collection limits
  MAX_CANDIDATES_TO_COLLECT: Number(process.env.SIMILARITY_MAX_CANDIDATES_TO_COLLECT || 5000),
  EARLY_TERMINATE_CANDIDATES: Number(process.env.SIMILARITY_EARLY_TERMINATE_CANDIDATES || 5000),
  
  // Candidate collection multipliers
  CANDIDATES_MULTIPLIER_PER_LIMIT: Number(process.env.SIMILARITY_CANDIDATES_MULTIPLIER_PER_LIMIT || 15),
  MAX_PACKAGES_TO_CHECK_FORWARD_DEPS: Number(process.env.SIMILARITY_MAX_PACKAGES_TO_CHECK_FORWARD_DEPS || 300),
  MAX_PACKAGES_TO_CHECK_COOCCUR: Number(process.env.SIMILARITY_MAX_PACKAGES_TO_CHECK_COOCCUR || 200),
  COOCCUR_MULTIPLIER_PER_LIMIT: Number(process.env.SIMILARITY_COOCCUR_MULTIPLIER_PER_LIMIT || 10),
  
  // Name-based fallback limits
  MAX_POPULAR_FOR_NAME_BASED: Number(process.env.SIMILARITY_MAX_POPULAR_FOR_NAME_BASED || 100),
};

// Quality Thresholds
export const QUALITY_THRESHOLDS = {
  // Minimum results for quality check
  MIN_RESULTS_FOR_QUALITY: Number(process.env.SIMILARITY_MIN_RESULTS_FOR_QUALITY || 10),
  MIN_TOP_SCORE_FOR_QUALITY: Number(process.env.SIMILARITY_MIN_TOP_SCORE_FOR_QUALITY || 0.05),
  
  // Jaccard similarity thresholds (based on base size)
  MIN_JACCARD_SMALL_BASE: Number(process.env.SIMILARITY_MIN_JACCARD_SMALL_BASE || 0.001),
  MIN_JACCARD_MEDIUM_BASE: Number(process.env.SIMILARITY_MIN_JACCARD_MEDIUM_BASE || 0.01),
  MIN_JACCARD_BITSET_SMALL_BASE: Number(process.env.SIMILARITY_MIN_JACCARD_BITSET_SMALL_BASE || 0.001),
  MIN_JACCARD_BITSET_MEDIUM_BASE: Number(process.env.SIMILARITY_MIN_JACCARD_BITSET_MEDIUM_BASE || 0.02),
  
  // Shared dependents thresholds
  MIN_SHARED_SMALL_BASE: Number(process.env.SIMILARITY_MIN_SHARED_SMALL_BASE || 1),
  MIN_SHARED_MEDIUM_BASE: Number(process.env.SIMILARITY_MIN_SHARED_MEDIUM_BASE || 2),
  
  // Relaxed thresholds (for fallback strategies)
  RELAXED_JACCARD_VERY_SMALL: Number(process.env.SIMILARITY_RELAXED_JACCARD_VERY_SMALL || 0.0001),
  RELAXED_JACCARD_SMALL: Number(process.env.SIMILARITY_RELAXED_JACCARD_SMALL || 0.0005),
  RELAXED_JACCARD_MEDIUM: Number(process.env.SIMILARITY_RELAXED_JACCARD_MEDIUM || 0.001),
  RELAXED_JACCARD_MINIMUM: Number(process.env.SIMILARITY_RELAXED_JACCARD_MINIMUM || 0.01),
  
  // Forward deps ratio thresholds
  MIN_RATIO_VERY_SMALL_DEPS: Number(process.env.SIMILARITY_MIN_RATIO_VERY_SMALL_DEPS || 0.15),
  MIN_RATIO_SMALL_DEPS: Number(process.env.SIMILARITY_MIN_RATIO_SMALL_DEPS || 0.1),
  MIN_RATIO_MEDIUM_DEPS: Number(process.env.SIMILARITY_MIN_RATIO_MEDIUM_DEPS || 0.05),
  MIN_RATIO_COOCCUR_VERY_SMALL_DEPS: Number(process.env.SIMILARITY_MIN_RATIO_COOCCUR_VERY_SMALL_DEPS || 0.2),
  MIN_RATIO_COOCCUR_SMALL_DEPS: Number(process.env.SIMILARITY_MIN_RATIO_COOCCUR_SMALL_DEPS || 0.1),
  MIN_RATIO_COOCCUR_MEDIUM_DEPS: Number(process.env.SIMILARITY_MIN_RATIO_COOCCUR_MEDIUM_DEPS || 0.05),
  
  // Co-occurrence thresholds
  COOCCUR_MIN_JACCARD_DEFAULT: Number(process.env.SIMILARITY_COOCCUR_MIN_JACCARD_DEFAULT || 0.001),
  COOCCUR_MIN_JACCARD_SMALL_BASE: Number(process.env.SIMILARITY_COOCCUR_MIN_JACCARD_SMALL_BASE || 0.0005),
  COOCCUR_MIN_JACCARD_MEDIUM_BASE: Number(process.env.SIMILARITY_COOCCUR_MIN_JACCARD_MEDIUM_BASE || 0.0008),
  
  // Direct dependency boost
  DIRECT_DEPENDENCY_BOOST_SCORE: Number(process.env.SIMILARITY_DIRECT_DEPENDENCY_BOOST_SCORE || 0.5),
  
  // Name-based fallback score
  NAME_BASED_FALLBACK_SCORE: Number(process.env.SIMILARITY_NAME_BASED_FALLBACK_SCORE || 0.001),
  
  // Fetch success rate thresholds
  LOW_FETCH_SUCCESS_RATE_THRESHOLD: Number(process.env.SIMILARITY_LOW_FETCH_SUCCESS_RATE_THRESHOLD || 0.3),
  LOW_FETCH_RATE_JACCARD_MULTIPLIER: Number(process.env.SIMILARITY_LOW_FETCH_RATE_JACCARD_MULTIPLIER || 0.5),
};

// Base Size Thresholds (for adaptive thresholds)
export const BASE_SIZE_THRESHOLDS = {
  VERY_SMALL: Number(process.env.SIMILARITY_BASE_SIZE_VERY_SMALL || 5),
  SMALL: Number(process.env.SIMILARITY_BASE_SIZE_SMALL || 10),
  MEDIUM: Number(process.env.SIMILARITY_BASE_SIZE_MEDIUM || 20),
  LARGE: Number(process.env.SIMILARITY_BASE_SIZE_LARGE || 50),
};

// Dependencies Count Thresholds (for adaptive thresholds)
export const DEPS_COUNT_THRESHOLDS = {
  VERY_SMALL: Number(process.env.SIMILARITY_DEPS_COUNT_VERY_SMALL || 5),
  SMALL: Number(process.env.SIMILARITY_DEPS_COUNT_SMALL || 10),
};

// Progressive Refinement Configuration (for API route)
export const PROGRESSIVE_REFINEMENT_CONFIG = {
  BUDGET_MS: Number(process.env.SIMILARITY_BUDGET_MS || 2500),
  
  // Default initial limits
  INITIAL_MAX_DEPENDENTS_TO_SCAN: Number(process.env.SIMILARITY_INITIAL_MAX_DEPENDENTS_TO_SCAN || 150),
  INITIAL_MAX_LIVE_CANDIDATES: Number(process.env.SIMILARITY_INITIAL_MAX_LIVE_CANDIDATES || 200),
  
  // Progressive refinement steps
  REFINEMENT_STEPS: [
    {
      maxDependentsToScan: Number(process.env.SIMILARITY_REFINEMENT_STEP1_MAX_DEPS || 300),
      maxLiveCandidates: Number(process.env.SIMILARITY_REFINEMENT_STEP1_MAX_CANDIDATES || 400),
    },
    {
      maxDependentsToScan: Number(process.env.SIMILARITY_REFINEMENT_STEP2_MAX_DEPS || 450),
      maxLiveCandidates: Number(process.env.SIMILARITY_REFINEMENT_STEP2_MAX_CANDIDATES || 600),
    },
    {
      maxDependentsToScan: Number(process.env.SIMILARITY_REFINEMENT_STEP3_MAX_DEPS || 600),
      maxLiveCandidates: Number(process.env.SIMILARITY_REFINEMENT_STEP3_MAX_CANDIDATES || 800),
    },
  ],
};

// Early Termination Configuration
export const EARLY_TERMINATION_CONFIG = {
  // Minimum Jaccard score to trigger early exit (default: 0.1)
  MIN_SCORE_FOR_EARLY_EXIT: Number(process.env.SIMILARITY_EARLY_EXIT_MIN_SCORE || 0.1),
  
  // Minimum number of candidates to check before allowing early exit (multiplier of limit)
  MIN_CHECKED_MULTIPLIER: Number(process.env.SIMILARITY_EARLY_EXIT_MIN_CHECKED || 10),
  
  // Batch size for incremental checking (default: 500)
  BATCH_SIZE: Number(process.env.SIMILARITY_EARLY_EXIT_BATCH_SIZE || 500),
};

// Helper functions for adaptive thresholds based on base size
export function getJaccardThreshold(baseSize: number): number {
  if (baseSize < BASE_SIZE_THRESHOLDS.SMALL) {
    return QUALITY_THRESHOLDS.MIN_JACCARD_SMALL_BASE;
  }
  return QUALITY_THRESHOLDS.MIN_JACCARD_MEDIUM_BASE;
}

export function getBitsetJaccardThreshold(baseSize: number): number {
  if (baseSize < BASE_SIZE_THRESHOLDS.SMALL) {
    return QUALITY_THRESHOLDS.MIN_JACCARD_BITSET_SMALL_BASE;
  }
  return QUALITY_THRESHOLDS.MIN_JACCARD_BITSET_MEDIUM_BASE;
}

export function getSharedThreshold(baseSize: number): number {
  if (baseSize < BASE_SIZE_THRESHOLDS.SMALL) {
    return QUALITY_THRESHOLDS.MIN_SHARED_SMALL_BASE;
  }
  return QUALITY_THRESHOLDS.MIN_SHARED_MEDIUM_BASE;
}

export function getRelaxedJaccardThreshold(baseSize: number): number {
  if (baseSize < BASE_SIZE_THRESHOLDS.VERY_SMALL) {
    return QUALITY_THRESHOLDS.RELAXED_JACCARD_VERY_SMALL;
  }
  if (baseSize < BASE_SIZE_THRESHOLDS.MEDIUM) {
    return QUALITY_THRESHOLDS.RELAXED_JACCARD_SMALL;
  }
  return QUALITY_THRESHOLDS.RELAXED_JACCARD_MEDIUM;
}

export function getForwardDepsRatioThreshold(depsCount: number): number {
  if (depsCount < DEPS_COUNT_THRESHOLDS.VERY_SMALL) {
    return QUALITY_THRESHOLDS.MIN_RATIO_VERY_SMALL_DEPS;
  }
  if (depsCount < DEPS_COUNT_THRESHOLDS.SMALL) {
    return QUALITY_THRESHOLDS.MIN_RATIO_SMALL_DEPS;
  }
  return QUALITY_THRESHOLDS.MIN_RATIO_MEDIUM_DEPS;
}

export function getCooccurForwardDepsRatioThreshold(depsCount: number): number {
  if (depsCount < DEPS_COUNT_THRESHOLDS.VERY_SMALL) {
    return QUALITY_THRESHOLDS.MIN_RATIO_COOCCUR_VERY_SMALL_DEPS;
  }
  if (depsCount < DEPS_COUNT_THRESHOLDS.SMALL) {
    return QUALITY_THRESHOLDS.MIN_RATIO_COOCCUR_SMALL_DEPS;
  }
  return QUALITY_THRESHOLDS.MIN_RATIO_COOCCUR_MEDIUM_DEPS;
}

export function getCooccurJaccardThreshold(baseSize: number, fetchSuccessRate: number): { minShared: number; minJaccard: number } {
  let minShared = QUALITY_THRESHOLDS.MIN_SHARED_MEDIUM_BASE;
  let minJaccard = QUALITY_THRESHOLDS.COOCCUR_MIN_JACCARD_DEFAULT;
  
  if (baseSize < BASE_SIZE_THRESHOLDS.SMALL) {
    minShared = QUALITY_THRESHOLDS.MIN_SHARED_SMALL_BASE;
    minJaccard = QUALITY_THRESHOLDS.COOCCUR_MIN_JACCARD_SMALL_BASE;
  } else if (baseSize < BASE_SIZE_THRESHOLDS.LARGE) {
    minShared = QUALITY_THRESHOLDS.MIN_SHARED_SMALL_BASE;
    minJaccard = QUALITY_THRESHOLDS.COOCCUR_MIN_JACCARD_MEDIUM_BASE;
  }
  
  // Further relax if fetch success rate is low
  const isLowFetchRate = fetchSuccessRate < QUALITY_THRESHOLDS.LOW_FETCH_SUCCESS_RATE_THRESHOLD;
  if (isLowFetchRate) {
    minShared = Math.max(1, minShared - 1);
    minJaccard = minJaccard * QUALITY_THRESHOLDS.LOW_FETCH_RATE_JACCARD_MULTIPLIER;
  }
  
  return { minShared, minJaccard };
}

// PyPI API Configuration
export const PYPI_API_CONFIG = {
  // Retry configuration
  MAX_RETRY_ATTEMPTS: Number(process.env.PYPI_MAX_RETRY_ATTEMPTS || 5),
  RETRY_INITIAL_DELAY_MS: Number(process.env.PYPI_RETRY_INITIAL_DELAY_MS || 1000),
  RETRY_MAX_DELAY_MS: Number(process.env.PYPI_RETRY_MAX_DELAY_MS || 10000),
  RETRY_JITTER_MS: Number(process.env.PYPI_RETRY_JITTER_MS || 500),
  
  // Rate limiting
  REQUEST_DELAY_MS: Number(process.env.PYPI_REQUEST_DELAY_MS || 150),
  
  // Timeouts
  FETCH_TIMEOUT_MS: Number(process.env.PYPI_FETCH_TIMEOUT_MS || 30000),
  
  // Cache configuration
  CACHE_MAX_SIZE: Number(process.env.PYPI_CACHE_MAX_SIZE || 5000),
  CACHE_TTL_MS: Number(process.env.PYPI_CACHE_TTL_MS || 45 * 60 * 1000), // 45 minutes
  
  // API endpoints
  PYPI_JSON_API_BASE: "https://pypi.org/pypi" as const,
  PYPI_SEARCH_API_BASE: "https://pypi.org/search" as const,
  LIBRARIES_IO_API_BASE: "https://libraries.io/api" as const,
  
  // Cache TTLs for different endpoints (in seconds)
  META_CACHE_TTL_SECONDS: Number(process.env.PYPI_META_CACHE_TTL_SECONDS || 3600), // 1 hour
  REVERSE_DEPS_CACHE_TTL_SECONDS: Number(process.env.PYPI_REVERSE_DEPS_CACHE_TTL_SECONDS || 1800), // 30 minutes
  
  // Libraries.io API
  LIBRARIES_IO_API_KEY: process.env.LIBRARIES_IO_API_KEY || "",
  LIBRARIES_IO_PER_PAGE: Number(process.env.LIBRARIES_IO_PER_PAGE || 250),
  
  // Search limits
  MAX_SEARCH_LIMIT: Number(process.env.PYPI_MAX_SEARCH_LIMIT || 250),
};

// PyPI Stats API Configuration
export const PYPI_STATS_CONFIG = {
  // API endpoint
  PYPI_STATS_API_BASE: "https://pypistats.org/api" as const,
  
  // Retry configuration
  MAX_RETRY_ATTEMPTS: Number(process.env.PYPI_STATS_MAX_RETRY_ATTEMPTS || 3),
  RETRY_INITIAL_DELAY_MS: Number(process.env.PYPI_STATS_RETRY_INITIAL_DELAY_MS || 500),
  RETRY_JITTER_MS: Number(process.env.PYPI_STATS_RETRY_JITTER_MS || 200),
  
  // Timeouts
  FETCH_TIMEOUT_MS: Number(process.env.PYPI_STATS_FETCH_TIMEOUT_MS || 10000),
  
  // Cache configuration
  CACHE_MAX_SIZE: Number(process.env.PYPI_STATS_CACHE_MAX_SIZE || 5000),
  CACHE_TTL_MS: Number(process.env.PYPI_STATS_CACHE_TTL_MS || 24 * 60 * 60 * 1000), // 24 hours
  
  // Batch processing
  BATCH_CONCURRENCY: Number(process.env.PYPI_STATS_BATCH_CONCURRENCY || 5),
  BATCH_DELAY_MS: Number(process.env.PYPI_STATS_BATCH_DELAY_MS || 100),
};

