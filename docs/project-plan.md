# Order, Study, Sample Relationship Plan

## Current State Analysis

### Existing Schema
- **Order**: Administrative entity for sequencing requests (facility workflow)
  - Has samples, status tracking, sequencing parameters
  - Has optional `linkedStudyId` for auto-created 1:1 linked studies

- **Study**: ENA submission grouping entity
  - Has samples assigned to it
  - Has ENA accession tracking, submission status
  - Currently linked 1:1 to an Order via `linkedOrder`

- **Sample**: The sequenceable unit (each becomes one or paired-end sequence file)
  - Required: belongs to exactly one Order
  - Optional: can be assigned to one Study

### Problem Statement
1. The 1:1 Order-Study relationship is too restrictive
2. A Study should be a biologically meaningful grouping that:
   - Can contain samples from **multiple orders**
   - Can contain a **subset** of samples from an order
3. Order-based operations: QC, sequencing workflow, data delivery
4. Study-based operations: ENA submission, publication grouping

---

## Proposed Concept

### Entity Relationships (Updated)

```
User
 ├── Orders (sequencing requests - facility workflow)
 │    └── Samples (administrative ownership, sequencing context)
 │
 └── Studies (scientific grouping - publication/ENA workflow)
      └── Samples (via assignment, many samples can belong to one study)
```

**Key Changes:**
1. **Remove** the `linkedStudyId` 1:1 relationship from Order
2. **Keep** Sample → Order (required, one-to-one)
3. **Keep** Sample → Study (optional, many-to-one)
4. Studies are **independent entities** created by users for ENA submission

### Workflow

#### For Researchers (Entry Point: Orders)

1. **Create Order** → Fill in sequencing parameters, contact info
2. **Add Samples** → Enter sample metadata (MIxS checklists)
3. **Submit Order** → Status: "Ready for Sequencing"
4. *(Facility processes order)*
5. **Create/Select Study** → Group samples for ENA submission
6. **Assign Samples to Study** → Select from their completed orders
7. **Submit to ENA** → Per-study basis

#### For Facility Admins (Processing)

1. **Receive Orders** → See all submitted orders
2. **Process Order** → Update status through workflow
3. **Run QC** → Per-order or per-sample basis
4. **Deliver Data** → Per-order basis
5. **ENA Submission** → Per-study basis (when researcher has grouped samples)

---

## Database Changes

### Remove from `Order` model:
```prisma
// REMOVE these fields:
linkedStudyId     String?  @unique
linkedStudy       Study?   @relation("LinkedStudy", fields: [linkedStudyId], references: [id])
```

### Remove from `Study` model:
```prisma
// REMOVE this field:
linkedOrder       Order?    @relation("LinkedStudy")
```

### Keep existing Sample relationships:
```prisma
model Sample {
  // ... existing fields ...

  // Required: belongs to one Order (sequencing context)
  orderId    String
  order      Order    @relation(...)

  // Optional: assigned to one Study (submission context)
  studyId    String?
  study      Study?   @relation(...)
}
```

---

## UI/UX Changes

### 1. Orders Page (No Change)
- Researchers create orders, add samples
- Focus on sequencing workflow

### 2. Studies Page (Enhanced)

**Empty State Message:**
> "Studies group your samples for ENA submission. Once your sequencing order is complete, create a study and assign samples from one or more orders."

**Create Study Flow:**
1. Enter study title and description
2. **Sample Assignment Step**: Show samples from all user's orders
   - Filter by order, by status (completed orders only for ENA)
   - Checkbox selection
   - Show which samples are already assigned to other studies

### 3. Order Detail Page (Enhanced)

Add a **"Studies"** section showing:
- Which samples are assigned to which studies
- Quick action: "Create Study from this Order's Samples"
- Link to study detail pages

### 4. Study Detail Page (New/Enhanced)

**Sections:**
1. **Study Info**: Title, description, ENA accession (if submitted)
2. **Assigned Samples**: List with source order info
   - Add/remove samples button
   - Show sample status, order status
3. **ENA Submission**:
   - Only enabled when all assigned samples have completed sequencing
   - Show validation status
   - Submit button

### 5. Sample Assignment Modal (New Component)

**When assigning samples to a study:**
- Show all user's samples grouped by order
- Filter: All / Unassigned / From specific order
- Show sample status, order status
- Warning for samples from incomplete orders: "This sample's order is still in progress. You can assign it now but cannot submit to ENA until sequencing is complete."

---

## Guidance/Help Text

### On Studies Page Header:
> "A study is a collection of samples that you want to submit together to the European Nucleotide Archive (ENA). Samples in a study can come from one or multiple sequencing orders."

### On Study Creation:
> "Give your study a descriptive title that reflects the biological context (e.g., 'Soil microbiome survey 2024'). This title will appear in ENA."

### On Sample Assignment:
> "Select samples to include in this study. Samples can only belong to one study at a time. For ENA submission, all samples must have completed sequencing."

### On Order Detail Page (Studies section):
> "Samples from this order can be grouped into studies for ENA submission. One order's samples can be split across multiple studies, or combined with samples from other orders."

---

## Implementation Checklist

### Phase 1: Schema & API
- [ ] Remove `linkedStudyId` from Order model
- [ ] Remove `linkedOrder` from Study model
- [ ] Run migration
- [ ] Update Order API (remove study auto-creation)
- [ ] Update Study API (create independent studies)
- [ ] Create sample assignment API endpoint

### Phase 2: Study Management UI
- [ ] Update Studies list page with new guidance
- [ ] Create/update Study detail page
- [ ] Add sample assignment modal component
- [ ] Add "Assign Samples" button and flow

### Phase 3: Order Integration
- [ ] Add "Studies" section to Order detail page
- [ ] Show sample-study assignments
- [ ] Add "Create Study from Order" quick action

### Phase 4: ENA Submission
- [ ] Update ENA submission to work per-study
- [ ] Add validation (all samples must have completed orders)
- [ ] Show submission status per study

---

## Design Principles

1. **Flexible, not restrictive**: No forced locking - users can always edit
2. **Clean start**: No legacy data concerns
3. **Simple rules**:
   - A sample belongs to one order (required)
   - A sample can optionally be assigned to one study
   - Samples can be reassigned between studies at any time
4. **Warnings, not blocks**: Show warnings for risky actions (e.g., editing submitted study) but allow it

---

## Review Notes

### Implementation Complete

**Schema Changes:**
- Removed `linkedStudyId` from Order model
- Removed `linkedOrder` from Study model
- Studies are now independent entities

**API Updates:**
- `/api/orders` - No longer auto-creates a linked study
- `/api/orders/[id]` - Removed linkedStudy references, added study info to samples
- `/api/studies` - Updated to remove linkedOrder references
- `/api/studies/[id]` - New: GET, PUT, DELETE for study management
- `/api/studies/[id]/samples` - New: POST (assign) and DELETE (unassign) samples
- `/api/samples` - New: GET all samples for assignment UI

**UI Updates:**
- **Studies list page** - Added guidance explaining Order vs Study concept
- **New Study page** - Created `/dashboard/studies/new` for creating studies
- **Study detail page** - Created `/dashboard/studies/[id]` with:
  - Study info editing
  - Sample assignment modal
  - List of assigned samples with remove capability
- **Order detail page** - Added:
  - Study links on samples
  - "ENA Study Assignments" section showing grouped samples by study

**Workflow:**
1. User creates Order → adds Samples
2. User creates Study (independent)
3. User assigns Samples from orders to Study
4. ENA submission happens per-Study
