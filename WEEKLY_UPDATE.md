# Weekly PyPI Data Update

This document describes the automated weekly data update system that keeps all PyPI package data fresh.

## Overview

The weekly update script (`scripts/weekly-data-update.ts`) automatically:

1. **Gets all valid PyPI packages** - Fetches the complete list of packages from PyPI
2. **Downloads metadata** - Fetches package metadata (versions, descriptions, dependencies, etc.)
3. **Builds reverse dependencies** - Constructs the reverse dependency map for similarity computation
4. **Atomically swaps data** - Safely replaces old data with new data without disrupting the running application

## Features

### ✅ Atomic Updates
- Writes to temporary files (`.temp-*.json`) first
- Only swaps to production after successful completion
- Uses filesystem `rename()` for instant atomic operation
- No partial files visible to the application

### ✅ Application Safety
- Running application continues to use old data during update
- New data appears instantly after swap
- Cache automatically refreshes when new files are detected
- No downtime or service interruption

### ✅ Lock File Protection
- Prevents concurrent runs
- Auto-detects and removes stale locks (older than 24h)
- Ensures only one update runs at a time

### ✅ Progress Tracking
- Detailed logging with progress updates
- Periodic saves to temp files (every 500-1000 packages)
- Resume capability if interrupted

### ✅ Error Recovery
- Continues processing on individual package errors
- Reports error statistics at the end
- Only swaps successfully completed data

## Usage

### Manual Run
```bash
npm run weekly-update
```

### Setup Weekly Cron Job (Automatic)
```bash
cd pypdepsim
chmod +x scripts/setup-weekly-cron.sh
./scripts/setup-weekly-cron.sh
```

The cron job runs **every Sunday at 3:00 AM** automatically.

### Verify Cron Job
```bash
crontab -l
```

### Remove Cron Job
```bash
crontab -e
# Delete the line with weekly-data-update.sh
```

## Data Files Updated

The script updates these files in `data/`:

1. **popular.json** - List of all valid PyPI packages
2. **packages-versions.json** - Package versions
3. **packages-deps-count.json** - Dependency counts
4. **packages-repositories.json** - Repository URLs
5. **packages-downloads.json** - Download statistics
6. **packages-descriptions.json** - Package descriptions
7. **reverseDeps-*.json** - Reverse dependencies (28 files: a-z, 0-9, other)

## Process Flow

```
1. Acquire Lock
   ↓
2. Get All PyPI Packages
   ├─ Fetch from PyPI Simple API
   └─ Save to .temp-popular.json
   ↓
3. Download Metadata (with dependencies)
   ├─ Fetch package metadata
   ├─ Extract dependencies
   ├─ Store for reverse deps building
   └─ Save to .temp-*.json files periodically
   ↓
4. Build Reverse Dependencies
   ├─ Reuse dependencies from step 2 (no re-fetching!)
   ├─ Build reverse map: dep → [dependents]
   └─ Save to .temp-reverseDeps-*.json files periodically
   ↓
5. Atomic Swap
   ├─ Backup old files (.backup)
   ├─ Rename temp files to production (atomic)
   └─ Clean up old backups
   ↓
6. Release Lock
```

## Performance Optimizations

1. **Reuse Dependencies**: Step 3 reuses dependencies fetched in step 2, avoiding duplicate API calls
2. **Periodic Saves**: Intermediate saves prevent data loss if interrupted
3. **Concurrent Processing**: Uses configurable concurrency limits
4. **Rate Limiting**: Respects PyPI API rate limits automatically

## Configuration

Environment variables (optional):

```bash
# Step 2: Metadata download
DOWNLOAD_CONCURRENCY=25        # Concurrent requests for metadata

# Step 3: Reverse deps building
REVERSE_DEPS_CONCURRENCY=10    # Concurrent requests for reverse deps

# Rate limiting (from PYPI_API_CONFIG)
PYPI_REQUEST_DELAY_MS=150      # Delay between requests (ms)
PYPI_FETCH_TIMEOUT_MS=30000    # Request timeout (ms)
```

## Logging

Logs are saved to:
- **Console**: Real-time progress and status
- **Log files**: `logs/weekly-update-YYYYMMDD-HHMMSS.log` (keeps last 10)

## Troubleshooting

### Lock File Stuck
If the lock file prevents runs:
```bash
rm data/.weekly-update.lock
```

### Partial Update
If the script was interrupted:
- Temp files (`.temp-*.json`) may exist
- Delete them before re-running:
```bash
rm data/.temp-*.json
```

### Verify Data
Check that files were updated:
```bash
ls -lh data/*.json | head -20
```

## Safety Guarantees

1. ✅ **No Application Disruption**: Application continues using old data during update
2. ✅ **Atomic Swaps**: Files are swapped instantly using `rename()` (atomic on same filesystem)
3. ✅ **Rollback Capability**: Old files are backed up (`.backup`) before swap
4. ✅ **Lock Protection**: Prevents concurrent runs that could corrupt data
5. ✅ **Error Handling**: Continues processing on errors, reports at end

## Estimated Runtime

For ~500,000 packages:
- **Step 1**: ~30 seconds (get package list)
- **Step 2**: ~3-4 hours (metadata download)
- **Step 3**: ~2-3 hours (reverse deps building, reuses step 2 data)
- **Step 4**: ~5 seconds (atomic swap)

**Total**: ~5-7 hours (depending on API response times and network)

## Maintenance

The script is designed to run unattended. Monitor logs weekly to ensure successful completion.

