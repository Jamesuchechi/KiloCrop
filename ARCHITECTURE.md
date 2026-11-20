# KiloCrop Architecture

`Status: Full multi-page browser image studio built (Phases 1–3); ready for device audit & release` · `Repo: https://github.com/Jamesuchechi/KiloCrop` · `Code license: MIT` · `Spec data: CC0-1.0`

KiloCrop is a **static, backend-less, offline-capable** browser image studio built to resize, enhance, and compress images cleanly so they look sharper and fit anywhere they are placed.

---

## 1. Goals, non-goals, and core principles

### Goals
- **Make resized images look better:** Progressive step-halving downscale, Rec.709 auto-contrast, and alpha-aware post-shrink sharpening avoid blurry or washed-out outputs.
- **Fit any destination cleanly:** Support pixel targets, Fit Inside / Fill & Crop (drag focal point) / Fill & Stretch (plus planned Pad Backdrop), no-upscale toggles, JPEG/WebP/PNG format conversion, quality control, exact KB ceilings/windows, 300 DPI print sheets, document scan cleanup, and responsive dev exports.
- **Stay fast and safe on real phones:** Handle up to 48 MP photos safely on **2–4 GB Android phones and iOS Safari** without tab OOM kills.
- **Scale cleanly from single workbench to multi-page studio:** Route dedicated workflows (`/batch`, `/compare`, `/documents`, `/inspect`, `/print`, `/presets`, `/web-kit`) as lazy-loaded UI views over one shared pure-TypeScript engine (`src/engine/`).

### Non-goals
- No backend servers, accounts, telemetry beacons, third-party fonts, or cloud storage.
- No AI background replacement (banned by US/UK/Canada passports, restrictive model licenses, excessive download/RAM cost on mobile).
- No bundling ~1.5 MB WASM decoders (`libheif`); detect undecodable `ftypheic` headers and show a crisp iPhone tip.
- No live-capture-only biometric documents (`NIN/NIMC`, `FRSC`, `JAMB UTME`, school `WAEC/NECO`).

### Principles
1. **Nothing leaves the device.** Enforced via strict HTTP/meta CSP (`connect-src 'self'`, `script-src 'self'`, `style-src 'self'`), zero inline `style=` attributes, zero external assets, and Playwright outbound-network guards.
2. **Mobile memory safety first.** Downscale before pixel manipulation, cap every canvas allocation `<= 16,000,000` pixels (under iOS Safari's 16.7 MP cap), call `bitmap.close()` and shrink scratch canvases (`width = height = 1`) immediately in `try/finally`, and process batch jobs strictly one file at a time.
3. **Pure engine, thin UI.** `src/engine/` is strictly DOM-free and UI-free (`eslint-plugin-boundaries` + `no-restricted-globals`), running identically inside the Web Worker, main-thread DOM fallback, Vitest, or a future `<kilocrop-input>` package.
4. **Data-driven presets + Shareable URLs.** General presets, curated portal JSON files (`specs/`), `parsePortalRule(text)` snippets, URL query links (`?spec=` / `?n=&w=&h=`), and saved custom presets all compile to uniform typed options.

---

## 2. System overview & multi-page routing

### Runtime architecture

```text
┌────────────────────── Browser (Multi-Page Static PWA / Cloudflare Pages) ──────────────────────┐
│                                                                                                 │
│  Preact UI Shell + History Router (lazy route chunks keep `/` core <= 80 KB gzip)               │
│  ┌─────────────────────────────────────────────────┐    ┌─────────────────────────────────────┐ │
│  │ Routes:                                         │    │ Single Plain Web Worker + 1-slot    │ │
│  │ • `/`         Live Resize, Compress & Enhance   │───▶│ working-bitmap cache (`engine.worker`)│ │
│  │ • `/batch`    Sequential Multi-File ZIP [Plan]  │    │                                     │ │
│  │ • `/compare`  Format & Quality Lab     [Plan]   │◀───│ Pure `src/engine/` (0 DOM imports): │ │
│  │ • `/documents` Scan & Cert Squeezer    [Plan]   │    │ inspect → decode → fit/pad →        │ │
│  │ • `/inspect`  Binary X-Ray & Scrub     [Plan]   │    │ enhance → encode (KB/quality/DPI) → │ │
│  │ • `/print`    300 DPI Sheet Packer     [Promoted]│   │ quality-score / zip / print-sheet   │ │
│  │ • `/presets`  Size & Portal Directory  [Plan]   │    └─────────────────────────────────────┘ │
│  │ • `/web-kit`  Responsive <picture> Kit [Plan]   │                                            │
│  └─────────────────────────────────────────────────┘                                            │
│                                                                                                 │
│  Static data & state: `specs/bundle.json` (1.78 KB gz) · `localStorage` custom presets (meta)   │
│  Offline PWA: `dist/sw.js` (Precache shell, routes, guides) + OS `file_handlers`/`share_target`│
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Route map

| Route | Status | Primary Inputs & Outputs | Lazy Chunk |
|---|---|---|---|
| `/` | **Live** | Single image → interactive resize, crop pan, enhance, backdrop pad, placement simulator, quality meter, copy clipboard, saved custom presets & share links | Core |
| `/guides/*` | **Live** | 8 static SEO/instructional portal guides deep-linking into `/?spec=<id>` | Static HTML |
| `/print` | **Live** | 1 image (tiled) or up to 8 images (café/family) → 300 DPI `4×6`, `5×7`, `A4` PNG sheet | Lazy route chunk |
| `/batch` | **Live** | 2–50 images + shared preset/KB rule → strictly sequential worker loop → `.zip` (`STORE`) | Lazy route chunk |
| `/compare` | **Live** | 1 image → JPEG vs WebP vs PNG cards + synchronized 2×/4× zoom loupe | Lazy route chunk |
| `/documents` | **Live** | Camera scan / certificate / signature → paper shadow leveling + B&W/grayscale + sharp KB cap | Lazy route chunk |
| `/inspect` | **Live** | Any image → full `DataView` header X-Ray (EXIF, GPS, SOF2, ICC, WhatsApp check) + 1-click scrub | Lazy route chunk |
| `/presets` | **Live** | Browse/search all social, web, portal, print & saved `localStorage` presets + Paste-a-Rule parser | Lazy route chunk |
| `/web-kit` | **Live** | Hero image → `480w`/`960w`/`1600w` WebP + JPEG ZIP + 20 px LQIP data URI + `<picture>` snippet | Lazy route chunk |

On Cloudflare Pages, deep-linked SPA routes resolve cleanly back to `index.html` (while physical `/guides/*` directories serve static HTML directly) and `scripts/build-sw.ts` handles offline SPA navigation fallback cleanly.

---

## 3. Module map (built vs. planned)

```text
src/
│  ├─ app/
│  │  ├─ App.tsx                   [Built] Shell, query/spec bootstrap, debounced render queue, AbortController, multi-page wiring
│  │  ├─ main.tsx                  [Built] Root mount + production Service Worker registration + OS launchQueue init
│  │  ├─ pwa-launch.ts             [Built] File Handling API launchQueue & Service Worker share_target consumer (0 persistence)
│  │  ├─ styles.css                [Built] Royal Blue / White / Dark Gray design tokens (light & dark), zero inline styles
│  │  └─ router.tsx                [Built] Tiny History API router + dynamic import() code splitting
│  ├─ ui/
│  │  ├─ icons.tsx                 [Built] Crisp zero-style inline SVG studio icons
│  │  ├─ stage-view.tsx            [Built] Drop/paste target, live KB & % readout, quality badge, hold-compare, drag focal crop
│  │  ├─ control-panel.tsx         [Built] Preset catalog, saved/copy/paste bar, dimensions, fit/pad mode, format/KB/quality, contrast/sharpen
│  │  ├─ print-sheet-view.tsx      [Built] 300 DPI 4×6 / 5×7 / A4 packer UI (single & multi-photo café/family)
│  │  ├─ pipeline-stats-drawer.tsx [Built] Quiet footer + expandable decode/enhance/encode/0 B outbound telemetry
│  │  ├─ placement-simulator.tsx   [Built] Pure-CSS LinkedIn/IG Story/YouTube/OG/Avatar safe-zone overlays
│  │  ├─ saved-presets.ts          [Built] `localStorage` CRUD for user custom presets (numeric rules/names only)
│  │  └─ pages/                    [Built] BatchPage, ComparePage, DocumentsPage, InspectPage, PresetsPage, WebKitPage
│  ├─ engine/                      # PURE TS: NO DOM / PREACT / WORKER IMPORTS (ESLint enforced)
│  │  ├─ types.ts                  [Built] OutputFormat ('jpeg'|'webp'|'png'), FitMode, SizePreset, ResizeCompress*, DocumentClean*
│  │  ├─ geometry.ts               [Built] mm/px/DPI, computeFitPlan (inside/fill/pad/stretch/16 MP clamp), preview scales
│  │  ├─ decode.ts                 [Built] 50 MB guard, decodeWorkingBitmap, progressive 0.5× step halving, releaseCanvas
│  │  ├─ enhance.ts                [Built] Rec.709 0.5% auto-contrast (skips alpha=0), alpha-aware 5-tap sharpen
│  │  ├─ encode.ts                 [Built] JPEG/WebP/PNG adaptive encode, quality search, 0.9× KB shrink loop, MIME fallback check
│  │  ├─ dpi.ts                    [Built] Pure-TS JPEG JFIF APP0 & PNG pHYs 300 DPI binary writer + JPEG COM padding
│  │  ├─ inspect.ts                [Built] Zero-dep DataView header X-Ray (SOF2, EXIF/GPS, ICC, CMYK, ftypheic, WhatsApp check)
│  │  ├─ presets.ts                [Built] GENERAL_PRESETS + buildPresetCatalog(specs), categories, guide slugs, formatters
│  │  ├─ print-sheet.ts            [Built] Optimal 0°/90° grid packing, cut marks, single/multi 300 DPI PNG renderer
│  │  ├─ rule-parser.ts            [Built] parsePortalRule(text) + sanitized parseQuerySpec / buildRecipeQuery / parseRecipeQuery
│  │  ├─ specs.ts                  [Built] Portal spec filter/lookup helpers
│  │  ├─ pipeline.ts               [Built] runInspect, runExport, runResizeCompress
│  │  ├─ backdrop.ts               [Built] 4th fit mode 'pad' (2-pass blur echo, edge color, solid white/dark gray)
│  │  ├─ salience.ts               [Built] 64×64 edge-energy + upper-third bias initial focalX/focalY estimator
│  │  ├─ quality-score.ts          [Built] Fast 128×128 symmetric luma PSNR check + plain-English label & WebP nudge
│  │  ├─ zip.ts                    [Built] Pure-TS CRC32 + STORE (uncompressed) ZIP archive builder
│  │  ├─ document.ts               [Built] Local paper illumination leveling, crisp grayscale/B&W, text sharpen & KB cap
│  │  └─ web-kit.ts                [Built] Multi-width WebP/JPEG generation, 20 px LQIP data URI, escaped `<picture>` generator
└─ workers/
   ├─ protocol.ts               [Built] Typed request/response messages (expandable per new engine operation)
   ├─ engine.worker.ts          [Built] Plain postMessage worker + single decoded working-bitmap cache + AbortController
   └─ client.ts                 [Built] Worker wrapper + symmetric main-thread DOM fallback
```

**ESLint boundary enforcement (`eslint.config.js`):**
- `src/engine/` may import ONLY from `src/engine/` and cannot reference `window`, `document`, `localStorage`, `sessionStorage`, `HTMLElement`, `HTMLCanvasElement`, or `preact`.
- `src/ui/` may import `src/engine/`, `src/ui/`, and `preact` (never `src/workers/` — workers stay orchestrated cleanly in `src/app/`).

---

## 4. Live image pipeline & mobile memory engineering

### 4.1 Live pipeline (`runResizeCompress`)

```text
File / Clipboard Paste / Drop
  ├─▶ runInspect (<= 256 KB header slice)
  │     Detects dimensions, EXIF orientation, GPS, SOF2 progressive JPEG,
  │     Display-P3/CMYK profiles, WhatsApp caps, and ftypheic blocking tip.
  ├─▶ decodeWorkingBitmap (cached once per sourceKey in engine.worker.ts)
  │     Capped at 3200–4000 px long edge (and <= 16 MP area) with from-image orientation.
  ├─▶ computeFitPlan (`inside` | `fill` | `stretch` [+ planned `pad`])
  │     Applies focalX/focalY crop panning (initial salience planned) + 16 MP ceiling.
  ├─▶ scaleBitmapToCanvas (`decode.ts`)
  │     Multi-step 0.5× halving passes with imageSmoothingQuality='high'; every
  │     intermediate canvas released immediately via releaseCanvas().
  ├─▶ enhanceCanvas (`enhance.ts`)
  │     1) applyAutoContrast: Rec.709 256-bin histogram, 0.5% clip, skips flat or
  │        alpha=0 pixels.
  │     2) applySharpen: 5-tap Laplacian sharpen scaled 0–100%, protecting transparent
  │        edges from dark halos.
  └─▶ encodeAdaptiveCanvas (`encode.ts`)
        • JPEG flattens alpha onto #ffffff; WebP/PNG preserve alpha.
        • Quality slider (0.40–1.00) when unbounded; or 7-step binary search in [0.30, 0.95]
          plus up to 14 × 0.9× shrink steps when maxKb is set (or COM pad for JPEG minKb).
        • Reads returned Blob MIME to flag browser WebP fallback cleanly.
```

### 4.2 Mobile memory discipline (`2–4 GB Android` & `iOS Safari`)
- iOS Safari caps individual `<canvas>` instances at **16.7 MP** and kills tabs exceeding **~256–384 MB** across all active canvas backing stores.
- KiloCrop enforces:
  1. Single-image working bitmap cache (changing quality/sharpen sliders skips 48 MP re-decode while closing prior bitmaps when switching files or resetting).
  2. Output area hard-clamped `<= 16,000,000` pixels (`MAX_SAFE_CANVAS_AREA`).
  3. Immediate `releaseCanvas()` (`width = 1; height = 1`) on every halving step, JPEG flatten step, and `0.9×` shrink step inside `try/finally`.
  4. Planned `/batch` runs a **strictly sequential queue** (`1` file decoded/encoded/released at a time), appending only small encoded `Uint8Array` chunks into the final `STORE` ZIP blob.

---

## 5. Planned module specifications (multi-page studio)

1. **Placement Simulator (`src/ui/placement-simulator.tsx`):** Zero-canvas pure CSS overlay masks over `.view img` triggered by contextual presets (`LinkedIn banner` bottom-left circle mask, `Instagram story` top/bottom HUD rails, `YouTube thumbnail` bottom-right `12:34` pill, `Avatar` circular frame, `OG / Link preview` card chrome).
2. **Backdrop Padding (`src/engine/backdrop.ts`):** When `fit === 'pad'`, fills destination canvas using either a tiny-canvas 2-pass blurred echo of the image (rendered onto e.g. 96 px canvas → drawn back smoothed onto full `dw × dh`), median edge-pixel color, or solid `#FFFFFF` / `#111827`, then draws the proportionally centered foreground image inside.
3. **Smart Focal Heuristic (`src/engine/salience.ts`):** Downsamples working bitmap to `64×64` via scratch canvas, scores vertical/horizontal gradient magnitudes weighted by an upper-third vertical bell (`0.25–0.45` height for portraits), and computes default normalized `(focalX, focalY) ∈ [-1, 1]` before user drag refinement.
4. **Quality Meter (`src/engine/quality-score.ts`):** Decodes output `Blob` and pre-encode canvas onto matching `128×128` buffers, calculates luma MSE → PSNR/lightweight SSIM proxy, and emits `{ band: 'crisp' | 'good' | 'artifacted', suggestWebp: boolean }`.
5. **Document & Scan Squeezer (`src/engine/document.ts`):** Divides canvas by a heavily blurred local-illumination background estimate (removing phone shadow gradients from paper), optionally converts to crisp high-contrast grayscale or adaptive clean monochrome, sharpens strokes, and targets `<= 100–200 KB`.
6. **Zero-Dep Stored ZIP (`src/engine/zip.ts`):** Writes standard PKZIP local file headers, data descriptors/sizes, central directory records, and IEEE 802.3 CRC32 table using compression method `0` (`STORE` — no redundant zlib inflation since JPEG/WebP/PNG are already compressed).
7. **Responsive Web Kit (`src/engine/web-kit.ts`):** Reuses `scaleCanvasToDimensions` + `encodeAdaptiveCanvas` at `[480, 960, 1600]` (clamped by source width when `dontEnlarge`), generates a tiny `~20 px` base64 WebP/JPEG LQIP, packages assets via `zip.ts`, and formats an idiomatic `<picture><source type="image/webp" srcset="…">…</picture>` block.
8. **Saved Custom Presets (`src/ui/saved-presets.ts`):** Persists only compact JSON preset records (`{ id, label, width, height, fit, format, maxKb, autoContrast, sharpenPct }`) in `localStorage` — never image blobs or filenames.

---

## 6. Design system, privacy & CSP

- **Palette:** Royal Blue (`#2563EB` primary CTA/controls, `#1D4ED8` light links/highlights, `#60A5FA` dark-mode links), Crisp White (`#FFFFFF`), Dark Gray (`#111827` / `#F3F4F6` light; `#111318` / `#1A1D24` dark via `:root[data-theme]`).
- **CSP & Zero Inline Styles:** Production `vite.config.ts` and Cloudflare `public/_headers` serve `style-src 'self'`, `script-src 'self'`, `connect-src 'self'`, `font-src 'self'`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. Zero Google Fonts, zero `<style>` tags in JSX, and zero `style=` HTML attributes (enforced in CI checks).
- **PWA OS Integration:** `file_handlers` (`image/jpeg`, `image/png`, `image/webp`) and offline Service Worker `share_target` configured in `public/manifest.webmanifest` and `scripts/build-sw.ts`, wired via `src/app/pwa-launch.ts` on mount with immediate CacheStorage purge after handoff.

---

## 7. Decision log (ADRs)

| # | Decision | Status | Rationale |
|---|---|---|---|
| 001 | No backend, ever | Accepted | Zero upload liability, free static hosting, provable offline trust |
| 002 | Preact + TypeScript (strict) + Vite | Accepted | Core shell `26.7 KB` gzip for fast loads on budget Androids |
| 003 | Unified preset + `parsePortalRule` + query URL (`?n=&w=&h=`) model | Accepted | One pipeline serves social/web presets, pasted portal error text, and shared WhatsApp/team links |
| 004 | Zero client-side analytics; script-free Cloudflare edge counts | Accepted | Preserves `connect-src 'self'` with zero third-party JS |
| 005 | Cloudflare Pages primary (`_headers`), GitHub Pages fallback | Accepted | Real HTTP CSP and cache headers |
| 006 | Safe `<= 16 MP` canvas pool + explicit bitmap/canvas disposal | Accepted | Eliminates iOS Safari and 2 GB Android OOM crashes |
| 007 | Native `convertToBlob`/`toBlob` JPEG/WebP/PNG + DPI writer (defer WASM codecs) | Accepted | `0 KB` codec overhead; fits inside `< 80 KB` budget |
| 008 | No AI background replacement | Accepted | Policy-safe for passports, zero ML model download/OOM risk |
| 009 | In-memory images + silent EXIF/GPS scrub on export | Accepted | Privacy by default without blocking the primary flow |
| 010 | MIT code + CC0-1.0 spec/guide data | Accepted | Maximum reuse across docs, presets, and future packages |
| 011 | Pure DOM-free `src/engine/` boundary enforcement | Accepted | Enables Web Worker isolation, fast Vitest runs, and future `<kilocrop-input>` extraction |
| 012 | Pivot to instant Resize, Enhance & Compress workbench on `/` | Accepted | Eliminates 3-step wizard friction for everyday image sizing while retaining portal/print depth |
| 013 | Royal Blue, White & Dark Gray system-font design with zero inline `style=` | Accepted | Offline-safe, crisp contrast in light & dark mode, 100% compatible with `style-src 'self'` |
| 014 | Lazy-loaded multi-page studio routes over shared worker (`router.tsx`) | Accepted (Built) | Unlocks `/batch`, `/compare`, `/documents`, `/inspect`, `/print`, `/presets`, `/web-kit` while keeping initial payload compact |
| 015 | Pure-TS `STORE` ZIP archive (`zip.ts`) instead of `jszip` | Accepted (Built) | Images are already compressed; `STORE` adds ~1 KB vs tens of KB of deflate runtime |
| 016 | Zero-ML backdrop padding (`backdrop.ts`) & 64×64 salience focus (`salience.ts`) | Accepted (Built) | Solves aspect mismatch and portrait cropping in `< 5 ms` with 0 KB ML dependencies |
| 017 | Fast 128×128 luma quality check (`quality-score.ts`) & paper leveling (`document.ts`) | Accepted (Built) | Honest quality feedback and sharp scanned document output inside strict KB caps |
| 018 | Metadata-only `localStorage` saved presets (zero pixels persisted) | Accepted (Built) | Gives power users reusable custom targets while keeping the zero-persistence image promise intact |
