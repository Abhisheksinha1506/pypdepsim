# Performance Analysis & Rate Limiting Verification

## Current Rate Limiting Configuration

### PyPI API Rate Limits
- **Default Request Delay**: `150ms` between requests to same domain (`PYPI_REQUEST_DELAY_MS`)
- **Rate Limiting**: Per-domain tracking with minimum delay enforcement
- **429 Handling**: Automatic retry with exponential backoff + jitter
- **Retry Logic**: Up to 5 attempts with exponential backoff (1s → 10s max)

### Concurrency Limits
- **Dependencies Scanning**: 8 concurrent requests (`createLimiter(8)`)
- **Candidate Evaluation**: 10 concurrent requests (`createLimiter(10)`)
- **Forward Deps Checks**: 5 concurrent requests (`createLimiter(5)`)

## Performance Impact Analysis

### ⚠️ Performance Degradation After Cache Removal

**Before (With Cache)**:
- Similar packages: ~100-500ms (cached)
- Metadata: ~50-200ms (cached)
- Reverse deps: ~50-100ms (cached)
- **Total**: ~200-800ms

**After (Live Fetching)**:
- Similar packages: ~5-30 seconds (depending on package popularity)
- Metadata: ~200-500ms per request (150ms delay + fetch time)
- Reverse deps: ~300-800ms (live fetch)
- **Total**: ~5-30 seconds per search

### Time Breakdown for Similar Packages Computation

For a package with **300 reverse dependents**:
1. **Reverse Dependents Fetch**: ~300-800ms (single API call)
2. **Candidate Collection** (scanning 300 dependents):
   - 300 dependents ÷ 8 concurrency = ~37 batches
   - 37 batches × 150ms rate limit = **~5.5 seconds minimum**
   - Plus fetch time (~200-500ms each) = **~15-20 seconds total**
3. **Candidate Evaluation** (evaluating ~400-1000 candidates):
   - 400-1000 candidates ÷ 10 concurrency = ~40-100 batches
   - Each batch with rate limiting = **~10-25 seconds minimum**
   - Plus fetch time = **~30-60 seconds total**

**Estimated Total Time**: 30-80 seconds per search (for popular packages)

### Rate Limiting Verification

✅ **Rate limiting IS being followed**:
- `rateLimit()` function enforces 150ms delay between requests to same domain
- Applied before every API call in `fetchJsonWithCache()`
- Per-domain tracking prevents simultaneous requests to same API

⚠️ **Potential Issue**:
- Concurrency limiters (8-10 concurrent requests) can cause bursts
- With 8 concurrent requests, rate limiting still applies per-request
- However, requests may queue up slightly, but rate limiter handles it

### Current Rate Limiting Flow

```
Request 1 → rateLimit() → wait if needed → fetch
Request 2 → rateLimit() → wait if needed → fetch
Request 3 → rateLimit() → wait if needed → fetch
...
(Up to 8-10 concurrent based on limiter)
```

**Rate limiting ensures**:
- Minimum 150ms between any two requests to same domain
- Prevents hitting rate limits
- Handles 429 responses with exponential backoff

## Recommendations

### 1. ✅ Keep Current Rate Limiting (Recommended)
- Rate limiting is working correctly
- Per-domain tracking prevents API throttling
- 150ms delay is conservative and safe

### 2. ⚠️ Performance Optimization Options

**Option A: Re-enable Selective Caching** (Best for performance)
- Cache metadata for 1 hour (rarely changes)
- Cache reverse dependencies for 30 minutes (changes slowly)
- Keep similarity computation live (needs fresh data)

**Option B: Increase Timeouts** (For better UX)
- Current timeout: 2.5 seconds soft budget
- Recommendation: Increase to 5-10 seconds
- Allow more time for live fetching

**Option C: Progressive Loading** (Best UX)
- Return initial results immediately (from cache if available)
- Fetch live data in background
- Update UI as new data arrives

### 3. ⚠️ Rate Limit Adjustments (If Needed)

**If receiving 429 errors**:
- Increase `PYPI_REQUEST_DELAY_MS` to `200ms` or `250ms`
- Reduce concurrency: `8 → 5` for dependencies, `10 → 6` for candidates

**If too slow**:
- Decrease `PYPI_REQUEST_DELAY_MS` to `100ms` (risky - may hit rate limits)
- Increase concurrency: `8 → 10` for dependencies (may cause rate limit issues)

## Testing Rate Limits

To verify rate limiting is working:

1. **Monitor Network Tab**: Check request timing
   - Requests to `pypi.org` should be at least 150ms apart
   - No 429 errors should occur

2. **Check Logs**: Look for rate limit warnings
   - `429 Too Many Requests` errors indicate rate limit issues
   - Retry attempts show rate limit handling

3. **Load Test**: Run multiple searches quickly
   - Should handle concurrent searches
   - Each should respect rate limits independently

## Conclusion

✅ **Rate limiting is correctly implemented and being followed**

⚠️ **Performance degradation is expected** after cache removal:
- Expected: 5-30 seconds per search (vs 200-800ms with cache)
- Acceptable for: Fresh, live data
- Not acceptable for: High-traffic production use

**Recommendation**: For production, consider re-enabling selective caching (Option A above) while keeping similarity computation live for accuracy.

