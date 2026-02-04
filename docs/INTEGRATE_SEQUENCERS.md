# Sequencer Device Integration Plan

## Overview

Extend the existing Sequencing Technologies module to support **specific sequencer devices** (e.g. MinION Mk1D, PromethION 2 Solo) with their **compatible accessories** (flow cells, kits, software). Admins can enable/disable individual items to reflect what their facility actually offers. Users see a guided multi-step selector in the order form.

### Current State

- `data/sequencing-technologies/defaults.json` defines **platforms** (NovaSeq, MinION, Revio, etc.) with specs, pros/cons, and follow-up options (read length, coverage).
- The `SequencingTechnology` type in `src/types/sequencing-technology.ts` stores platform-level information.
- The `sequencing-tech` field type renders an interactive card selector in the order form.
- Config is stored in `SiteSettings.extraSettings.sequencingTechConfig`.

### What's Missing

The current model is platform-level only. It doesn't capture:
- **Specific device models** (MinION Mk1D vs Mk1B, PromethION 2 vs 48)
- **Compatible accessories** (which flow cells, kits, software work with which device)
- **Product images** for devices and accessories
- **Multi-step selection** (pick device -> pick flow cell -> pick kit)
- **Per-item enable/disable** (a site may only stock certain kits)

---

## Data Model

### New Types (`src/types/sequencing-technology.ts`)

```typescript
// A specific sequencer device (e.g. MinION Mk1D)
export interface SequencerDevice {
  id: string;                        // e.g. "ont-minion-mk1d"
  platformId: string;                // links to parent SequencingTechnology.id (e.g. "ont-minion")
  name: string;                      // "MinION Mk1D"
  manufacturer: string;              // "Oxford Nanopore"
  productOverview: string;           // Rich text / markdown product description
  shortDescription: string;          // One-liner for cards
  image?: string;                    // Path or URL to product image
  color?: string;                    // Brand color hex

  // Technical specifications
  specs: TechnologySpec[];           // Reuse existing type
  connectivity?: string;             // e.g. "USB-C"
  features?: string[];               // e.g. ["Status LEDs", "Improved thermal dissipation"]

  // Compatibility references (IDs into companion arrays)
  compatibleFlowCells: string[];     // FlowCell IDs
  compatibleKits: string[];          // Kit IDs
  compatibleSoftware: string[];      // Software IDs

  // Admin controls
  available: boolean;                // Enabled at this facility
  comingSoon?: boolean;
  order: number;                     // Display order within platform

  // Metadata
  sourceUrl?: string;                // Link to manufacturer page
  lastUpdated?: string;
}

// Flow cell definition
export interface FlowCell {
  id: string;                        // e.g. "flo-min114"
  name: string;                      // "MinION/GridION Flow Cell R10.4.1"
  sku: string;                       // "FLO-MIN114"
  description?: string;
  chemistry?: string;                // e.g. "R10.4.1"
  poreCount?: number;                // e.g. 2048
  maxOutput?: string;                // e.g. "50 Gb"
  category: "standard" | "rna" | "flongle" | "other";
  image?: string;
  available: boolean;                // Admin toggle
  order: number;
  sourceUrl?: string;
}

// Library prep / sequencing kit
export interface SequencingKit {
  id: string;                        // e.g. "sqk-lsk114"
  name: string;                      // "Ligation Sequencing Kit V14"
  sku: string;                       // "SQK-LSK114"
  description?: string;
  category: "ligation" | "rapid" | "barcoding" | "pcr" | "cdna" | "direct-rna" | "amplicon" | "other";
  inputType?: "dna" | "rna" | "both";
  multiplexing?: boolean;            // Supports barcoding/multiplexing
  barcodeCount?: number;             // e.g. 24, 96
  image?: string;
  available: boolean;
  order: number;
  sourceUrl?: string;
}

// Software tool
export interface SequencingSoftware {
  id: string;                        // e.g. "minknow"
  name: string;                      // "MinKNOW"
  description?: string;
  category: "control" | "basecalling" | "analysis" | "other";
  version?: string;
  downloadUrl?: string;
  available: boolean;
  order: number;
}

// Extended config (replaces current SequencingTechConfig)
export interface SequencingTechConfig {
  technologies: SequencingTechnology[];   // Existing platform-level entries
  devices: SequencerDevice[];             // NEW - specific device models
  flowCells: FlowCell[];                  // NEW
  kits: SequencingKit[];                  // NEW
  software: SequencingSoftware[];         // NEW
  categories?: TechnologyCategory[];
  lastSyncedAt?: string;
  syncUrl?: string;
  version: number;
}
```

### Relationship Diagram

```
SequencingTechnology (platform)
  e.g. "Oxford Nanopore MinION"
       |
       +-- SequencerDevice (specific model)
       |     e.g. "MinION Mk1D"
       |          |
       |          +-- compatibleFlowCells[] --> FlowCell[]
       |          |     e.g. FLO-MIN114, FLO-MIN004RA, FLO-FLG114
       |          |
       |          +-- compatibleKits[] --> SequencingKit[]
       |          |     e.g. SQK-LSK114, SQK-RAD114, ...
       |          |
       |          +-- compatibleSoftware[] --> SequencingSoftware[]
       |                e.g. MinKNOW, Dorado
       |
       +-- SequencerDevice
             e.g. "MinION Mk1B"
```

---

## Default Data File

### `data/sequencing-devices/ont-minion.json`

Create a per-platform JSON file structure under `data/sequencing-devices/`. Each file contains the devices, flow cells, kits, and software for one platform family. These get merged into the config on first load (same pattern as `data/sequencing-technologies/defaults.json`).

```
data/sequencing-devices/
  ont-minion.json        # MinION Mk1D, Mk1B
  ont-promethion.json    # PromethION 2 Solo, PromethION 48, etc.
  illumina-miseq.json    # MiSeq, MiSeq Dx
  illumina-novaseq.json  # NovaSeq 6000, NovaSeq X, X Plus
  pacbio-revio.json      # Revio
  ...
```

Starting with `ont-minion.json` containing the MinION Mk1D data provided by the user.

### Product Images

Store product images under `public/images/sequencers/`:

```
public/images/sequencers/
  devices/
    ont-minion-mk1d.png
    ont-minion-mk1b.png
  flow-cells/
    flo-min114.png
    flo-flg114.png
  kits/
    sqk-lsk114.png
  ...
```

Admins can also upload custom images via the admin panel (stored as uploaded files or as URLs).

---

## Admin Panel Changes

### 1. Sequencer Devices Tab (new tab in `/admin/sequencing-tech`)

Add a tabbed layout to the existing Sequencing Technologies admin page:

- **Tab 1: Platforms** (existing) -- the current technology card editor
- **Tab 2: Devices** (new) -- manage specific device models
- **Tab 3: Accessories** (new) -- manage flow cells, kits, software

#### Devices Tab

- List of device cards grouped by platform (manufacturer)
- Each card shows: image thumbnail, name, SKU, enabled/disabled toggle
- Click to expand/edit: full product overview, specs, compatible accessories (checkboxes), image upload
- "Add Device" button to create custom entries
- Bulk enable/disable per manufacturer

#### Accessories Tab

Three sub-sections (or sub-tabs): **Flow Cells**, **Kits**, **Software**

Each section:
- Table/list view with columns: Name, SKU, Category, Enabled toggle
- Click to edit details
- "Add" button for custom entries
- Filter by manufacturer / category
- Shows which devices reference each accessory (reverse lookup)

### 2. Compatibility Matrix

Optional view showing a matrix of devices vs. accessories with checkmarks. Admins can toggle compatibility from here.

---

## Order Form Changes

### Multi-Step Sequencing Selector

When the `sequencing-tech` field is in the order form AND the Sequencing Technologies module is enabled, the user flow becomes:

```
Step 1: Select Platform (existing card selector)
  - Shows SequencingTechnology cards (Illumina, ONT, PacBio, etc.)
  - Only platforms with at least one available device are shown

Step 2: Select Device (new)
  - Shows SequencerDevice cards for the chosen platform
  - Each card: product image, name, short description, key specs
  - If only one device exists for the platform, auto-select and skip

Step 3: Select Flow Cell (new)
  - Shows compatible FlowCell options (filtered by device compatibility + enabled)
  - Card or list with name, SKU, chemistry, pore count
  - If only one option, auto-select and skip

Step 4: Select Kit (new)
  - Shows compatible SequencingKit options (filtered by device + enabled)
  - Grouped by category (Ligation, Rapid, Barcoding, etc.)
  - Card or list with name, SKU, description
  - Optional: filter by input type (DNA/RNA)

Step 5: Software note (informational, no selection needed)
  - Shows compatible software (MinKNOW, Dorado, etc.) as an info box
  - "These tools will be used for your sequencing run"
```

### Stored Value

The `sequencing-tech` field value expands from the current `{technologyId, technologyName}` to:

```typescript
interface SequencingTechSelection {
  technologyId: string;          // Platform ID (existing)
  technologyName?: string;       // Platform name (existing)
  deviceId?: string;             // Device model ID (new)
  deviceName?: string;           // Device name (new)
  flowCellId?: string;           // Selected flow cell (new)
  flowCellSku?: string;          // Flow cell SKU (new)
  kitId?: string;                // Selected kit (new)
  kitSku?: string;               // Kit SKU (new)
  // Existing follow-up options preserved
  [optionId: string]: unknown;
}
```

Backward compatible: if no devices/accessories are configured, the selector falls back to the current platform-only behavior.

---

## Implementation Steps

### Phase 1: Data Model & Defaults

1. **Extend types** in `src/types/sequencing-technology.ts` with `SequencerDevice`, `FlowCell`, `SequencingKit`, `SequencingSoftware`
2. **Update `SequencingTechConfig`** to include the new arrays (backward compatible -- missing arrays default to `[]`)
3. **Create `data/sequencing-devices/ont-minion.json`** with MinION Mk1D data (product overview, compatible flow cells, kits, software from the user's specifications)
4. **Create `public/images/sequencers/`** directory structure (images can be added later)
5. **Update the API route** (`src/app/api/admin/sequencing-tech/route.ts`) to load and merge device data files on first access

### Phase 2: Admin Panel - Device Management

6. **Add tabbed layout** to `/admin/sequencing-tech` page (Platforms | Devices | Accessories)
7. **Build Devices tab** -- list, enable/disable, edit details, image upload
8. **Build Accessories tab** -- flow cells, kits, software management with enable/disable toggles
9. **Add image upload** endpoint and storage (reuse any existing upload patterns in the codebase)

### Phase 3: Order Form - Multi-Step Selector

10. **Update `SequencingTechFormRenderer`** to support multi-step selection (device -> flow cell -> kit)
11. **Update the stored field value** format (`SequencingTechSelection`)
12. **Add backward compatibility** -- if no devices configured, fall back to platform-only
13. **Update order detail/summary views** to display the full selection (device + accessories)

### Phase 4: Polish

14. **Order summary** -- show selected device/flow cell/kit in order confirmation and admin order view
15. **Validation** -- ensure selected accessories are compatible with chosen device
16. **Default data** -- add more device files for other platforms (PromethION, Illumina, PacBio) as needed

---

## MinION Mk1D Seed Data

The first device file `data/sequencing-devices/ont-minion.json` will contain:

```json
{
  "platformId": "ont-minion",
  "devices": [
    {
      "id": "ont-minion-mk1d",
      "name": "MinION Mk1D",
      "manufacturer": "Oxford Nanopore",
      "shortDescription": "Next-generation portable nanopore sequencing device with USB-C",
      "productOverview": "The MinION Mk1D is the next generation of portable nanopore sequencing devices...",
      "connectivity": "USB-C",
      "features": [
        "Improved thermal dissipation",
        "Status LEDs for device status",
        "Compatible with MinION and Flongle flow cells",
        "DNA and RNA sequencing",
        "Operated via MinKNOW software"
      ],
      "compatibleFlowCells": ["flo-min114", "flo-min004ra", "flo-flg114"],
      "compatibleKits": [
        "sqk-lsk114", "sqk-lsk114-xl", "sqk-ulk114",
        "sqk-mlk114-96-xl", "sqk-rad114",
        "sqk-rbk114-24", "sqk-rbk114-96", "sqk-rpb114-24",
        "sqk-nbd114-24", "sqk-nbd114-96",
        "sqk-16s114-24",
        "sqk-pcs114", "sqk-pcb114-24",
        "sqk-rna004"
      ],
      "compatibleSoftware": ["minknow", "dorado"],
      "available": true,
      "order": 1,
      "sourceUrl": "https://nanoporetech.com/products/minion"
    }
  ],
  "flowCells": [
    {
      "id": "flo-min114",
      "name": "MinION/GridION Flow Cell R10.4.1",
      "sku": "FLO-MIN114",
      "chemistry": "R10.4.1",
      "category": "standard",
      "available": true,
      "order": 1
    },
    {
      "id": "flo-min004ra",
      "name": "MinION/GridION Flow Cell - RNA",
      "sku": "FLO-MIN004RA",
      "category": "rna",
      "available": true,
      "order": 2
    },
    {
      "id": "flo-flg114",
      "name": "Flongle Flow Cell",
      "sku": "FLO-FLG114",
      "description": "Requires Flongle adapter",
      "category": "flongle",
      "available": true,
      "order": 3
    }
  ],
  "kits": [
    { "id": "sqk-lsk114", "name": "Ligation Sequencing Kit V14", "sku": "SQK-LSK114", "category": "ligation", "inputType": "dna", "available": true, "order": 1 },
    { "id": "sqk-lsk114-xl", "name": "Ligation Sequencing Kit XL V14", "sku": "SQK-LSK114-XL", "category": "ligation", "inputType": "dna", "available": true, "order": 2 },
    { "id": "sqk-ulk114", "name": "Ultra-Long DNA Sequencing Kit V14", "sku": "SQK-ULK114", "category": "ligation", "inputType": "dna", "available": true, "order": 3 },
    { "id": "sqk-mlk114-96-xl", "name": "Multiplex Ligation Sequencing Kit XL V14", "sku": "SQK-MLK114.96-XL", "category": "ligation", "inputType": "dna", "multiplexing": true, "barcodeCount": 96, "available": true, "order": 4 },
    { "id": "sqk-rad114", "name": "Rapid Sequencing Kit V14", "sku": "SQK-RAD114", "category": "rapid", "inputType": "dna", "available": true, "order": 5 },
    { "id": "sqk-rbk114-24", "name": "Rapid Barcoding Kit 24 V14", "sku": "SQK-RBK114.24", "category": "barcoding", "inputType": "dna", "multiplexing": true, "barcodeCount": 24, "available": true, "order": 6 },
    { "id": "sqk-rbk114-96", "name": "Rapid Barcoding Kit 96 V14", "sku": "SQK-RBK114.96", "category": "barcoding", "inputType": "dna", "multiplexing": true, "barcodeCount": 96, "available": true, "order": 7 },
    { "id": "sqk-rpb114-24", "name": "Rapid PCR Barcoding Kit 24 V14", "sku": "SQK-RPB114.24", "category": "pcr", "inputType": "dna", "multiplexing": true, "barcodeCount": 24, "available": true, "order": 8 },
    { "id": "sqk-nbd114-24", "name": "Native Barcoding Kit 24 V14", "sku": "SQK-NBD114.24", "category": "barcoding", "inputType": "dna", "multiplexing": true, "barcodeCount": 24, "available": true, "order": 9 },
    { "id": "sqk-nbd114-96", "name": "Native Barcoding Kit 96 V14", "sku": "SQK-NBD114.96", "category": "barcoding", "inputType": "dna", "multiplexing": true, "barcodeCount": 96, "available": true, "order": 10 },
    { "id": "sqk-16s114-24", "name": "16S Barcoding Kit 24 V14", "sku": "SQK-16S114.24", "category": "amplicon", "inputType": "dna", "multiplexing": true, "barcodeCount": 24, "available": true, "order": 11 },
    { "id": "sqk-pcs114", "name": "cDNA-PCR Sequencing Kit V14", "sku": "SQK-PCS114", "category": "cdna", "inputType": "rna", "available": true, "order": 12 },
    { "id": "sqk-pcb114-24", "name": "cDNA-PCR Barcoding Kit V14", "sku": "SQK-PCB114.24", "category": "cdna", "inputType": "rna", "multiplexing": true, "barcodeCount": 24, "available": true, "order": 13 },
    { "id": "sqk-rna004", "name": "Direct RNA Sequencing Kit", "sku": "SQK-RNA004", "category": "direct-rna", "inputType": "rna", "available": true, "order": 14 }
  ],
  "software": [
    { "id": "minknow", "name": "MinKNOW", "description": "Device control, data acquisition, and basecalling software", "category": "control", "available": true, "order": 1 },
    { "id": "dorado", "name": "Dorado", "description": "High-performance basecalling server", "category": "basecalling", "available": true, "order": 2 }
  ]
}
```

---

## Key Design Decisions

1. **JSON file-based defaults** (not database migrations) -- same pattern as existing sequencing tech. Easy to add new devices by dropping a JSON file into `data/sequencing-devices/`. Config gets loaded into `SiteSettings.extraSettings` on first access.

2. **Backward compatible** -- the new arrays (`devices`, `flowCells`, `kits`, `software`) are optional in `SequencingTechConfig`. If empty, the order form falls back to the existing platform-only selector.

3. **Per-item enable/disable** -- every device, flow cell, kit, and software entry has an `available` boolean. Admins toggle these to match their facility's inventory. This is the core mechanism for "some sites only offer part of these."

4. **Compatibility via ID references** -- each device lists compatible accessory IDs. The order form filters options based on these references. Adding a new kit just means adding it to the kits array and referencing its ID from the relevant devices.

5. **Image support** -- `image` field on devices and accessories. Can be a relative path (served from `public/`) or an external URL. Admin panel includes image upload.

6. **Multi-step selection auto-skips** -- if a step has only one enabled option, it auto-selects and skips to the next step. This keeps the flow smooth for facilities with limited inventory.

7. **No Prisma schema changes** -- all data stored as JSON in existing `SiteSettings.extraSettings`. This avoids migration complexity and keeps the architecture consistent with how sequencing tech config already works.
