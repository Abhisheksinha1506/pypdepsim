#!/bin/bash
# Setup Weekly Cron Job for PyPI Data Update
# This script sets up a cron job to run weekly data updates every Sunday at 3 AM

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CRON_SCRIPT="$PROJECT_ROOT/scripts/weekly-data-update.sh"

# Create a shell script wrapper for the cron job
cat > "$CRON_SCRIPT" << 'EOF'
#!/bin/bash
# Weekly PyPI Data Update Wrapper
# This script runs the weekly data update and logs output

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
LOG_FILE="$LOG_DIR/weekly-update-$(date +%Y%m%d-%H%M%S).log"

# Create logs directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Change to project directory
cd "$PROJECT_ROOT" || exit 1

# Run the update script and log output
echo "=== Weekly PyPI Data Update ===" >> "$LOG_FILE"
echo "Started: $(date -Iseconds)" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

npm run weekly-update >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

echo "" >> "$LOG_FILE"
echo "Finished: $(date -Iseconds)" >> "$LOG_FILE"
echo "Exit Code: $EXIT_CODE" >> "$LOG_FILE"
echo "================================" >> "$LOG_FILE"

# Keep only last 10 log files
cd "$LOG_DIR" || exit 0
ls -t weekly-update-*.log | tail -n +11 | xargs -r rm -f

exit $EXIT_CODE
EOF

chmod +x "$CRON_SCRIPT"

# Setup cron job (every Sunday at 3 AM)
CRON_JOB="0 3 * * 0 $CRON_SCRIPT"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "weekly-data-update.sh"; then
    echo "⚠️  Cron job already exists. Updating..."
    # Remove existing cron job
    crontab -l 2>/dev/null | grep -v "weekly-data-update.sh" | crontab -
fi

# Add new cron job
(crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -

echo "✓ Weekly cron job setup complete!"
echo ""
echo "Schedule: Every Sunday at 3:00 AM"
echo "Script: $CRON_SCRIPT"
echo "Logs: $PROJECT_ROOT/logs/"
echo ""
echo "To view cron jobs: crontab -l"
echo "To remove cron job: crontab -e (then delete the line)"
echo ""
echo "To run manually: npm run weekly-update"
