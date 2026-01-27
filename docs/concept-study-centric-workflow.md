# Concept: Study-Centric Workflow Redesign

## Problem Statement

**Current architecture:**
- Order → Samples → (optional) Study assignment
- MIxS checklist selection happens at Order level
- All samples in an order share the same metadata schema

**Real-world scenario:**
- Researcher creates 1 order with 30 samples
- 10 samples belong to "Gut Microbiome Study" (needs MIxS human-gut checklist)
- 20 samples belong to "River Water Study" (needs MIxS water checklist)
- Currently impossible: can only select ONE MIxS checklist per order

## Proposed Solution

### New Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                           ORDER                                      │
│  - Basic info (name, contact, billing)                              │
│  - Sequencing parameters (platform, library prep)                   │
│  - Order-level custom fields                                        │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          SAMPLES                                     │
│  - Sample identifiers (ID, title)                                   │
│  - Basic sample info                                                │
│  - NO MIxS metadata here (moved to study level)                     │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
┌─────────────────────────────┐   ┌─────────────────────────────┐
│      STUDY A                │   │      STUDY B                │
│  "Gut Microbiome"           │   │  "River Water Analysis"     │
│                             │   │                             │
│  - MIxS: human-gut          │   │  - MIxS: water              │
│  - 10 samples assigned      │   │  - 20 samples assigned      │
│  - Study-specific fields    │   │  - Study-specific fields    │
│  - ENA submission           │   │  - ENA submission           │
└─────────────────────────────┘   └─────────────────────────────┘
```

### Key Changes

#### 1. Study Model Enhancement

```prisma
model Study {
  id                  String    @id @default(cuid())
  title               String
  description         String?

  // NEW: MIxS checklist type
  checklistType       String?   // e.g., "human-gut", "water", "soil"

  // NEW: Study-level metadata (MIxS fields)
  metadata            String?   // JSON: MIxS field values

  // Existing
  submitted           Boolean   @default(false)
  studyAccessionId    String?

  // Relations
  samples             Sample[]
  user                User      @relation(...)
}
```

#### 2. Sample Model Simplification

```prisma
model Sample {
  id                  String    @id @default(cuid())
  sampleId            String    // User's sample identifier
  sampleTitle         String?

  // Sample-specific MIxS fields (varies per sample within study)
  sampleMetadata      String?   // JSON: sample-specific field values

  // Relations
  order               Order     @relation(...)
  study               Study?    @relation(...)
}
```

#### 3. Form Builder Split

**Order Form Builder** (existing, simplified):
- Contact information fields
- Billing/administrative fields
- Sequencing parameters
- Order-level custom fields

**Study Form Builder** (NEW):
- MIxS checklist selection
- Study-level fields (shared by all samples in study)
- Sample-level fields (unique per sample)
- Field templates per environment type

### New User Workflow

#### Step 1: Create Order
```
/dashboard/orders/new
├── Order name
├── Contact information
├── Sequencing parameters (platform, library prep)
└── [Next: Add Samples]
```

#### Step 2: Add Samples
```
/dashboard/orders/{id}/samples
├── Bulk add sample IDs (spreadsheet interface)
├── Basic sample info only
└── [Next: Create/Assign Studies]
```

#### Step 3: Create & Assign Studies
```
/dashboard/orders/{id}/studies
├── Create new study OR select existing
│   ├── Study title
│   ├── Description
│   └── MIxS checklist type (gut, water, soil, etc.)
├── Drag-and-drop samples to studies
├── Visual grouping of samples by study
└── [Next: Fill Study Metadata]
```

#### Step 4: Fill Study Metadata
```
/dashboard/studies/{id}/metadata
├── Study-level fields (apply to all samples)
│   └── e.g., "geographic location", "collection date range"
├── Sample-level fields (unique per sample)
│   └── e.g., "sample collection date", "host age"
└── Validation & completion status
```

### Dashboard Visualization

```
┌──────────────────────────────────────────────────────────────────┐
│  Order: ORD-20240115-0001                                        │
│  Status: Ready for Sequencing                                    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────┐  ┌────────────────────────┐│
│  │ 📚 Gut Microbiome Study         │  │ 📚 River Water Study   ││
│  │ MIxS: human-gut                 │  │ MIxS: water            ││
│  │ ████████░░ 80% complete         │  │ ██████████ 100%        ││
│  │                                 │  │                        ││
│  │ • SAMPLE-001                    │  │ • SAMPLE-011           ││
│  │ • SAMPLE-002                    │  │ • SAMPLE-012           ││
│  │ • SAMPLE-003                    │  │ • ...                  ││
│  │ • ... (10 samples)              │  │ • (20 samples)         ││
│  │                                 │  │                        ││
│  │ [Edit Metadata]                 │  │ [Edit Metadata]        ││
│  └─────────────────────────────────┘  └────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────┐                            │
│  │ ⚠️ Unassigned Samples (5)       │                            │
│  │                                 │                            │
│  │ • SAMPLE-031                    │                            │
│  │ • SAMPLE-032                    │                            │
│  │ • ...                           │                            │
│  │                                 │                            │
│  │ [Assign to Study]               │                            │
│  └─────────────────────────────────┘                            │
└──────────────────────────────────────────────────────────────────┘
```

### Implementation Plan

#### Phase 1: Database & API Changes
1. Add `checklistType` and `metadata` to Study model
2. Add `sampleMetadata` to Sample model
3. Create API endpoints for study metadata
4. Migration script for existing data

#### Phase 2: Study Form Builder
1. Create `/admin/study-form-builder` page
2. MIxS checklist template selection
3. Define study-level vs sample-level fields
4. Field inheritance from MIxS templates

#### Phase 3: Order Workflow Redesign
1. Simplify order creation (remove MIxS from order level)
2. New study assignment page `/dashboard/orders/{id}/studies`
3. Drag-and-drop sample-to-study assignment
4. Visual sample grouping

#### Phase 4: Study Metadata Entry
1. New metadata entry page `/dashboard/studies/{id}/metadata`
2. Spreadsheet interface for sample-level fields
3. Progress tracking per study
4. Validation based on MIxS requirements

#### Phase 5: Dashboard Visualization
1. Order detail page with study grouping
2. Completion progress per study
3. Quick navigation to metadata entry
4. Unassigned samples warning

### Files to Modify/Create

**Database:**
- `prisma/schema.prisma` - Update Study and Sample models

**API Routes:**
- `src/app/api/studies/[id]/metadata/route.ts` - NEW
- `src/app/api/admin/study-form-config/route.ts` - NEW
- `src/app/api/orders/[id]/route.ts` - Update to include study grouping

**Admin Pages:**
- `src/app/admin/study-form-builder/page.tsx` - NEW
- `src/app/admin/form-builder/page.tsx` - Simplify (order-only fields)

**User Pages:**
- `src/app/dashboard/orders/[id]/studies/page.tsx` - NEW (assignment UI)
- `src/app/dashboard/studies/[id]/metadata/page.tsx` - NEW
- `src/app/dashboard/orders/[id]/page.tsx` - Update visualization
- `src/app/dashboard/page.tsx` - Update to show study progress

**Components:**
- `src/components/studies/SampleAssignment.tsx` - NEW (drag-drop)
- `src/components/studies/StudyCard.tsx` - NEW
- `src/components/studies/MetadataForm.tsx` - NEW

### Migration Strategy

For existing orders:
1. Keep current data intact
2. If order has MIxS fields filled, create a "Default Study" and move metadata there
3. Assign all samples to the default study
4. Users can split into multiple studies later

### Open Questions

1. **Sample-level vs Study-level fields:** Which MIxS fields should be:
   - Study-level (same for all samples): geographic_location, project_name
   - Sample-level (unique per sample): collection_date, host_age, sample_name

2. **Existing Form Builder:** Keep for order-level fields or completely redesign?

3. **ENA Submission:** Each study = one ENA study? Or can one ENA study have mixed checklists?

4. **Backward Compatibility:** How to handle orders created before this change?
