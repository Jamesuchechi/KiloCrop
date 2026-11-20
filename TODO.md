# TODO — KiloCrop Roadmap & Engineering Checklist

Project plan for **KiloCrop** — evolving from the verified v0.1 live Resize/Compress/Enhance workbench into a multi-page, offline-first browser image studio. Companion to [`README.md`](README.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md).

**Conventions**
- Task IDs (`T-0xx`) are stable across docs and commits.
- Estimates assume one solo part-time developer: `S` ≤ 2 h · `M` ≈ half day · `L` ≈ 1–2 days.
- Status: `[x]` done · `[~]` in progress / manual verification pending · `[ ]` open · `[-]` dropped.

---

## Completed Foundation (`T-001` – `T-040`)

- [x] **T-001 (S)** Repository named `KiloCrop`, `git remote` set (`git@github.com:Jamesuchechi/KiloCrop.git`).
- [x] **T-002 (S)** Switched license to MIT (`LICENSE`) and CC0-1.0 for specs/guides (`LICENSE-SPECS`).
- [x] **T-003 (M)** Portal ground-truth audit documented in `docs/PORTAL_AUDIT.md`; excluded live-biometric agencies (NIN, FRSC, JAMB UTME, school WAEC/NECO).
- [~] **T-004 (M)** Built standalone 48 MP memory stress harness (`experiments/mobile-stress-test.html` + `docs/DEVICE_MATRIX.md`). *(Manual: run on real 2–4 GB Android + iOS Safari.)*
- [ ] **T-005 (M)** User & café reality check script prepared (`docs/WEEK0_FIELD_CHECK.md`). *(Manual observations pending.)*
- [x] **T-010 (S)** Scaffolded Vite 8 + Preact + strict TypeScript + Vitest + `fast-check` + ESLint (`eslint-plugin-boundaries` + `no-restricted-globals` on `src/engine/`) + Prettier + Playwright + GitHub Actions CI.
- [x] **T-011 – T-014 (L)** Built pure DOM-free engine foundation (`geometry.ts`, `decode.ts`, `encode.ts`, `dpi.ts`, `rule-parser.ts`, `inspect.ts`, `pipeline.ts`) + typed single Web Worker (`src/workers/`) with main-thread fallback.
- [x] **T-020 – T-022 (L)** Authored 9 verified/community JSON portal specs (`specs/bundle.json` at `1,776 B` gzip), built 300 DPI `print-sheet.ts` + `PrintSheetView` (4×6/5×7/A4 single & multi-photo café/family mode).
- [x] **T-030 – T-032 (L)** Added strict build-only CSP injection (`style-src 'self'`), Cloudflare `public/_headers`, offline precaching SW generator (`scripts/build-sw.ts`), 8 static `/guides/*` pages, bundle budget check (`<= 80 KB` gzip core JS), and Playwright E2E CSP/offline tests.
- [x] **T-040 (L)** Built v0.1 live Resize, Compress & Enhance workbench + Royal Blue, White, and Dark Gray theme:
  - Progressive 0.5× step-halving resize (`scaleBitmapToCanvas` / `scaleCanvasToDimensions`), drag-to-adjust `Fill & crop` focal point, Fit inside / Fill / Stretch modes, and no-upscale option.
  - Pure-TS enhancement (`src/engine/enhance.ts`): 0.5%-clipped Rec.709 auto-contrast + alpha-aware post-scale sharpening (`0–100%`).
  - Adaptive JPEG/WebP/PNG encoder (`encodeAdaptiveCanvas`) with quality slider, target max-KB quality search + up to 14 `0.9×` shrink steps, min-KB `COM` padding, white flattening for JPEG, and browser WebP fallback notice.
  - Unified preset catalog (`src/engine/presets.ts`), clean two-column live UI (`src/ui/stage-view.tsx`, `src/ui/control-panel.tsx`), light/dark theme toggle, `51` passing unit/property tests, `4/4` passing Playwright E2E tests (`26,735 B` gzip core JS, `9,456 B` gzip worker JS).

---

## Phase 1: Multi-Page Shell & Core `/` Workbench Upgrades (`T-050` – `T-057`)

*Goal: Turn KiloCrop from a single utility page into a cohesive multi-page studio while making `/` materially sharper and smarter than generic compressors.*

- [x] **T-050 (M)** **Multi-Page Navigation & Lazy Router (`src/app/router.tsx`):**
  - Clean responsive top nav bar (`Resize` `/`, `X-Ray` `/inspect`, `Print Sheet` `/print`, `Guides` `/guides/` — extensible for Phase 2 routes `/batch`, `/compare`, `/documents`, `/presets`, `/web-kit`) styled in Royal Blue / White / Dark Gray with zero layout shift on mobile.
  - Zero-dependency History API routing + lazy dynamic chunks so secondary pages (`/inspect`, `/print`) do not inflate `/` initial chunk.
  - Added Cloudflare Pages `public/_redirects`, dev `scripts/serve-dist.ts` route fallbacks, and offline SW support (`dist/sw.js`).
- [x] **T-051 (M)** **Placement Simulator ("Preview in context", `src/ui/placement-simulator.tsx`):**
  - Contextual **"Preview in context"** toggle on `.stage` for relevant presets using zero-canvas pure CSS overlays:
    - LinkedIn banner bottom-left circular avatar overlap check
    - Instagram / WhatsApp Story top header & bottom reply safe zones
    - YouTube thumbnail bottom-right duration pill overlay
    - Circular avatar crop mask (WhatsApp / profile icons)
    - Link-preview (OG image) & Instagram feed post cards
- [x] **T-052 (S)** **4th Fit Mode — Pad with matching backdrop (`src/engine/backdrop.ts`):**
  - Added `"Pad to fit (keep whole photo)"` to **How it fits** with backdrop style choices: *Blurred photo echo* (fast 2-pass smoothed canvas fill), *Matching edge color*, *Solid white*, and *Solid dark gray*.
- [x] **T-053 (S)** **Zero-ML Smart Subject / Head Auto-Focus (`src/engine/salience.ts`):**
  - Computes initial `focalX`/`focalY` on a 64×64 thumbnail using gradient energy + portrait upper-third weighting (`0 KB` ML) whenever entering *Fill & crop*, preserving manual drag override and `Reset to auto-frame`.
- [x] **T-054 (S)** **One-Click Copy Image to Clipboard:**
  - Added `Copy image` alongside `Download image` (`ClipboardItem` PNG conversion with capability check and `"Copied!"` confirmation).
- [x] **T-055 (S)** **Honest Quality Meter (`src/engine/quality-score.ts`):**
  - Compares encoded output vs. pre-encode canvas on a `<= 128 px` luma grid (`assessEncodedQuality`) using symmetric resampling kernels to show *Crisp quality* / *Good quality* / *Heavy compression* plus a 1-click **Switch to WebP** nudge when tight KB caps degrade JPEG.
- [x] **T-056 (S)** **Saved Custom Presets, Shareable Recipe Links & Paste-a-Rule Bar (`src/ui/saved-presets.ts`):**
  - Save/delete custom named presets in `localStorage` (settings metadata only, zero image data).
  - `"Copy link"` button emitting clean `?n=&w=&h=&fit=&fmt=&max=` recipe URLs (`buildRecipeQuery` / `parseRecipeQuery` incl. `fmt=webp` and `fit=pad`).
  - Re-exposed `parsePortalRule(text)` as a compact `"Paste rule"` inline bar.
- [x] **T-057 (S)** **Promote `/print` & Build `/inspect` Pages:**
  - Promoted `PrintSheetView` to lazy-loaded first-class route `/print`.
  - Built `/inspect` (`src/ui/pages/inspect-page.tsx`) exposing full `inspectImageBytes` X-Ray output (container verification, pixel/oriented dimensions, EXIF flags, GPS warning, ICC color profile, `SOF2` progressive check, findings list) plus 1-click **"Strip metadata & download clean copy"** and **"Open in Resize & Compress →"**.

---

## Phase 2: Dedicated Studio Pages (`T-060` – `T-064`)

*Goal: Give high-intent repeat workflows their own dedicated URLs backed by the shared pure engine.*

- [x] **T-060 (S)** **Zero-Dependency Stored ZIP Builder (`src/engine/zip.ts`):**
  - Pure-TS CRC32 + PKZIP `STORE` (`0`-compression) archive builder with path sanitization & duplicate-name deduplication, verified with Vitest (`zip.test.ts`) + Playwright ZIP extraction checks.
- [x] **T-061 (M)** **`/batch` — Bulk Resize & ZIP (`src/ui/pages/batch-page.tsx`):**
  - Drop 2–50 images (plus 4 offline sample images), choose preset/dimensions/format/max-KB/enhance settings once, and run a **strictly sequential 1-at-a-time** worker pipeline (freeing cached source bitmaps between items).
  - Live progress bar, Cancel button, per-file old KB → new KB (`%` saved) table, individual file downloads, and `"Download all (.zip)"` archive.
- [x] **T-062 (M)** **`/compare` — Format & Quality Lab (`src/ui/pages/compare-page.tsx`):**
  - Side-by-side comparison grid running the same image + quality/enhancement through **JPEG**, **WebP**, and **PNG**, showing exact file size, `Smallest` badge, `%` difference, luma PSNR quality badge, synchronized **2×/4× Canvas Zoom Loupe**, and 1-click transfer to Resize.
- [x] **T-063 (M)** **`/documents` — Document & Certificate Squeezer (`src/engine/document.ts` + `src/ui/pages/documents-page.tsx`):**
  - Coarse-grid 85th-percentile local illumination leveling (lifting phone camera shadows cleanly across white paper), paper white-point stretch, *Color Clean* / *Grayscale* / *Clean B&W* (with ink threshold bias), extra text sharpening, and tight KB caps (`<= 50–200 KB`) wired through the Web Worker (`document-clean`).
- [x] **T-064 (M)** **`/presets` — Searchable Size & Portal Directory (`src/ui/pages/presets-page.tsx`):**
  - Categorized searchable directory (*Social Media*, *Web & Email*, *Passports & Portals*, *Print Sizes*, *Saved Custom Presets*) + inline Paste-a-Rule bar. Clicking any preset card opens `/` pre-configured (or `/print` for sheet sizes), and portal cards link straight to their `/guides/<slug>/` documentation page.

---

## Phase 3: Web Dev Kit, OS Integration & Ship (`T-070` – `T-074`)

- [x] **T-070 (M)** **`/web-kit` — Responsive Web Export Kit (`src/engine/web-kit.ts` + `src/ui/pages/web-kit-page.tsx`):**
  - Drop one hero photo → generate non-upscaling `480w`, `960w`, `1600w` (configurable) assets in WebP + JPEG, compute a ~20 px blurred WebP LQIP data URI, package via `zip.ts`, and display copy-ready `<picture><source type="image/webp" srcset=…>` HTML markup. Verified in Vitest (`web-kit.test.ts`) + Playwright ZIP verification.
- [x] **T-071 (S)** **PWA OS Integration (`public/manifest.webmanifest` + `scripts/build-sw.ts` + `src/app/pwa-launch.ts`):**
  - Configured `file_handlers` (`.jpg`, `.jpeg`, `.png`, `.webp`) and offline Service Worker `share_target` (`POST /?share-target=1`) wired into `main.tsx` and `App.tsx` (single files open into `/`, multi-file launches open into `/batch`).
- [~] **T-072 (M)** **Real-Device Mobile Stress Audit:**
  - Desktop Chromium headless stress benchmarks passed and logged in [`docs/DEVICE_MATRIX.md`](docs/DEVICE_MATRIX.md): 48 MP (`8000×6000`) `/` resize+enhance (`896 ms` initial, `672 ms` cached slider), 20-image `/batch` ZIP (`2,877 ms`), 12 MP `/documents` (`874 ms`). *(Manual: verify on real **2–4 GB Android Chrome** and **iOS Safari** hardware and fill in those rows in `docs/DEVICE_MATRIX.md`.)*
- [x] **T-073 (M)** **Multi-Page E2E, CSP & Bundle Budget Hardening:**
  - Expanded [`e2e/kilocrop.spec.ts`](e2e/kilocrop.spec.ts) (`11/11` passing) covering every route (`/`, `/batch`, `/compare`, `/documents`, `/inspect`, `/print`, `/presets`, `/web-kit`), valid PKZIP generation, `window.launchQueue` OS file launch, and offline airplane-mode SW navigation with 0 outbound requests and 0 CSP violations. Added `grep -rn "style="` and `format:check` to `.github/workflows/ci.yml`; total non-worker JS across all 10 chunks is `61,448 B` gzip (`<= 80 KB` budget), worker `13,869 B` gzip (`<= 20 KB` budget).
- [~] **T-074 (S)** **Deploy & Launch:**
  - Updated [`docs/LAUNCH_KIT.md`](docs/LAUNCH_KIT.md), [`README.md`](README.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), and [`docs/DEVICE_MATRIX.md`](docs/DEVICE_MATRIX.md). *(Manual remaining: deploy to Cloudflare Pages with `NODE_VERSION=22` / `pnpm build`, verify live `_headers`, add README screenshots if desired, and tag `v1.0.0`.)*

---

## Conditional Post-v1 Backlog

- Extract `src/engine/` into a zero-dependency `<kilocrop-input>` Web Component / npm package if developers request an embeddable form widget.
- Evaluate optional lazy-loaded `@jsquash/jpeg` (MozJPEG WASM, Apache-2.0) **only** if real-device testing shows native `canvas.toBlob` fails legibility on extreme KB caps.
- `pdf-lib` single-document or multi-sheet PDF export (only if print shops or portals reject baseline JPEG/300 DPI PNG).

---

## Explicitly Out of Scope

- Cloud accounts, server uploads, cookies, or JS analytics beacons.
- Bundled `libheif` WASM (~1.5 MB) — keep detection + 1-line iPhone tip in `inspect.ts`.
- AI background replacement or generative retouching (license, RAM, data, and passport policy risks).
- Live biometric-capture agencies (`NIN/NIMC`, `FRSC`, `JAMB UTME`, school `WAEC/NECO`).
