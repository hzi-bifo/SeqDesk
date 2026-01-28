# ENA Integration Plan for v2

## Current State Analysis

### What Already Exists

The v2 codebase is **well-prepared** for ENA integration:

| Component | Status | Notes |
|-----------|--------|-------|
| Study model | Ready | Has `studyAccessionId`, `submitted`, `submittedAt`, `readyForSubmission` |
| Sample model | Ready | Has `sampleAccessionNumber`, `biosampleNumber`, `taxId` |
| Read model | Ready | Has `experimentAccessionNumber`, `runAccessionNumber` |
| Submission model | Partial | Exists but needs enhancement |
| SiteSettings | Partial | Has `enaUsername`, `enaPassword`, `enaTestMode` but no UI |
| Study workflow | Ready | Users can create studies, assign samples, mark as ready |

### What's Missing

1. **ENA credentials UI** in admin settings
2. **Admin page** for viewing/managing ENA submissions
3. **API endpoints** for XML generation and submission
4. **Study.alternativeAccessionId** field (secondary ENA accession)
5. **Validation logic** for required ENA fields

---

## Proposed Architecture

### Navigation Structure

```
Sidebar (Admin View)
├── Dashboard
├── Orders
├── Studies
├── Seq. Files
├── Researchers
├── Departments
├── ─────────────────
├── ENA Submissions    ← NEW top-level admin item
│   └── Shows studies ready for submission
└── Platform Settings
    ├── Order Forms
    ├── Study Forms
    ├── Modules
    ├── Seq. Technologies
    ├── Admin Accounts
    └── General
        └── ENA Credentials section ← NEW section
```

### Why "ENA Submissions" as Top-Level?

1. **High visibility** - Facility admins need to see pending submissions quickly
2. **Workflow clarity** - Separate from configuration (Platform Settings)
3. **Mirrors v1** - Replaces admin actions with dedicated UI
4. **Extensible** - Could later support other databases (SRA, DDBJ)

---

## Data Model Changes

### Schema Updates Required

```prisma
// In v2/prisma/schema.prisma

model Study {
  // Existing fields...

  // ADD: Secondary ENA accession
  alternativeAccessionId String?  // ERP... accession

  // ADD: Submission tracking
  submissionError       String?   // Last error message if failed
  lastSubmissionAttempt DateTime? // When last attempted
}

// Consider: Enhance Submission model for better tracking
model Submission {
  id               String   @id @default(cuid())
  submissionType   String   // STUDY, SAMPLE, READ
  status           String   @default("PENDING") // PENDING, SUBMITTING, ACCEPTED, REJECTED, ERROR

  // ADD these fields:
  xmlContent       String?  @db.Text  // Generated XML (larger field)
  requestPayload   String?  @db.Text  // Full request for debugging
  response         String?  @db.Text  // ENA response
  receiptXml       String?  @db.Text  // ENA receipt XML
  errorMessage     String?            // Human-readable error

  accessionNumbers String?  // JSON of returned accessions

  // Better entity reference
  studyId          String?
  study            Study?   @relation(fields: [studyId], references: [id])

  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

### Required Fields for ENA Submission

**Study (Project) - Required:**
- `title` - Already exists, already required
- `alias` - Exists but **needs to be made required/auto-generated**
- `description` - Exists but should be required for ENA

**Sample - Required:**
- `sampleAlias` - Exists, needs validation (must be unique)
- `sampleTitle` - Exists, should be required
- `taxId` - Exists, **CRITICAL - must be validated as valid NCBI taxon**
- `checklistData` - Exists (MIxS metadata)

**Recommendation:** Add a "Validate for ENA" step that checks these before allowing submission.

---

## UI Design

### 1. ENA Submissions Page (`/admin/submissions`)

**Purpose:** Central hub for facility admins to manage ENA submissions

**Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│ ENA Submissions                                                  │
│ Submit studies to the European Nucleotide Archive               │
├─────────────────────────────────────────────────────────────────┤
│ [Tab: Ready for Submission] [Tab: Submitted] [Tab: Failed]      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Study Title          Samples  Researcher     Status    [>] │ │
│ ├─────────────────────────────────────────────────────────────┤ │
│ │ Human Gut Study 1       12    Dr. Smith    ● Ready         │ │
│ │ Soil Microbiome          8    Dr. Jones    ⚠ Missing taxId │ │
│ │ Water Sample Study      24    Dr. Brown    ● Ready         │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ [□ Select all ready]              [Submit Selected to ENA]      │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- **Tabs:** Ready / Submitted / Failed
- **Validation indicators:** Shows which studies have issues
- **Bulk submission:** Select multiple studies to submit at once
- **Click to expand:** Shows validation details and sample list

### 2. Study Detail Expansion (Inline or Modal)

```
┌──────────────────────────────────────────────────────────────┐
│ Human Gut Microbiome Study                                   │
│ Created by Dr. Smith on Jan 15, 2026                         │
├──────────────────────────────────────────────────────────────┤
│ Validation Status                                            │
│ ──────────────────                                           │
│ ✓ Study title present                                        │
│ ✓ Study alias: HGM-2026-001                                  │
│ ✓ Description provided                                       │
│ ✓ Checklist: human-gut (ERC000015)                          │
│                                                              │
│ Samples (12)                                                 │
│ ──────────────────                                           │
│ ✓ HG001 - Tax ID: 408170 (human gut metagenome)             │
│ ✓ HG002 - Tax ID: 408170 (human gut metagenome)             │
│ ⚠ HG003 - Missing scientific name                           │
│ ...                                                          │
│                                                              │
│ [View Full Details]           [Validate] [Submit to ENA]     │
└──────────────────────────────────────────────────────────────┘
```

### 3. ENA Settings Section (`/admin/settings`)

Add a new section to the existing settings page:

```
┌──────────────────────────────────────────────────────────────┐
│ [DB icon] ENA Configuration                                  │
│ Configure connection to European Nucleotide Archive          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ Submission Mode                                              │
│ ○ Test Mode (wwwdev.ebi.ac.uk) - For testing, no real data  │
│ ● Production Mode (www.ebi.ac.uk) - Real submissions         │
│ ⚠ Warning: Production submissions are permanent              │
│                                                              │
│ Credentials                                                  │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Webin Username    [Webin-XXXXX          ]               │ │
│ │ Password          [••••••••••••         ]               │ │
│ │ Center Name       [My Sequencing Facility] (optional)   │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ [Test Connection]  ✓ Connected successfully                 │
│                                                              │
│                                    [Save ENA Settings]       │
└──────────────────────────────────────────────────────────────┘
```

### 4. Submission Progress Modal

When submitting, show a progress modal:

```
┌────────────────────────────────────────────────┐
│ Submitting to ENA                              │
├────────────────────────────────────────────────┤
│                                                │
│ ✓ Generating Study XML...                      │
│ ✓ Submitting Study...                          │
│ ● Generating Sample XML... (3/12)              │
│ ○ Submitting Samples...                        │
│ ○ Complete                                     │
│                                                │
│ ━━━━━━━━━━━━━━━━━━━░░░░░░░░░░░  45%           │
│                                                │
│                              [Cancel]          │
└────────────────────────────────────────────────┘
```

---

## API Endpoints

### New Endpoints Required

```typescript
// ENA Settings
GET  /api/admin/settings/ena           // Get ENA credentials (masked password)
PUT  /api/admin/settings/ena           // Update ENA credentials
POST /api/admin/settings/ena/test      // Test ENA connection

// ENA Submissions
GET  /api/admin/submissions            // List all submissions with filters
GET  /api/admin/submissions/pending    // Studies ready for submission
GET  /api/admin/submissions/:id        // Get submission details

// Validation
POST /api/studies/:id/validate         // Validate study for ENA
POST /api/samples/validate             // Validate samples (batch)

// Submission Actions
POST /api/studies/:id/submit           // Submit study to ENA
POST /api/submissions/batch            // Submit multiple studies
GET  /api/submissions/:id/status       // Check submission status

// XML Preview (for debugging)
GET  /api/studies/:id/xml/preview      // Preview generated XML
GET  /api/samples/:id/xml/preview      // Preview sample XML
```

---

## Submission Workflow

### User Flow (Researcher)

```
1. Create Study with title, description
2. Select environment type (MIxS checklist)
3. Assign samples from orders
4. Fill per-sample metadata (including taxId)
5. Click "Mark Ready for Submission"
   → System shows validation results
   → If valid, study status = "Ready"
   → If invalid, shows what needs fixing
```

### Admin Flow (Facility Admin)

```
1. Navigate to "ENA Submissions" page
2. See list of studies marked as ready
3. Click study to expand/validate
4. Select studies to submit
5. Click "Submit to ENA"
   → Progress modal shows each step
   → On success: Accession numbers shown
   → On failure: Error message with details
6. Accessions automatically saved to database
```

### Background Processing (Optional Enhancement)

For large submissions:
- Queue submission as background job
- Poll for status updates
- Send email notification on completion

---

## Implementation Phases

### Phase 1: Foundation (Required First)

1. **Update Prisma schema** - Add missing fields
2. **Add ENA settings UI** to admin settings page
3. **Create `/admin/submissions` page** (basic list)
4. **Add validation API** for studies/samples

### Phase 2: Core Submission

1. **XML generation library** - Port from v1 or use templates
2. **ENA API integration** - Submit to drop-box endpoint
3. **Response parsing** - Extract accession numbers
4. **Update database** with accessions

### Phase 3: Polish

1. **Bulk operations** - Submit multiple studies
2. **Progress tracking** - Real-time submission status
3. **Error handling** - Retry logic, detailed error messages
4. **Audit log** - Track all submission attempts

### Phase 4: Advanced (Future)

1. **Read submission** - Webin CLI integration
2. **Assembly/Bin submission** - For MAG workflows
3. **SRA/DDBJ support** - Other databases
4. **Webhook callbacks** - Async status updates

---

## File Structure

```
v2/src/
├── app/
│   ├── admin/
│   │   ├── submissions/              ← NEW
│   │   │   └── page.tsx              # ENA submissions list
│   │   └── settings/
│   │       └── page.tsx              # Add ENA section
│   └── api/
│       └── admin/
│           ├── settings/
│           │   └── ena/              ← NEW
│           │       ├── route.ts      # GET/PUT credentials
│           │       └── test/
│           │           └── route.ts  # POST test connection
│           └── submissions/          ← NEW
│               ├── route.ts          # GET list
│               └── [id]/
│                   ├── route.ts      # GET details
│                   └── submit/
│                       └── route.ts  # POST submit
├── lib/
│   └── ena/                          ← NEW
│       ├── xml-generator.ts          # Generate ENA XML
│       ├── api-client.ts             # ENA API calls
│       ├── validator.ts              # Validation logic
│       └── types.ts                  # ENA-specific types
└── components/
    └── admin/
        └── submissions/              ← NEW
            ├── SubmissionList.tsx
            ├── StudyValidation.tsx
            └── SubmissionProgress.tsx
```

---

## Validation Rules

### Study Validation

| Field | Rule | Error Message |
|-------|------|---------------|
| title | Required, min 10 chars | "Study title must be at least 10 characters" |
| alias | Required, unique, alphanumeric | "Study alias is required and must be unique" |
| description | Required, min 50 chars | "Description must be at least 50 characters" |
| checklistType | Required | "Please select an environment type" |

### Sample Validation

| Field | Rule | Error Message |
|-------|------|---------------|
| sampleAlias | Required, unique within study | "Sample alias must be unique" |
| sampleTitle | Required | "Sample title is required" |
| taxId | Required, valid NCBI taxon | "Valid NCBI taxonomy ID required" |
| checklistData | Has required MIxS fields | "Required metadata fields missing: {fields}" |

---

## Security Considerations

1. **Encrypt ENA password** - Use same encryption as v1 (Fernet or similar)
2. **Admin-only access** - All `/admin/submissions/*` routes require FACILITY_ADMIN
3. **Audit logging** - Log all submission attempts with timestamp and user
4. **Test mode default** - New installations default to test mode
5. **Confirmation dialog** - Require confirmation for production submissions

---

## Questions to Clarify

1. **Read submission priority?** - Should we include read/file submission in Phase 1, or defer to Phase 4?

2. **Auto-generate alias?** - Should study/sample aliases be auto-generated or user-provided?

3. **MIxS checklist updates?** - The current templates are from v1 - should we update to latest MIxS version?

4. **Center name requirement?** - Is center name required for your ENA account?

5. **Email notifications?** - Should the system email researchers when their study is submitted?

---

## Next Steps

1. Review and approve this plan
2. Update Prisma schema
3. Implement ENA settings UI (quick win)
4. Create submissions page skeleton
5. Implement validation logic
6. Add XML generation
7. Integrate ENA API
