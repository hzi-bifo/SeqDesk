# Settings / Install-Profile Consolidation — Review

Scope: the install-profile / settings configuration as it lives across **two repos**:

- **APP** — `/Users/pmu15/Documents/github.com/hzi-bifo/SeqDesk` (the SeqDesk app that *consumes* settings)
- **WEB** — `/Users/pmu15/Documents/github.com/hzi-bifo/SeqDesk.com` (seqdesk.com `/admin/install-profiles/[id]`, where profiles are *authored/hosted*)

Method: multi-agent map → diagnose → adversarial verify. **24 inconsistencies confirmed**, 9 over-framed claims rejected. Each confirmed item has a grounded, currently-failing test sketch (full detail: `.test-dashboard/settings-review-digest.md`).

---

## TL;DR — the root cause

There is **no single source of truth**. "The settings" exists as *many* representations produced by *independent* transforms, plus *two* storage homes for forms, plus *six* hand-maintained copies of the "default":

1. **WEB authoring model** — `src/data/install-profiles/profiles/*.json` (nested: `app`/`site`/`pipelines`/`modules`/`forms`/`requiredSecrets`…). This is what the editor's **Form / Table / Raw JSON** views bind to.
2. **WEB resolved/installer config** — `sanitizeConfigForResolved(config)` (flat-ish, secrets injected, `requiredSecrets` stripped, `forms` rewritten). This is what **Preview JSON** and the real installer download show — a *different shape* from #1.
3. **WEB hosted defaults** — `public/infrastructure-setup.json` (+ `.min.json`, `public/setups/*/`), all **hand-maintained** with **incompatible key sets**.
4. **APP infrastructure import** — `src/app/api/admin/infrastructure/import/route.ts` accepts a *permissive union* of #2/#3, but **drops** `pipelines.*`, `forms`, `ena`, `access`, `auth`, `telemetry`, `notifications`, secrets, bootstrap…
5. **APP form stores** — order form → `OrderFormConfig.schema` table; study form → three ad-hoc keys inside `SiteSettings.extraSettings`. **Neither is the settings JSON.**
6. **APP install-time apply** — `scripts/lib/install-profile-apply-core.mjs` *does* consume `forms`, `pipelines.*`, etc. — so it disagrees with the in-app importer on the *same file*.

The user-visible result is exactly the complaint: Form, Table, Raw JSON, Preview, Export, and the two app-side import paths **overlap but never agree on one document.**

---

## Findings grouped by your 5 complaints

Severity: 🔴 high · 🟠 medium · 🟡 low. IDs match the digest.

### ① "The editor's views (Form / Table / Raw JSON / Preview) don't agree on one JSON"  (WEB)

| # | Sev | What's wrong | Anchor |
|---|----|---|---|
| 1 | 🟠 | `requiredSecrets[]` is in the editor/Raw-JSON config but **stripped** from Preview and export; Preview writes fabricated `[redacted: …]` strings where export writes real values → Raw JSON, Preview, and the real download are **three byte-different documents**. | `install-profiles.ts:1722,1444` |
| 2 | 🟠 | **Preview shows the last *saved* profile, not your live edits.** It's computed server-side from `previewInstallProfileForAdmin(id)` and can't see the editor's in-memory state, so Form/Table/Raw show new values while Preview shows old. | `page.tsx:124`, `AdminInstallProfilePreview.tsx:18` |
| 3 | 🟡 | Even after saving, Preview can **never** be byte-equal to Raw JSON (dropped `requiredSecrets` + fabricated secret placeholders). | `install-profiles.ts:1429,1724` |
| 4 | 🟡 | For `ci-runner`, the editor **mutates `pipelines.enable` on mount** (narrows to `["fastq-checksum"]`) so Raw JSON ≠ stored config ≠ Preview *before any edit*, and a no-edit Save persists the narrowing. | `AdminInstallProfileConfigEditor.tsx:152`, `install-profile-smoke-config.ts:90` |
| 5 | 🟠 | Four surfaces over one hidden `configJson`, but **Table drops all arrays** (`flattenSettings` returns `[]`) and the **Form shows `forms.*`/`requiredSecrets` as read-only counts** ("edit in raw JSON only") → unequal projections. | `AdminInstallProfileConfigEditor.tsx:71,490,818` |
| 6 | 🟠 | Table **"Defaults drifted" badge** is computed from the *raw stored* config while the editor/table render the *default-merged* config → the badge can fire even when every shown value equals the committed default. *(Empirically confirmed failing — see Reproduction.)* | `install-profiles.ts:618,625` |
| 7 | 🟡 | The drift warning shows the *raw stored* `lastUpdated` while the editor field + table show the *force-pinned default* `lastUpdated` → same key, two contradictory values on one screen (ci-runner). | `install-profiles.ts:441,352` |
| 8 | 🟠 | `enabled` has **two competing inputs in one form**: the editor checkbox (via `configJson`) and a separate always-present hidden switch field that **unconditionally overrides** it on save → editor checkbox edit silently discarded. | `install-profile-admin.ts:142`, `AdminInstallProfileEnabledSwitch.tsx:45` |

### ② / ③ "The app also sets JSON; order-form & study-form are separate; merge into one file"  (APP ↔ WEB)

| # | Sev | What's wrong | Anchor |
|---|----|---|---|
| 9 | 🔴 | The in-app importer **drops the entire `pipelines` block** (`enabled`, `enable` allowlist, `databaseDirectory`, `configs`, `databases`) that the WEB profile carries and the **installer applies** → importing the same file in-app yields a strictly weaker config, **with no warning**. | `import/route.ts:243-364` vs `install-profile-apply-core.mjs:1012` |
| 10 | 🟠 | Importer also silently ignores `ena`, `telemetry`, `notifications`, `access`, `auth`, `moduleSettings`, `sequencingFiles`, `sequencingTech`, `modules`, secrets, `bootstrap`. (Mitigated by a separate `/install-profile/reload` path that *does* handle them — so it's a footgun, not total loss.) | `import/route.ts:20-36` |
| 11 | 🟠 | A combined settings file with a populated `forms` key **cannot round-trip**: the importer detects `forms`, warns "use the separate Form Builder tabs," and **refuses** it (forms-only JSON → 400). | `import/route.ts:209,233,351` |
| 13 | 🔴 | **Same `forms` JSON, two contradictory behaviors**: install-time apply **writes** it to the DB; the in-app importer **refuses** it. | `apply-core.mjs:696` vs `import/route.ts:233` |
| 14 | 🟠 | Order form lives in `OrderFormConfig.schema` (its own table); study form lives in 3 ad-hoc `SiteSettings.extraSettings` keys → **two unrelated DB homes**, neither is the settings JSON. | `form-config/route.ts:149`, `study-form-config/route.ts:71` |
| 15 | 🟠 | Two apply paths stamp the order-form defaults version under **different keys** (`installProfileDefaultsVersion` vs `moduleDefaultsVersion`) with merge-vs-overwrite semantics → blind to each other, can clobber. | `apply-core.mjs:763`, `apply-form-configs.mjs:40` |
| 16 | 🟠 | The importer drops `ena`/`access`/`notifications`/`telemetry`/`sequencingFiles`/`auth` that the **in-app per-section settings UI** edits in the *same* `SiteSettings` store → two in-app paths to one store, different key coverage. | `import/route.ts:534-553`, `settings/ena/route.ts:88` |
| 12 | 🟠 | Importer field resolution is a `firstDefined` **union of flat + nested shapes** with no canonical contract — and reads **phantom keys** (`runtime.weblogUrl/weblogSecret`) no producer ever emits. | `import/route.ts:280-342,333,337` |

### ④ "Name it consistently as `settings.json`"  (naming)

| # | Sev | What's wrong | Anchor |
|---|----|---|---|
| 17 | 🟠 | The one concept has **≥8 names**; `settings.json` exists **nowhere** today. | many |
| 18 | 🟡 | The same hosted JSON downloads under two filenames: `{target}-infrastructure-setup.json` vs `{target}-install-profile.json`. | `PrivateSetupAccess.tsx:145` vs `setups/private/[target]/route.ts:92` |
| 19 | 🔴 | **Two different files literally named `infrastructure-setup.json`** (APP `docs/…example.json` flat/no-forms vs WEB `public/…` nested+forms) carry partly-incompatible schemas. | `docs/infrastructure-setup.example.json` vs `public/infrastructure-setup.json` |
| 20 | 🟠 | Docs route `infrastructure-json`, H1 "Infrastructure JSON", but tells you to create `infrastructure-setup.json` — and a parallel page documents yet another name `seqdesk.config.json`. | `docs/installation/infrastructure-json/page.mdx`, `…/config-file/page.mdx` |
| 21 | 🟠 | APP admin UI says "Import Setup JSON" / "Save Infrastructure Setup" / `seqdesk.config.json`; WEB admin says Form/Table/Raw JSON/Preview JSON → **no shared vocabulary, and no control literally named Export/Import.** | `data-compute/page.tsx:249,356,359` |

### ⑤ "Remove Preview JSON; one Export JSON (+ maybe Import) in the footer"  (WEB UI)

- Findings **1, 2, 3, 5** are the substance: Preview is a non-equal, stale, redundant 4th surface — supports removing it.
- **There is no real Export or Import today.** The footer (`AdminProfileFooterBar.tsx`) has only *Save Profile* + *Install command*. The only export-like affordance is Preview's "Copy Redacted JSON" (a redacted, reshaped blob — not the editable source). Import exists only app-side (and is the broken `infrastructure/import` above).

### Cross-cutting — the "default" has drifted into 6 copies

| # | Sev | What's wrong | Anchor |
|---|----|---|---|
| 22 | 🔴 | 6 hand-maintained "default settings" files, **no generator**, **incompatible top-level key sets** (31 / 3 / 15 / 15 / 19 / 14 keys). | `public/infrastructure-setup.json`, `.min.json`, `public/setups/*/`, APP `docs/…example.json`, APP `setups/twincore/` |
| 23 | 🟡 | The two `twincore` setup files (WEB vs APP) have diverged in **values and keys** (different weblog host *and* scheme; `privatePipelines` present in one only). | `public/setups/twincore/…` vs APP `setups/twincore/…` |
| 24 | 🟠 | The `public/setups/*/infrastructure-setup.json` flat files are **orphaned** — the live `/api/setups/private/[target]` route serves resolver output instead, and they've drifted from it. | `setups/private/[target]/route.ts:85` |

---

## What I checked and *dismissed* (so you don't chase ghosts)

The adversarial pass rejected 9 over-framed claims. Notably:

- **"Importer forces `runtimeMode=conda`"** — factually it does hard-pin `conda`, but that's not the divergence you're describing; rejected as mis-framed.
- **"Flat hosted JSON vs nested profile JSON is a contract-mismatch bug"** — they're *intentionally different artifacts* (authoring vs export); the real issue is the importer/naming, not their existence.
- **"`forms.order` has incompatible value types (object vs file-path string)"** — the string-path form only appears in the full hosted *template*; live data flow doesn't break on it. Rejected.
- **"Form save overwrites un-applied Raw JSON edits (last-write-wins)"** — locations accurate but the dirty-state behavior didn't reproduce as a data-loss bug.

(Full list with reasoning in the digest.)

---

## Proposed target (for the fix phase)

One **`settings.json`** schema = the single source of truth, with:

- **`forms` as a first-class key** inside it (order + study + runAssignment), consumed identically by the installer *and* the in-app importer — retire the separate `OrderFormConfig` table / `extraSettings.studyForm*` split (or make them a pure projection of `settings.json`).
- **One generator** that emits all hosted defaults from the canonical profile model (kills findings 22–24).
- **Editor**: Form/Table/Raw JSON are pure projections of one in-memory object; **remove Preview**; footer gets one **Export JSON** + one **Import JSON** that round-trip the *same* document.
- **One filename + vocabulary**: `settings.json` everywhere (downloads, docs route/H1, admin labels).

---

## Open decisions (these shape the tests + the fix)

1. **Canonical name** — adopt `settings.json` (your suggestion), or keep `infrastructure-setup.json`?
2. **Forms** — make `settings.json.forms` the single source of truth (importer consumes it, retire the separate stores), or keep separate stores but at least make the importer accept `forms`?
3. **Test scope now** — write all 24 failing regression tests, just the design-independent subset, or pin specific ones first?

See `.test-dashboard/settings-review-digest.md` for the full per-finding test sketch (file, framework, assertion, why-it-fails, why-it-passes-after-fix).
