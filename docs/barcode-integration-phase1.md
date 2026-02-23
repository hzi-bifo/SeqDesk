# Barcode Integration - Phase 1: Data & Plumbing

## What Changed

Phase 1 integrates ONT barcode kit/scheme metadata into the SeqDesk.com central registry and updates the main SeqDesk app to consume it through the existing sync mechanism. No UI changes beyond a bug fix in the kit save handler.

---

## SeqDesk.com (Central Registry)

### `src/data/sequencing-tech.json`

**Version bump**: 4 → 5

**New top-level arrays added:**

`barcodeSchemes` — 5 entries describing barcode chemistry families:

| id | name | chemistry |
|----|------|-----------|
| `native_nb` | Native Barcoding (NB) | ligation |
| `rapid_rb` | Rapid Barcoding (RB) | rapid |
| `pcr_cdna_bp` | PCR/cDNA Barcoding (BP) | pcr |
| `16s_primers` | 16S Barcoding Primers | amplicon |
| `rapid_pcr_rlb` | Rapid PCR Barcoding (RLB) | rapid-pcr |

`barcodeSets` — 7 entries linking scheme to barcode count/range:

| id | schemeId | count | range |
|----|----------|-------|-------|
| `NB01_24` | native_nb | 24 | 1-24 |
| `NB01_96` | native_nb | 96 | 1-96 |
| `RB01_24` | rapid_rb | 24 | 1-24 |
| `RB01_96` | rapid_rb | 96 | 1-96 |
| `BP01_24` | pcr_cdna_bp | 24 | 1-24 |
| `16S01_24` | 16s_primers | 24 | 1-24 |
| `RLB01_24` | rapid_pcr_rlb | 24 | 1-24 |

**Enriched kit entries** — all 14 kits now have `kitKind`, `doradoKitName`, and a `barcoding` object:

```jsonc
// Example: built-in barcoding kit
{
  "id": "sqk-rbk114-24",
  "kitKind": "barcoding_and_sequencing",
  "doradoKitName": "SQK-RBK114-24",
  "barcoding": {
    "supported": true,
    "builtIn": true,
    "requiresAdditionalBarcodeKit": false,
    "barcodeSetId": "RB01_24",
    "maxBarcodesPerRun": 24
  }
}

// Example: sequencing-only kit that needs a companion barcode kit
{
  "id": "sqk-lsk114",
  "kitKind": "sequencing_only",
  "barcoding": {
    "supported": true,
    "builtIn": false,
    "requiresAdditionalBarcodeKit": true,
    "compatibleBarcodeKits": ["sqk-nbd114-24", "sqk-nbd114-96"]
  }
}

// Example: no barcoding at all
{
  "id": "sqk-rna004",
  "kitKind": "sequencing_only",
  "barcoding": {
    "supported": false,
    "builtIn": false,
    "requiresAdditionalBarcodeKit": false
  }
}
```

Full kit mapping:

| Kit | kitKind | supported | builtIn | barcodeSetId | compatibleBarcodeKits |
|-----|---------|-----------|---------|--------------|----------------------|
| sqk-lsk114 | sequencing_only | true | false | — | sqk-nbd114-24, sqk-nbd114-96 |
| sqk-lsk114-xl | sequencing_only | true | false | — | sqk-nbd114-24, sqk-nbd114-96 |
| sqk-ulk114 | sequencing_only | false | false | — | — |
| sqk-mlk114-96-xl | barcoding_and_sequencing | true | true | NB01_96 | — |
| sqk-rad114 | sequencing_only | true | false | — | sqk-rbk114-24, sqk-rbk114-96 |
| sqk-rbk114-24 | barcoding_and_sequencing | true | true | RB01_24 | — |
| sqk-rbk114-96 | barcoding_and_sequencing | true | true | RB01_96 | — |
| sqk-rpb114-24 | barcoding_and_sequencing | true | true | RLB01_24 | — |
| sqk-nbd114-24 | barcoding_and_sequencing | true | true | NB01_24 | — |
| sqk-nbd114-96 | barcoding_and_sequencing | true | true | NB01_96 | — |
| sqk-16s114-24 | barcoding_and_sequencing | true | true | 16S01_24 | — |
| sqk-pcs114 | sequencing_only | true | false | — | sqk-pcb114-24 |
| sqk-pcb114-24 | barcoding_and_sequencing | true | true | BP01_24 | — |
| sqk-rna004 | sequencing_only | false | false | — | — |

**No API route changes needed** — the `GET /api/sequencing-tech` endpoint at `src/app/api/sequencing-tech/route.ts` spreads the full JSON (`{ ...sequencingTech }`), so new keys are served automatically.

---

## SeqDesk App (Main App)

### 1. New Types — `src/types/sequencing-technology.ts`

Three new interfaces added before `SequencingKit`:

```typescript
// Line 109-117
export interface KitBarcoding {
  supported: boolean;
  builtIn: boolean;
  requiresAdditionalBarcodeKit: boolean;
  barcodeSetId?: string;
  maxBarcodesPerRun?: number;
  compatibleBarcodeKits?: string[];
}

// Line 120-125
export interface BarcodeScheme {
  id: string;
  name: string;
  chemistry: string;
  description?: string;
}

// Line 128-134
export interface BarcodeSet {
  id: string;
  name: string;
  schemeId: string;
  barcodeRange: [number, number];
  count: number;
}
```

`SequencingKit` extended with three new optional fields (line 126-128):

```typescript
kitKind?: "sequencing_only" | "barcoding_and_sequencing";
doradoKitName?: string;
barcoding?: KitBarcoding;
```

`SequencingTechConfig` extended (line 169-170):

```typescript
barcodeSchemes?: BarcodeScheme[];
barcodeSets?: BarcodeSet[];
```

`DEFAULT_TECH_CONFIG` extended (line 202-203):

```typescript
barcodeSchemes: [],
barcodeSets: [],
```

### 2. Config Normalization — `src/lib/sequencing-tech/config.ts`

`normalizeTechConfig()` now handles the two new arrays (line 103-108):

```typescript
barcodeSchemes: Array.isArray(config.barcodeSchemes)
  ? config.barcodeSchemes
  : defaults.barcodeSchemes || [],
barcodeSets: Array.isArray(config.barcodeSets)
  ? config.barcodeSets
  : defaults.barcodeSets || [],
```

### 3. Admin Sync Route — `src/app/api/admin/sequencing-tech/route.ts`

Three spots updated:

**`normalizeRemoteConfig()`** (line 65-66) — normalizes new arrays from remote:

```typescript
barcodeSchemes: Array.isArray(raw.barcodeSchemes) ? raw.barcodeSchemes : [],
barcodeSets: Array.isArray(raw.barcodeSets) ? raw.barcodeSets : [],
```

**PUT handler** (line 207-208) — preserves arrays on save:

```typescript
barcodeSchemes: config.barcodeSchemes ?? [],
barcodeSets: config.barcodeSets ?? [],
```

**`check-updates` POST handler** (line 356-371) — extracts and merges new arrays from remote using existing `mergeItems()`:

```typescript
const remoteBarcodeSchemes = Array.isArray(remoteConfig.barcodeSchemes)
  ? remoteConfig.barcodeSchemes : [];
const remoteBarcodeSets = Array.isArray(remoteConfig.barcodeSets)
  ? remoteConfig.barcodeSets : [];

// In mergedConfig:
barcodeSchemes: mergeItems(currentConfig.barcodeSchemes || [], remoteBarcodeSchemes),
barcodeSets: mergeItems(currentConfig.barcodeSets || [], remoteBarcodeSets),
```

### 4. Public API — `src/app/api/sequencing-tech/route.ts`

Response now includes new arrays (line 59-60):

```typescript
barcodeSchemes: config.barcodeSchemes || [],
barcodeSets: config.barcodeSets || [],
```

### 5. Kit Save Bug Fix — `src/app/admin/sequencing-tech/page.tsx`

`handleKitSave()` (~line 530) previously constructed a new `SequencingKit` object field-by-field, which would strip any fields not explicitly listed (like the new `barcoding`, `kitKind`, `doradoKitName`). Fixed by spreading the original kit first:

```typescript
// Before:
const normalizedKit: SequencingKit = {
  id: kitForm.id,
  name: kitForm.name,
  // ... only known form fields
};

// After:
const normalizedKit: SequencingKit = {
  ...editingKit,  // preserve synced fields
  id: kitForm.id,
  name: kitForm.name,
  // ... form fields override
};
```

---

## How It Flows

```
SeqDesk.com                          SeqDesk App
─────────────                        ───────────
sequencing-tech.json (v5)
  + barcodeSchemes[]
  + barcodeSets[]
  + kits[].barcoding
         │
         ▼
GET /api/sequencing-tech ──────────► Admin: "Check for Updates"
  (auto-serves new keys)               │
                                        ▼
                                   normalizeRemoteConfig()
                                   mergeItems() for all arrays
                                        │
                                        ▼
                                   SiteSettings.extraSettings (JSON)
                                        │
                                        ▼
                                   GET /api/sequencing-tech (public)
                                     → includes barcodeSchemes, barcodeSets
                                     → kits have .barcoding object
```

---

## Backward Compatibility

- Existing `multiplexing` and `barcodeCount` fields on kits are preserved — old consumers still work
- The version bump (4 → 5) triggers the `shouldUpdate` path in the main app's sync logic
- New keys on kit objects (`kitKind`, `doradoKitName`, `barcoding`) are ignored by code that doesn't reference them
- `BarcodeScheme` and `BarcodeSet` have `id` fields, so the existing `mergeItems<T extends { id: string }>()` function works without modification

---

## What's Next (Future Phases)

- **Phase 2**: Admin UI — add barcoding toggle/config per kit in the Accessories > Kits tab
- **Phase 3**: Order flow — barcode-to-sample assignment UI (kit selection drives available barcodes, user assigns barcode per sample)
