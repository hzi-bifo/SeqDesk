# Sequencing Files Management Plan

## Status Summary

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 | COMPLETE | Settings UI for base path, extensions, single-end toggle |
| Phase 2 | COMPLETE | Order-level file assignment with auto-detect |
| Phase 3 | COMPLETE | Global file browser with filters |
| Phase 4 | NOT STARTED | MD5 checksums, FASTQ validation, file watcher |

**Total files created:** 12
**Total files modified:** 3

---

## Overview

This plan adds sequencing file assignment to SeqDesk v2. The sequencing center drops raw FASTQ files (single-end or paired-end) into a configured folder; the app scans that folder, suggests matches per sample, and lets facility admins assign or correct files. Researchers see assignments read-only.

## Current State (v2 + v1 reference)

### v2 (current code)

- `Read` model already stores `file1`, `file2`, and checksums per sample.
- Order API returns `samples.reads`, but there is no UI/API for assigning reads.
- `SiteSettings.dataBasePath` exists and can be used as the base path; `extraSettings` is the pattern for feature-specific config.

### v1 (Django reference)

- Stores file paths as strings in the `Read` model
- Supports paired-end files (R1/R2) with multiple naming conventions
- Has a `discover_sequencing_files()` utility for auto-discovery
- Stores MD5 checksums for validation
- Tracks ENA submission status per read
- Uses SiteSettings to configure the data storage path

**v2 target (close to v1, with small UX improvements):**
- Keep v1 auto-discovery parity
- Add a focused assignment UI (auto-suggest + manual override)
- Avoid upload/move; only reference existing files
- Optional: global file browser, checksums, and caching

---

## Data Model & Settings (v2-aligned)

### SiteSettings

Use existing fields, no schema change for MVP.

- `SiteSettings.dataBasePath`: base directory where the sequencing center drops files.
- `SiteSettings.extraSettings.sequencingFiles`: JSON config, for example:
  ```json
  {
    "allowedExtensions": [".fastq.gz", ".fq.gz", ".fastq", ".fq"],
    "scanDepth": 2,
    "ignorePatterns": ["**/tmp/**", "**/undetermined/**"],
    "allowSingleEnd": true,
    "autoAssign": false
  }
  ```

### Read model

- Keep existing fields (`file1`, `file2`, `checksum1`, `checksum2`).
- MVP assumes one `Read` row per `Sample` (create if missing; update `file1`/`file2`).
- Single-end uses `file1` only; paired-end uses both.
- Future: support multiple `Read` rows per sample (lanes/reruns).

### Optional future cache (recommended for stability/performance)

If directory scans become slow, add a `FileIndex` table for cached metadata. This makes file discovery stable and efficient, and avoids rescans per request.

---

## Feature Components

### Phase 1: Sequencing file settings - COMPLETED

Add a section to `/admin/settings` (keep `PageContainer maxWidth="medium"` to match the existing settings page).

Features:
- [x] Base path input (`dataBasePath`) - Added to admin settings page with folder icon
- [x] Allowed extensions (multi-select or comma list) - Comma-separated input field
- [x] Allow single-end toggle - Switch component in settings UI
- [x] "Test path" action to validate readability and show file counts - Button that validates path existence, permissions, and counts matching files

**API routes:**
- [x] `GET/PUT /api/admin/settings/sequencing-files` - Implemented in `src/app/api/admin/settings/sequencing-files/route.ts`, stores config in `extraSettings.sequencingFiles`
- [x] `POST /api/admin/settings/sequencing-files/test` - Implemented in `src/app/api/admin/settings/sequencing-files/test/route.ts`, checks directory exists, is readable, and counts files

### Phase 2: Order-level file assignment (core workflow) - COMPLETED

Create a dedicated page `/orders/[id]/files` (full-width like other order pages) with:

- [x] Table of all samples in the order - Using shadcn Table component with all samples listed
- [x] Columns: Sample ID, Sample Alias, Read 1 file, Read 2 file (optional), status - Includes editable inputs for admins
- [x] Actions: Auto-detect for order, Assign, Clear - Auto-Detect button scans directory, Rescan forces refresh, Clear button per sample
- [x] Auto-detect fills suggestions; auto-assign only when there is a single unambiguous match - Pre-fills input fields for exact matches (confidence >= 0.9)
- [x] Facility admins can edit; researchers see read-only - Conditional rendering based on role and order status

- [x] Add a link from `/orders/[id]` for facility admins when status >= `READY_FOR_SEQUENCING` - "Manage Files" button added to order detail page header

**API routes:**
- [x] `GET /api/orders/[id]/files` - Returns samples with current assignments and file existence checks via `checkFileExists()`
- [x] `PUT /api/orders/[id]/files` - Bulk updates assignments, creates Read records if missing, updates existing ones
- [x] `POST /api/orders/[id]/files/discover` - Scans directory using cached scanner, matches files to samples, supports force refresh and auto-assign

### Phase 3: Global file browser - COMPLETED

Facility-wide view of all sequencing files with assignment status:

- [x] `/files` (facility admin only) - Full page with stats cards and file table
- [x] Filters: extension dropdown, assigned/unassigned toggle, search across filename/sample/order
- [x] "Scan Now" button to force refresh cache
- [x] Added "Seq. Files" link to sidebar for facility admins

**API:** `GET /api/files` returns all files with assignment info, supports filter/search params

### Phase 4: Optional enhancements

- [ ] MD5 calculation for `checksum1`/`checksum2` (background job or on-demand)
- [ ] Basic FASTQ validation (read first few records only)
- [ ] File watcher if deployment supports it (not required for MVP)

---

## File Discovery Utilities - COMPLETED

Created utilities in `src/lib/files/`:

- [x] **paths.ts** - Path security and filename parsing utilities
  - `ensureWithinBase()` - Prevents path traversal by validating resolved paths stay under base
  - `toRelativePath()` - Converts absolute paths to relative safely
  - `safeJoin()` - Joins paths with traversal protection
  - `hasAllowedExtension()` - Checks file extensions against allowed list
  - `extractSampleIdentifier()` - Strips extensions, read identifiers (_R1, _R2), lane info (_L001), sample numbers (_S1) from filenames
  - `isRead1File()` / `isRead2File()` - Detects forward/reverse reads from filename patterns
  - `getPairedFilePath()` - Generates paired file path by swapping R1<->R2

- [x] **scanner.ts** - Directory scanning with caching
  - `scanDirectory()` - Recursively scans directories up to configured depth, filters by extension, respects ignore patterns
  - In-memory cache with 5-minute TTL, keyed by basePath + extensions + depth
  - `checkFileExists()` - Validates single file exists and returns FileInfo
  - `clearScanCache()` / `getScanCacheStats()` - Cache management utilities

- [x] **matcher.ts** - Sample-to-file matching
  - `matchPairedEndFiles()` - Groups files into R1/R2 pairs based on extracted identifiers
  - `findFilesForSample()` - Matches sample identifiers against file pairs with confidence scoring (0-1)
  - `findFilesForSamples()` - Batch matching for multiple samples
  - `validateFilePair()` - Validates assignment consistency (R1 before R2, naming consistency)
  - Returns match status: exact (>=0.7 confidence), partial, ambiguous (multiple high-score matches), none

- [x] **index.ts** - Exports all utilities with TypeScript types

**Matching inputs:**
- `sampleId` (required)
- `sampleAlias` (if present)
- Optional: `sampleTitle` (lower priority)

**Paired-end patterns supported:**
- [x] `{sample}_1.fastq.gz` / `{sample}_2.fastq.gz`
- [x] `{sample}_R1.fastq.gz` / `{sample}_R2.fastq.gz`
- [x] `{sample}_R1_001.fastq.gz` / `{sample}_R2_001.fastq.gz`
- [x] `{sample}.R1.fastq.gz` / `{sample}.R2.fastq.gz`
- [x] `{sample}_L001_R1.fastq.gz` (lane info stripped during matching)

**Single-end detection rules (implemented):**
- [x] If exactly one file matches sampleId/alias and no R2 match exists, suggest as single-end (file1 only).
- [x] If both R1/R2 matches exist, treat as paired-end.
- [x] If multiple possible R1 matches exist, return conflict and require manual selection.
- [x] Files are grouped by extracted identifier before matching to samples.

**Storage guidance (implemented):**
- [x] Store `Read.file1` / `Read.file2` as paths relative to `dataBasePath`.
- [x] Return only filename + relative path to the UI (absolutePath stripped in API responses).

---

## Backend Scan Strategy (stable + efficient) - MVP IMPLEMENTED

**Decision (current deployment): use in-memory TTL scanning.**
Single instance and <10k files makes this reliable and fast without schema changes.

1. Default (MVP): on-demand scan with caching - **IMPLEMENTED**
   - [x] Scan the configured base path to build an in-memory list of `FileInfo` (size, mtime) - `scanDirectory()` returns FileInfo with absolutePath, relativePath, filename, size, modifiedAt
   - [x] Cache per-process for a short TTL (5 minutes) to avoid repeated scans - `CACHE_TTL_MS = 5 * 60 * 1000` in scanner.ts
   - [x] Re-scan only on user-triggered "Scan now" or when cache expires - "Rescan" button in UI passes `force: true`
   - [x] Keep cache keyed by basePath + allowedExtensions + scanDepth - `getCacheKey()` generates JSON key from these params
   - [x] Provide a `force` option in the scan API to bypass TTL - `scanDirectory(path, options, force)` third param
   - [x] On `/api/orders/[id]/files` GET, `stat` assigned files to confirm existence and return `missing` when not found - `checkFileExists()` called for each assigned file

2. Recommended (future): persistent `FileIndex`
   - [ ] Store: `path`, `filename`, `size`, `modifiedAt`, `scannedAt`, optional `checksum`, optional `readId`.
   - [ ] Incremental scan: only update entries when `modifiedAt` or `size` changes.
   - [ ] Suggestions and file existence checks query `FileIndex`, not the filesystem.
   - [ ] Revalidate existence for assigned files when serving order files (cheap stat per file).

3. Safety and predictability - **IMPLEMENTED**
   - [x] Only accept paths under `dataBasePath` (resolve + prefix check) - `ensureWithinBase()` validates all paths
   - [x] Concurrency-limit filesystem scans; avoid recursive depth > config - `maxDepth` option limits recursion
   - [x] Avoid auto-assign on ambiguous matches - Only auto-assigns when confidence >= 0.9 and status is "exact"

---

## API Endpoints Summary

| Endpoint | Method | Purpose | Status |
| --- | --- | --- | --- |
| `/api/admin/settings/sequencing-files` | GET/PUT | Configure base path + extensions | DONE |
| `/api/admin/settings/sequencing-files/test` | POST | Validate base path readability | DONE |
| `/api/orders/[id]/files` | GET | List samples, assignments, and existence/suggestion info | DONE |
| `/api/orders/[id]/files` | PUT | Update file assignments | DONE |
| `/api/orders/[id]/files/discover` | POST | Auto-detect matches for an order | DONE |
| `/api/files` | GET | Global file list with assignment status | DONE |

---

## Security Considerations - ALL IMPLEMENTED

1. Path traversal prevention:
   - [x] Resolve absolute paths and verify they stay under `dataBasePath` - `ensureWithinBase()` uses `path.resolve()` and prefix check
   - [x] Reject `..` and disallow direct user-supplied absolute paths - `safeJoin()` explicitly rejects these patterns

2. Access control:
   - [x] Only FACILITY_ADMIN can configure or assign files - All mutation endpoints check `session.user.role === "FACILITY_ADMIN"`
   - [x] Researchers have read-only access to assignments - GET endpoint allows access but UI hides edit controls

3. Read-only filesystem access:
   - [x] No move/delete in UI - Only read operations (stat, readdir) used
   - [x] Return relative paths only - `absolutePath` stripped from API responses in discover endpoint

---

## Testing Plan

1. Unit tests
   - Filename pattern matching
   - R1/R2 pairing logic
   - Path normalization and base-path enforcement

2. Integration tests
   - Directory scan on a sample folder
   - Auto-discovery API (single match vs conflicts)
   - Manual override and clear actions

3. Manual testing
   - Large directories (10k+ files)
   - Nested folders
   - Edge cases (missing R2, duplicates, ambiguous matches)

---

## Migration Notes

- MVP uses existing schema (no Prisma changes).
- If new settings keys are added in `extraSettings`, default to sane fallbacks.

---

## Questions to Resolve

1. Should we allow multiple read pairs per sample (lanes/reruns) in v2, or keep one `Read` per sample for now?
2. What scan depth is acceptable for the facility storage layout?
3. Should auto-discovery require explicit confirmation before saving?
4. Do we need a global file browser from day one, or only the per-order view?

---

## Appendix: File Naming Conventions

### Illumina Standard
```
{SampleName}_S{SampleNumber}_L{Lane}_R{Read}_001.fastq.gz
Example: Sample1_S1_L001_R1_001.fastq.gz
```

### Simple Paired-End
```
{SampleName}_R1.fastq.gz / {SampleName}_R2.fastq.gz
{SampleName}_1.fastq.gz / {SampleName}_2.fastq.gz
```

### With Flow Cell Info
```
{SampleName}_{FlowCell}_{Lane}_R1.fastq.gz
```

The system should be flexible enough to handle common conventions and use sampleId/sampleAlias for matching.

---

## Implementation Log

### 2025-01-23: Phase 1 & 2 Complete

**Files created:**
- `src/lib/files/paths.ts` - Path security and filename parsing utilities
- `src/lib/files/scanner.ts` - Directory scanner with 5-min TTL cache
- `src/lib/files/matcher.ts` - Sample-to-file matching with confidence scoring
- `src/lib/files/index.ts` - Barrel exports
- `src/app/api/admin/settings/sequencing-files/route.ts` - Settings GET/PUT
- `src/app/api/admin/settings/sequencing-files/test/route.ts` - Path validation
- `src/app/api/orders/[id]/files/route.ts` - Files GET/PUT for orders
- `src/app/api/orders/[id]/files/discover/route.ts` - Auto-discovery endpoint
- `src/app/orders/[id]/files/page.tsx` - File assignment UI

**Files modified:**
- `src/app/admin/settings/page.tsx` - Added "Sequencing Files" settings section
- `src/app/orders/[id]/page.tsx` - Added "Manage Files" button for admins

**Key decisions:**
- Used in-memory caching (not database) for MVP simplicity
- Stores relative paths in Read.file1/file2, resolves against dataBasePath at runtime
- Confidence threshold of 0.9 for auto-fill suggestions
- Only exact matches with high confidence are pre-filled; ambiguous requires manual selection

### 2025-01-23: Phase 3 Complete

**Files created:**
- `src/app/api/files/route.ts` - Global file listing API with assignment status
- `src/app/files/page.tsx` - File browser UI with stats, filters, table

**Files modified:**
- `src/components/layout/Sidebar.tsx` - Added "Seq. Files" link for facility admins

**Features:**
- Stats cards showing total/assigned/unassigned/filtered counts
- Filters: search, assigned/unassigned, extension dropdown
- Table shows filename, path, size, modified date, status, assigned sample/order
- Links to order files page for assigned files

---

## Complete File Inventory

### New Files (12 total)

**Utilities (`src/lib/files/`):**
1. `paths.ts` - Path security, filename parsing (ensureWithinBase, extractSampleIdentifier, isRead1File, etc.)
2. `scanner.ts` - Directory scanning with 5-min TTL cache (scanDirectory, checkFileExists)
3. `matcher.ts` - Sample-to-file matching (matchPairedEndFiles, findFilesForSample)
4. `index.ts` - Barrel exports

**API Routes:**
5. `src/app/api/admin/settings/sequencing-files/route.ts` - GET/PUT settings
6. `src/app/api/admin/settings/sequencing-files/test/route.ts` - POST path validation
7. `src/app/api/orders/[id]/files/route.ts` - GET/PUT order file assignments
8. `src/app/api/orders/[id]/files/discover/route.ts` - POST auto-discovery
9. `src/app/api/files/route.ts` - GET global file listing

**Pages:**
10. `src/app/orders/[id]/files/page.tsx` - Order file assignment UI
11. `src/app/files/page.tsx` - Global file browser UI

**Documentation:**
12. `PLAN_SEQUENCING_FILES.md` - This plan file

### Modified Files (3 total)

1. `src/app/admin/settings/page.tsx` - Added "Sequencing Files" settings section
2. `src/app/orders/[id]/page.tsx` - Added "Manage Files" button
3. `src/components/layout/Sidebar.tsx` - Added "Seq. Files" nav link for admins
