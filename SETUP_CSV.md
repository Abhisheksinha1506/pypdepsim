# Setup Guide: Libraries.io CSV Data Source

This guide explains how to set up and use Libraries.io CSV dumps as the primary data source for reverse dependencies in `pypdepsim`.

## Overview

Libraries.io provides free CSV data dumps containing the complete dependency graph for PyPI packages. These dumps are updated monthly and can be used as a primary source for reverse dependencies without requiring an API key.

## Benefits

- ✅ **FREE** - No API key required
- ✅ **Complete data** - Full dependency graph for all PyPI packages
- ✅ **No rate limits** - Offline processing
- ✅ **Reliable** - Works without network connectivity after download

## Prerequisites

- Node.js and npm installed
- At least 5-10 GB free disk space (for CSV file)
- Internet connection for initial download

## Step 1: Download CSV Dump

### Automatic Download (Recommended)

Run the download script:

```bash
npm run download-csv
```

This script will:
1. Search for the latest Libraries.io CSV dump
2. Download it (compressed .gz file)
3. Decompress it automatically
4. Store it in `data/libraries-io/` directory

### Manual Download

If automatic download fails, you can manually download the CSV:

1. Visit https://libraries.io/data
2. Find the latest `repository-dependencies` CSV file
3. Download it (may be compressed as .gz)
4. Place it in `data/libraries-io/` directory
5. Decompress if needed:
   ```bash
   gunzip data/libraries-io/repository-dependencies.csv.gz
   ```

### Using Manual URL

You can also set the CSV URL directly:

```bash
export LIBRARIES_IO_CSV_URL="https://zenodo.org/record/XXXXXX/files/repository-dependencies.csv.gz"
npm run download-csv
```

## Step 2: Parse CSV (Automatic)

The CSV is automatically parsed when you:
- Request reverse dependencies for any package
- Run the build-dataset script

The parsing happens in the background and the results are cached in `data/reverseDeps.csv.json` for fast access.

### Manual Parsing

To parse the CSV manually and build the cache:

```typescript
// Using tsx
npx tsx -e "import('./lib/libraries-io-csv').then(m => m.loadReverseDepsFromCSVCached().then(r => console.log('Parsed', Object.keys(r).length, 'dependencies')))"
```

Or run the build script (which uses CSV by default):

```bash
npx tsx scripts/build-dataset.ts
```

## Step 3: Verify Setup

Check that the CSV was downloaded and parsed:

```bash
# Check CSV file exists
ls -lh data/libraries-io/repository-dependencies.csv

# Check parsed cache exists
ls -lh data/reverseDeps.csv.json
```

You can test reverse dependencies:

```bash
# Test with a popular package
curl http://localhost:3000/api/similar/requests | jq '.similar[0:3]'
```

## Cache Management

### CSV File Location

- **Downloaded CSV**: `data/libraries-io/repository-dependencies.csv`
- **Parsed Cache**: `data/reverseDeps.csv.json`
- **Legacy Cache**: `data/reverseDeps.1000.json` (fallback)

### Cache Priority

The system loads caches in this order:
1. CSV-derived cache (`reverseDeps.csv.json`) - **Primary**
2. Legacy cache (`reverseDeps.1000.json`) - Fallback
3. Live API/CSV fetching - Last resort

### Updating CSV Data

CSV dumps are updated monthly by Libraries.io. To update:

1. **Delete old files** (optional):
   ```bash
   rm data/libraries-io/repository-dependencies.csv
   rm data/reverseDeps.csv.json
   ```

2. **Download latest CSV**:
   ```bash
   npm run download-csv
   ```

3. **Re-parse** (automatic on next request, or manual):
   ```bash
   npx tsx scripts/build-dataset.ts
   ```

## File Sizes

Typical file sizes:
- **Compressed CSV**: 100-500 MB (.gz file)
- **Uncompressed CSV**: 2-10 GB
- **Parsed JSON cache**: 500 MB - 2 GB (depends on filtering)

## Troubleshooting

### CSV Download Fails

**Problem**: Script can't find CSV URL automatically

**Solution**: Set manual URL:
```bash
export LIBRARIES_IO_CSV_URL="<your-csv-url>"
npm run download-csv
```

### Parsing Takes Too Long

**Problem**: CSV file is very large, parsing is slow

**Solution**: 
- First parse takes time (cached for subsequent runs)
- Consider filtering to popular packages only
- Use `reverseDeps.1000.json` for faster startup (legacy cache)

### Out of Disk Space

**Problem**: CSV file doesn't fit on disk

**Solution**:
- Download to external drive, then move to `data/libraries-io/`
- Use compressed file only (set `KEEP_COMPRESSED=true`)
- Consider using legacy cache instead

### Cache Not Updating

**Problem**: Changes to CSV don't reflect in cache

**Solution**:
- Delete `data/reverseDeps.csv.json` to force re-parse
- Check file timestamps (cache is newer than CSV)
- Verify CSV file is in correct location

## Using CSV + API Key (Hybrid Approach)

You can use both CSV and Libraries.io API:

1. **CSV** (Primary): Free, complete, monthly updates
2. **API** (Enhancement): Fresher data, real-time updates

### Setup API Key

```bash
# Configure via API endpoint
curl -X POST http://localhost:3000/api/config/libraries-io \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "your-api-key"}'
```

### How It Works

- System tries CSV first (Strategy 1)
- If CSV has data, uses it
- If CSV missing data AND API key available, uses API (Strategy 2)
- Falls back to empty array if both fail

This gives you:
- Complete data coverage (CSV)
- Fresher data when available (API)
- No single point of failure

## Performance Tips

1. **First Run**: Allow time for CSV parsing (10-30 minutes for full CSV)
2. **Subsequent Runs**: Use cached JSON (fast startup)
3. **Memory Usage**: CSV parsing uses significant memory (2-4 GB recommended)
4. **Disk I/O**: Fast SSD recommended for better performance

## Summary

1. ✅ Run `npm run download-csv` to download CSV
2. ✅ CSV is automatically parsed on first use
3. ✅ Cached in `data/reverseDeps.csv.json` for fast access
4. ✅ Optional: Configure API key for fresher data

The system now uses CSV as the primary source for reverse dependencies, eliminating the need for an API key while still providing comprehensive data coverage.

