# Data Sources for pypdepsim

This document outlines all data sources used by the `pypdepsim` project to fetch Python package information.

## Primary Data Sources

### 1. PyPI JSON API ⭐ (Primary for Metadata)
**URL**: `https://pypi.org/pypi/{package-name}/json`

**Purpose**: Fetches package metadata including:
- Package information (name, version, description, etc.)
- Dependencies (`requires_dist` field)
- Package release history
- Package statistics

**Usage**: 
- Used by `fetchPackageMeta()` function in `lib/pypi.ts`
- Primary source for dependency information
- Used to extract dependencies via `pickLatestDependencies()`

**Cache**: 1 hour (3600 seconds) in-memory LRU cache

**Example**:
```typescript
// Fetches metadata for 'requests' package
const meta = await fetchPackageMeta('requests');
// Returns: { info: { requires_dist: ['urllib3>=1.21.1', 'certifi>=2017.4.17', ...] } }
```

**Location in code**: `lib/pypi.ts:138-142`

---

### 2. Libraries.io CSV Dumps ⭐ (Primary for Reverse Dependencies)
**Source**: Libraries.io Data Dumps (monthly updates)
**URL**: `https://libraries.io/data` (via Zenodo)

**Purpose**: Complete offline graph of PyPI dependencies and reverse dependencies

**Features**:
- **FREE** - No API key required
- Complete dependency graph
- Updated monthly
- Offline processing (no rate limits)

**Usage**:
- **Strategy 1** (PRIMARY): Load from Libraries.io CSV dump via `loadReverseDepsFromCSVCached()`
- Used by `fetchReverseDependentsApprox()` as the primary source
- Parsed and cached in `data/reverseDeps.csv.json`

**Download Script**: `scripts/download-libraries-io-csv.ts`
- Run: `npm run download-csv`
- Downloads and decompresses CSV file
- Stores in `data/libraries-io/` directory

**Parser**: `lib/libraries-io-csv.ts`
- Parses CSV to extract PyPI package dependencies
- Builds reverse dependency mapping
- Exports: `loadReverseDepsFromCSVCached()`

**Cache**: JSON cache file at `data/reverseDeps.csv.json` (auto-generated from CSV)

**Location in code**: `lib/libraries-io-csv.ts`, `lib/pypi.ts:173-180`

---

### 3. Libraries.io API (Optional Fallback - Enhanced Similarity & Co-occurrence)
**URL**: `https://libraries.io/api/pypi/{package-name}/dependents?api_key={key}&per_page=250`

**Purpose**: Provides fresher reverse dependency data (real-time vs monthly CSV updates)
- Used for enhanced similarity and co-occurrence computation when API key is provided
- Falls back to CSV if no API key is available

**Configuration**: 
- Store API key via: `POST /api/config/libraries-io` (stores in `.env.local`)
- Check status via: `GET /api/config/libraries-io`
- Remove key via: `DELETE /api/config/libraries-io`

**Usage**:
- Used by `fetchReverseDependentsApprox()` as **Strategy 2** (optional fallback)
- Only used if API key is configured AND CSV doesn't have the data
- Provides fresher data than CSV (updated in real-time)

**Cache**: 30 minutes (1800 seconds) in-memory LRU cache

**Status**: Optional enhancement - CSV works without it, API provides fresher data

**Location in code**: `lib/pypi.ts:187-201`, `app/api/config/libraries-io/route.ts`

---

### 4. PyPI Stats API ⭐ (Download Counts)
**URL**: `https://pypistats.org/api/packages/{package}/recent`

**Purpose**: Fetch download statistics for packages

**Features**:
- **FREE** - No API key required
- Recent downloads (last 7 days)
- Mirror downloads
- Total download counts

**Usage**:
- Used by `fetchDownloadStats()` in `lib/pypi-stats.ts`
- Integrated into package metadata API: `app/api/meta/[pkg]/route.ts`
- Returns: `{ recent: number, mirrors: number, total: number }`

**Cache**: 24 hours (86400 seconds) in-memory LRU cache

**Example Response**:
```json
{
  "name": "requests",
  "downloads": {
    "recent": 12345678,
    "mirrors": 567890,
    "total": 12913568
  }
}
```

**Location in code**: `lib/pypi-stats.ts`, `app/api/meta/[pkg]/route.ts`

---

### 5. PyPI Simple API
**URL**: `https://pypi.org/simple`

**Purpose**: Simple package index (not currently used for fetching, but available)

**Status**: Defined but not actively used in current implementation

**Location in code**: `lib/pypi.ts:10`

---

### 6. PyPI Search API
**URL**: `https://pypi.org/search/?q={query}`

**Purpose**: Search for packages (not used for reverse dependencies)

**Status**: Not functional for dependency queries - PyPI search returns HTML, not JSON

---

## Local Cache Files

The system uses local cache files to avoid redundant processing and to store pre-computed data:

### 1. `data/reverseDeps.1000.json`
**Purpose**: Cached reverse dependencies mapping (legacy format)
**Format**: `{ "package-name": ["dependent1", "dependent2", ...] }`

**Loaded by**: `loadReverseDepsCache()` in `lib/cache.ts`

**Usage**: Fallback if CSV-derived cache is not available

---

### 2. `data/reverseDeps.csv.json` ⭐ (Primary Cache)
**Purpose**: CSV-derived reverse dependencies mapping
**Format**: `{ "package-name": ["dependent1", "dependent2", ...] }`

**Source**: Generated from Libraries.io CSV dump
**Generated by**: `loadReverseDepsFromCSVCached()` in `lib/libraries-io-csv.ts`

**Priority**: This cache takes precedence over `reverseDeps.1000.json` if it's newer

---

### 3. `data/similarIndex.1000.json`
**Purpose**: Pre-computed similar package index
**Format**: `{ "package-name": [{ name: "...", jaccard: 0.5, sharedDependents: 10 }, ...] }`

**Loaded by**: `loadSimilarIndexCache()` in `lib/cache.ts`

**Usage**: Fast lookup for similar packages without computation

---

### 4. `data/popular.json`
**Purpose**: List of popular Python packages (200 packages)
**Format**: `["requests", "numpy", "pandas", ...]`

**Loaded by**: `loadPopularPackages()` in `lib/cache.ts`

**Usage**: 
- Used as fallback when reverse dependencies are unavailable
- Name-based matching for similar packages
- Testing and suggestions

---

### 5. `data/libraries-io/repository-dependencies.csv`
**Purpose**: Raw Libraries.io CSV dump file
**Source**: Downloaded from Libraries.io via `npm run download-csv`

**Size**: Typically several GB (compressed: ~100-500MB)

**Update Frequency**: Monthly (updated by Libraries.io)

---

## Data Flow

### For Package Metadata:
1. **Check in-memory LRU cache** (1 hour TTL, max 5000 entries)
2. **If not cached**: Fetch from `https://pypi.org/pypi/{package}/json`
3. **Store in cache** for future requests
4. **Extract dependencies** using `pickLatestDependencies()`

### For Download Statistics:
1. **Check in-memory LRU cache** (24 hour TTL, max 5000 entries)
2. **If not cached**: Fetch from `https://pypistats.org/api/packages/{package}/recent`
3. **Store in cache** for future requests
4. **Return stats** or `null` if unavailable

### For Reverse Dependencies:
1. **Strategy 1 (PRIMARY)**: Load from CSV-derived cache (`data/reverseDeps.csv.json`)
   - If CSV exists, parse and build reverse dependency map
   - Store in JSON cache for fast access
   - Use this as primary source (no API key needed)
2. **Strategy 2 (OPTIONAL)**: Libraries.io API (only if API key is configured)
   - Provides fresher data than CSV
   - Falls back to CSV if API key not available
3. **Strategy 3**: Fall back to legacy cache (`data/reverseDeps.1000.json`)
4. **Strategy 4**: Return empty array if all strategies fail

### For Similar Packages:
1. **Check pre-computed cache** (`data/similarIndex.1000.json`)
2. **If not cached**: Compute on-demand using Jaccard similarity:
   - Get reverse dependencies for the package (from CSV or API)
   - Get reverse dependencies for candidate packages
   - Calculate Jaccard similarity (shared dependents / total unique dependents)
3. **Store results** in cache for future use

### For Co-occurrence:
1. **Get reverse dependencies** for the package (from CSV or API)
2. **For each dependent package**: Fetch its metadata from PyPI
3. **Extract dependencies** from dependent packages
4. **Count co-occurrence** (how many dependents share the same dependencies)
5. **Sort by frequency** and return top results

---

## Current Data Source Status

| Data Source | Status | Used For | Requires Auth | Update Frequency |
|------------|--------|----------|---------------|------------------|
| PyPI JSON API | ✅ **Active** | Package metadata, dependencies | No | Real-time |
| Libraries.io CSV | ✅ **Active (Primary)** | Reverse dependencies | No | Monthly |
| Libraries.io API | ⚠️ **Optional** | Enhanced reverse deps (fresher data) | Yes (API key) | Real-time |
| PyPI Stats API | ✅ **Active** | Download counts | No | Daily |
| Local Cache Files | ✅ **Active** | Fast lookups, pre-computed data | No | Varies |

---

## Setup Instructions

### 1. Download Libraries.io CSV (Required for Reverse Dependencies)

```bash
# Download and decompress Libraries.io CSV dump
npm run download-csv

# Or manually set CSV URL:
export LIBRARIES_IO_CSV_URL="https://zenodo.org/record/XXXXXX/files/repository-dependencies.csv.gz"
npm run download-csv
```

This will:
- Download the latest CSV dump from Libraries.io
- Decompress it
- Store in `data/libraries-io/` directory

### 2. Parse CSV and Build Cache (Automatic)

The CSV is automatically parsed when:
- Reverse dependencies are requested for the first time
- Or when running `scripts/build-dataset.ts`

The parsed data is cached in `data/reverseDeps.csv.json` for fast access.

### 3. Optional: Configure Libraries.io API Key (For Fresher Data)

```bash
# Via API endpoint (stores in .env.local)
curl -X POST http://localhost:3000/api/config/libraries-io \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "your-api-key-here"}'

# Or manually add to .env.local:
echo "LIBRARIES_IO_API_KEY=your-api-key-here" >> .env.local
```

**Benefits of API Key**:
- Fresher reverse dependency data (real-time vs monthly CSV updates)
- Enhanced similarity and co-occurrence computation
- Works alongside CSV (CSV is primary, API is fallback)

---

## Limitations

1. **CSV Update Frequency**: 
   - Libraries.io CSV dumps are updated monthly
   - For fresher data, use Libraries.io API (requires API key)

2. **CSV File Size**:
   - CSV files are large (several GB uncompressed)
   - Ensure sufficient disk space
   - Parsing may take time (cached for subsequent runs)

3. **PyPI Stats API**:
   - Not all packages have download statistics
   - Returns `null` for packages without stats

4. **Rate Limiting**:
   - PyPI API has rate limits (mitigated by 150ms delay between requests)
   - In-memory LRU caches reduce redundant calls
   - Exponential backoff for retries on failures

---

## Environment Variables

You can configure data fetching behavior with these environment variables:

**CSV Configuration**:
- `LIBRARIES_IO_CSV_URL`: Manual CSV download URL (optional)
- `KEEP_COMPRESSED`: Set to `"true"` to keep compressed CSV file (default: false)

**Libraries.io API**:
- `LIBRARIES_IO_API_KEY`: API key for Libraries.io (optional, can be set via API endpoint)

**PyPI API Configuration**:
- `PYPI_MAX_RETRY_ATTEMPTS`: Max retry attempts (default: 5)
- `PYPI_RETRY_INITIAL_DELAY_MS`: Initial retry delay (default: 1000ms)
- `PYPI_RETRY_MAX_DELAY_MS`: Max retry delay (default: 10000ms)
- `PYPI_REQUEST_DELAY_MS`: Delay between requests (default: 150ms)
- `PYPI_FETCH_TIMEOUT_MS`: Request timeout (default: 30000ms)

**PyPI Stats API Configuration**:
- `PYPI_STATS_MAX_RETRY_ATTEMPTS`: Max retry attempts (default: 3)
- `PYPI_STATS_RETRY_INITIAL_DELAY_MS`: Initial retry delay (default: 500ms)
- `PYPI_STATS_FETCH_TIMEOUT_MS`: Request timeout (default: 10000ms)

---

## Summary

**Primary data sources** (free, no API key required):
- **PyPI JSON API**: Package metadata and dependencies
- **Libraries.io CSV**: Reverse dependencies (monthly updates)
- **PyPI Stats API**: Download counts

**Optional enhancement** (requires API key):
- **Libraries.io API**: Fresher reverse dependency data for enhanced similarity/co-occurrence

**Local cache**: Pre-computed data files for fast lookups
- CSV-derived cache: `data/reverseDeps.csv.json`
- Legacy cache: `data/reverseDeps.1000.json`
- Similarity index: `data/similarIndex.1000.json`

The system prioritizes free data sources (CSV dumps) and uses API as an optional enhancement when available.
