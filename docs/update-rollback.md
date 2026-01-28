# Update and Rollback Guide

## Automatic Updates

SeqDesk can update itself through the Admin Panel:

1. Go to **Admin > Settings**
2. Find the **Software Updates** section
3. If an update is available, click **Install Update**
4. The app will:
   - Check disk space (150MB required)
   - Download the new version
   - Verify the checksum
   - Backup your current installation
   - Apply the update
   - Run database migrations
   - Restart automatically

## Manual Rollback

If an update fails or causes issues, you can rollback manually:

### Step 1: Stop the Server

```bash
# If running directly
Ctrl+C

# If using PM2
pm2 stop seqdesk

# If using systemd
sudo systemctl stop seqdesk
```

### Step 2: Restore from Backup

After each update, a backup is stored in `.update-backup/`:

```bash
cd /path/to/seqdesk

# Check what's in the backup
ls -la .update-backup/

# Restore the backup
cp -r .update-backup/.next .next
cp -r .update-backup/node_modules node_modules
cp -r .update-backup/prisma prisma
cp -r .update-backup/public public
cp .update-backup/package.json package.json

# Keep your .env and database - they weren't changed
```

### Step 3: Restore Database (if needed)

If the database was corrupted:

```bash
# Your database file (dev.db) is preserved during updates
# If you have issues, restore from your own backup

# Check if database works
npx prisma db push --skip-generate
```

### Step 4: Restart

```bash
./start.sh

# Or with PM2
pm2 start seqdesk

# Or with systemd
sudo systemctl start seqdesk
```

## Manual Update

If automatic updates fail, you can update manually:

### Step 1: Backup

```bash
cd /path/to/seqdesk

# Backup database
cp dev.db dev.db.backup

# Backup config
cp .env .env.backup
cp seqdesk.config.json seqdesk.config.json.backup 2>/dev/null || true
```

### Step 2: Download New Version

```bash
# Get latest version info
curl -s https://seqdesk.com/api/version

# Download (replace URL with actual download URL)
curl -fsSL "https://seqdesk.com/releases/latest" -o seqdesk-new.tar.gz
```

### Step 3: Extract and Replace

```bash
# Extract to temp directory
mkdir seqdesk-new
tar -xzf seqdesk-new.tar.gz -C seqdesk-new --strip-components=1

# Stop server
# (use appropriate command for your setup)

# Replace files (preserve config)
cp seqdesk-new/.next .next -r
cp seqdesk-new/node_modules node_modules -r
cp seqdesk-new/prisma prisma -r
cp seqdesk-new/public public -r
cp seqdesk-new/server.js server.js
cp seqdesk-new/package.json package.json
cp seqdesk-new/start.sh start.sh

# Cleanup
rm -rf seqdesk-new seqdesk-new.tar.gz
```

### Step 4: Run Migrations

```bash
npx prisma db push --skip-generate
```

### Step 5: Restart

```bash
./start.sh
```

## Troubleshooting

### Update stuck at "Downloading..."

- Check internet connection
- Check disk space: `df -h`
- Try manual update (see above)

### "Insufficient disk space" error

- Free up space: `du -sh * | sort -h`
- Need at least 150MB free

### Server won't start after update

1. Check logs: `node server.js` (run directly to see errors)
2. Common issues:
   - Missing dependencies: `npm install`
   - Database schema changed: `npx prisma db push`
   - Config file issues: Check `.env`

### Database errors after update

```bash
# Reset database (WARNING: loses data)
rm dev.db
npx prisma db push
npx prisma db seed

# Or restore from backup
cp dev.db.backup dev.db
```

## Version Pinning

To stay on a specific version:

1. Don't click "Install Update" in the admin panel
2. Or dismiss the update banner

There's currently no way to downgrade through the UI - use manual rollback if needed.
