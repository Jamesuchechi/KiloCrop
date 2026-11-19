# KiloCrop Architecture

`Status: v0.1 MVP target` · `Repo: https://github.com/Jamesuchechi/KiloCrop` · `Code license: MIT` · `Spec data: CC0-1.0`

KiloCrop is a **static, backend-less, offline-capable** web app that crops, sizes, and compresses photos to exact portal pixel/mm and KB limits entirely in the user's browser.

---

## 1. Goals, non-goals, and principles

### Goals
- Fit real smartphone photos (up to 48 MP) to exact portal pixel/mm dimensions and **min–max KB** ranges on **2–4 GB Android phones and iOS Safari** without tab crashes.
- Handle the long tail on Day 1 via a deterministic **"Paste portal rule / error message"** parser alongside 6–8 verified uploadable portal presets.
- Pack single-person and multi-customer **4×6 in (300 DPI) print sheets** with zero ML overhead.
- Keep `src/engine/` pure and DOM-free so it can later be extracted into a drop-in `<kilocrop-input>` Web Component / npm package.

### Non-goals (v0.1)
- No backend, user accounts, cookies, or client-side analytics beacons.
- No AI background replacement (explicitly rejected by US/UK/Canada passports, heavy on mobile data/RAM, and prone to AGPL/non-commercial model licenses).
- No live-capture-only IDs (NIN/NIMC, FRSC Driver's Licence, JAMB UTME, and school WAEC/NECO are excluded because users cannot upload photos to them).
- No cosmetic filters, face modification, or acceptance guarantees.

### Principles
1. **Nothing leaves the device.** Enforced via strict CSP and CI network guards.
2. **Mobile memory safety first.** Downscale before editing, release every `ImageBitmap` and `<canvas>` backing store immediately, hold one image at a time.
3. **Pure engine, thin UI.** `src/engine/` has zero DOM or UI imports and runs identically in a Web Worker, main thread fallback, or Vitest.
4. **Specs are data + user overrides are first-class.** Every preset and parsed rule compiles to the same `Spec` structure.

---

## 2. System overview

```text
┌─────────────────────────── Browser (Static SPA / PWA) ───────────────────────────┐
│                                                                                  │
│  UI thread (Preact + TS)                Single Web Worker (plain postMessage)    │
│  ┌──────────────────────────┐  transfer ┌─────────────────────────────────────┐  │
│  │ • Portal picker / search │ ────────▶ │ src/engine/ (pure TS, no DOM)       │  │
│  │ • Paste-a-Rule / ?n= link│           │  inspect (X-Ray) → decode (capped)  │  │
│  │ • Pointer/kb crop editor │ ◀──────── │  → extract → resize → encode (min-  │  │
│  │ • Result + Pipeline stats│  Blob/Msg │  max KB) → inject DPI → 4×6 packer  │  │
│  └────────────┬─────────────┘           └─────────────────────────────────────┘  │
│               │                                                                  │
│  ┌────────────▼─────────────┐   ┌─────────────────────────────────────────────┐  │
│  │ specs/bundle.json (<3 KB)│   │ Minimal Service Worker (shell + bundle.json)│  │
│  │ localStorage (prefs only)│   └─────────────────────────────────────────────┘  │
│  └──────────────────────────┘                                                    │
└──────────────────────────────────────────────────────────────────────────────────┘
                 │ static files + _headers only
                 ▼
   Cloudflare Pages (primary, CSP headers + cookieless edge HTTP metrics)
   GitHub Pages (fallback, meta-CSP)
```

---

## 3. Module map

```text
src/
├─ app/
│  ├─ main.tsx               # Bootstrap, ?spec=<id> & ?n=&w=&h= query routing, error boundary
│  └─ state.ts               # Minimal signal state (active spec/rule, crop rect, result, stats)
├─ ui/
│  ├─ portal-picker.tsx      # Verified preset chips, search, Paste-a-Rule / Custom panel
│  ├─ crop-editor/           # Touch/mouse/keyboard pan-zoom canvas + head-zone guide
│  └─ result-view.tsx        # "Fixed N hidden issues", Save, Share link, 4×6 sheet, footer Pipeline stats drawer
├─ engine/                   # PURE TS: NO DOM/UI IMPORTS (ESLint boundaries enforced)
│  ├─ types.ts               # Spec, CropRect, InspectReport, PipelineStats, EncodeResult, SheetSlot
│  ├─ geometry.ts            # mm <-> px <-> dpi, aspect fitting, single final rounding
│  ├─ rule-parser.ts         # Deterministic parsePortalRule(text) + plain-query (parseQuerySpec/toQuerySpec) -> Spec
│  ├─ inspect.ts             # Zero-dep DataView binary X-Ray (SOF2, EXIF, container/ICC, WhatsApp check)
│  ├─ decode.ts              # Safe downscale-first createImageBitmap + cleanup helpers
│  ├─ encode.ts              # Native canvas JPEG binary search (min/max KB + COM padding)
│  ├─ dpi.ts                 # Pure-TS JPEG JFIF APP0 & PNG pHYs 300 DPI injector
│  ├─ print-sheet.ts         # Optimal 0°/90° 4×6 / A4 packer (single & multi-photo café mode)
│  └─ pipeline.ts            # Abortable orchestrator emitting Blob + InspectReport + PipelineStats
├─ workers/
│  └─ engine.worker.ts       # Single plain Web Worker + typed postMessage + main-thread fallback
└─ sw/
   └─ sw.ts                  # Precache app shell and specs/bundle.json; versioned cleanup
specs/                       # One JSON file per verified uploadable portal + schema.json
scripts/                     # validate-specs.ts (emits bundle.json), build-guides.ts
e2e/                         # Playwright flows, zero-outbound-request guard, offline suite
```

**Boundary rule:** `eslint-plugin-boundaries` forbids `src/engine/` from importing `src/ui/`, `src/app/`, or `window`/`document` globals, keeping future extraction as a `<kilocrop-input>` package straightforward.

---

## 4. Specs & Paste-a-Rule model

Both curated JSON presets and user-pasted portal rules produce the exact same `Spec` interface so downstream cropping, sizing, and encoding behave identically.

### 4.1 Abridged spec schema

```jsonc
{
  "id": "string-kebab-case",
  "schemaVersion": 1,
  "title": "Human-readable portal name",
  "region": "NG | US | UK | INTL",
  "status": "draft | checked | stale",
  "output": {
    "units": "px | mm",
    "width": 600,
    "height": 800,
    "dpi": null,                     // required when units = "mm" (e.g. 300)
    "format": "jpeg",                // v0.1 focuses on portal JPEG; PNG supported for sheets
    "fileSizeKb": { "min": 15, "max": 100 }
  },
  "framing": {
    "headHeightPct": [65, 80],       // displayed as a visual guide overlay in crop-editor
    "eyeLineFromTopPct": [40, 50]
  },
  "provenance": {
    "kind": "public-page | authenticated-portal",
    "sourceUrl": "https://… | null", // required when kind = "public-page"
    "archiveUrl": "https://web.archive.org/… | null",
    "verifiedOn": "YYYY-MM-DD",
    "notes": "Portal quirks (e.g. rejects progressive JPEG or white background required)"
  }
}
```

### 4.2 Build-time registry & statuses
- `scripts/validate-specs.ts` validates schema, sanity bounds (`min <= max`, HTTPS URLs), excludes `draft` specs, and bundles published presets into one tiny `specs/bundle.json` (**< 3 KB gzipped**). No runtime JSON Schema engine (no Ajv standalone bundle) and no per-spec network waterfall.
- Statuses: `draft` (hidden), `checked` (verified by a maintainer against a public source or a live authenticated portal upload screen with `verifiedOn` date), `stale` (>12 months old or flagged changed).

### 4.3 `parsePortalRule(text)`
Because hundreds of university, scholarship, and employer portals will never have a curated JSON file, `src/engine/rule-parser.ts` parses pasted requirement or error strings (e.g. `"Passport must be JPG, max 25KB, 300x300px"` or `"Photo size between 20 KB and 50 KB, 3.5x4.5cm"`) via deterministic unit/range regexes into editable UI chips before running the pipeline.

### 4.4 Shareable plain-query portal links
To enable WhatsApp/Telegram viral sharing without opaque base64 recipe hashes or a backend, `rule-parser.ts` also exposes `parseQuerySpec` / `toQuerySpec` for clean URLs such as `/?n=UNILAG+Post-UTME&w=300&h=300&max=25&u=px` (with optional `min`). All numeric values are strictly clamped (`w`/`h` bounds, `min <= max`), the `n` label is stripped to short plain text rendered strictly as text, and any rule loaded via query params displays a mandatory `"Shared custom rule — confirm on portal"` badge.

---

## 5. Image pipeline & mobile memory engineering

### 5.1 Stages

```text
File/Blob
  ├─▶ inspect           zero-dep DataView scan on raw header slice -> InspectReport (incl. ftypheic tip)
  ├─▶ decodePreview     createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth/Height <= 1600 })
  ├─▶ [UI Crop Editor]  user pans/zooms under fixed spec aspect + head-zone visual overlay
  ├─▶ extractCrop       crop original to exact output W×H (verify Safari/Chrome behavior in Week 0)
  ├─▶ encodeToWindow    binary search JPEG quality to land in [minKb, maxKb] (canvas re-encode strips EXIF)
  └─▶ injectDpi         patch JFIF APP0 (JPEG) or pHYs (PNG) header for physical print size
```

`pipeline.ts` also emits lightweight `PipelineStats` (decode time in ms, binary-search iterations and final quality `q`, input vs. output bytes, and fixed X-Ray issues). These power an unobtrusive footer **Pipeline stats** drawer (`Offline · 0 B sent · Pipeline stats`) that keeps the main screen clean for everyday users while giving engineers verifiable runtime telemetry.

### 5.2 Mobile memory limits (iOS Safari & 2–4 GB Android)
- **iOS Safari constraints:** WebKit caps a single `<canvas>` at **16.7 MP** (4096×4096) and shares a **~256–384 MB** total canvas backing-store pool across the tab before silently killing/reloading the page.
- **Rules enforced across `decode.ts`, `encode.ts`, and `crop-editor/`:**
  1. **Downscale-first decode:** Interactive crop preview never decodes above **1600 px** on the long edge (~2.5 MP).
  2. **Week-0 verified full-res extract:** Test `createImageBitmap(file, sx, sy, sw, sh, { resizeWidth, resizeHeight, imageOrientation: 'from-image' })` on real iOS Safari and 2–4 GB Android in `TODO.md` `T-004`. If Safari decodes the full 48 MP buffer internally or ignores crop rects with orientation, fall back to a capped intermediate decode (`<= 3200 px` long edge, well under 16.7 MP while preserving crisp portrait resolution for any <= 1200 px portal/print target).
  3. **Explicit immediate disposal:** Call `bitmap.close()` as soon as pixels are drawn or encoded, and release temporary canvases (`canvas.width = 1; canvas.height = 1; ctx = null`) after every encode step.
  4. **Single-image invariant:** Selecting a new photo revokes prior object URLs and closes prior bitmaps before decoding.

---

## 6. Core algorithms

### 6.1 Units & geometry (`geometry.ts`)
- `px = Math.round((mm / 25.4) * dpi)` (e.g. 35×45 mm at 300 DPI = 413×531 px).
- Floating-point math throughout crop mapping; round to integer pixels once at final output dimensions.

### 6.2 Size-targeting encoder (`encode.ts`)
- **Binary search (7 steps):** Search `q ∈ [0.35, 0.95]` using native `OffscreenCanvas.convertToBlob({ type: 'image/jpeg', quality: q })` (with `HTMLCanvasElement.toBlob` fallback). Keep the highest-quality result with `bytes <= maxBytes`.
- **Min-KB handling:** If `bytes < minBytes` at `q = 0.95`, first try `q = 1.0`. If still below `minBytes` (common on clean studio backgrounds at small px sizes), append a harmless JPEG `COM` (`0xFFFE`) comment padding segment in `ArrayBuffer` (disclosed in the UI, never altering pixels).
- **Infeasible handling:** If `q = 0.35` still exceeds `maxBytes` at fixed exact `px` dimensions, return an explicit `Infeasible` warning showing achieved KB vs target KB and offering an optional dimension step-down only when the spec allows it.
- **Conditional v0.2 gate:** Native canvas JPEG adds **0 KB** to the app bundle. `@jsquash/jpeg` (MozJPEG WASM, Apache-2.0) is only added in v0.2 if Week-0 device tests show native JPEG cannot meet 15–25 KB portal targets cleanly.

### 6.3 DPI metadata injection (`dpi.ts`)
Canvas exports drop physical DPI and write standard 72/96 DPI headers. A tiny (~80-line) pure-TS binary patcher sets exact DPI in:
- JPEG JFIF `APP0` (`units = 1`, `Xdensity = dpi`, `Ydensity = dpi`) right after `SOI`, and
- PNG `pHYs` chunk (`pixelsPerMeter = Math.round(dpi / 0.0254)`) with updated CRC32 before `IDAT`.

### 6.4 4×6 Print sheet packer (`print-sheet.ts`)
- Supports presets (`4×6 in` at 300 DPI = `1200×1800 px`, `A4` at 300 DPI) with configurable margin `m` and cut gutter `g`.
- Evaluates `0°` and `90°` photo orientation and selects `max(count)` (e.g. `35×45 mm` fits **8 photos** rotated on a 4×6 sheet vs 6 upright).
- **Single-person & Multi-photo (Café / Family) modes:** Each slot accepts either a cloned image or distinct cropped faces, with optional tiny gutter initials/cut marks so cyber cafés can print 4–8 applicants on one 4×6 sheet.

### 6.5 Binary X-Ray & WhatsApp heuristic (`inspect.ts`)
Pure `DataView` binary inspector running in `< 2 ms` on the input `ArrayBuffer` header slice (zero external libraries) to diagnose and auto-fix silent portal rejection causes:
1. **Progressive JPEG (`SOF2` / `0xFFC2`):** Flagged when present because legacy portal validators (PHP/GD/Java) often reject progressive scans; canvas re-encoding outputs baseline JPEG (`SOF0`).
2. **EXIF Orientation trap (`0x0112 !== 1`):** Flagged when phone orientation relies on metadata rather than pixel order; `createImageBitmap(..., { imageOrientation: 'from-image' })` bakes pixels upright before stripping EXIF.
3. **Container / extension mismatch:** Verifies magic bytes (`FFD8FF` JPEG, `89504E47` PNG, `RIFF....WEBP`, `ftypheic`/`ftypmif1` HEIC). Detects renamed WebP/PNG or `.jpeg` filenames; when undecodable `ftypheic` arrives on non-Safari browsers, fails cleanly with a 1-line iPhone export tip rather than bundling a ~1.5 MB `libheif` WASM decoder.
4. **Non-sRGB / CMYK ICC profile (`APP2` ICC_PROFILE or 4-component `SOF`):** Flagged for Display-P3/CMYK inputs that look washed out or fail strict portal checks; canvas export normalizes output to sRGB.
5. **WhatsApp-compression heuristic (advisory):** Flags inputs matching standard WhatsApp caps (missing EXIF + 1600/1280 px edge + low bytes-per-pixel) and suggests asking the sender to forward **as Document**—never blocking export.

---

## 7. Privacy, CSP, and security

### 7.1 Network isolation (`public/_headers` on Cloudflare Pages)

```text
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
```

- Notice v0.1 requires neither `'wasm-unsafe-eval'` nor `mediastream:` because no WASM codecs, ML models, or live camera streams are shipped.
- GitHub Pages fallback embeds the `<meta http-equiv="Content-Security-Policy">` subset (excluding `frame-ancestors`).

### 7.2 Threat model (v0.1 scope)

| Threat | Mitigation |
|---|---|
| Outbound photo leak / accidental telemetry | Zero backend, strict CSP `connect-src 'self'`, Playwright CI network guard failing on any non-same-origin request |
| Malicious or XSS-laced spec/rule/query input | All spec fields, parsed rules, and `?n=` query labels sanitized and rendered strictly as text; numeric bounds clamped; query rules badged `"Shared custom rule — confirm on portal"` |
| Oversized / decompression-bomb image | Byte & pixel sanity checks, downscale-first `createImageBitmap`, immediate bitmap/canvas disposal |
| Compromised dependency | Minimal runtime deps (Preact only in core), pinned `pnpm-lock.yaml`, `pnpm audit` in CI |
| Wrong portal limit feedback | Quiet footer/drawer "Report a wrong limit" link opens a zero-login external form in a new tab only on click (never sends photos or auto-triggers) |

---

## 8. Testing, CI, and deployment

- **Unit & property tests (Vitest + `fast-check`):**
  - `geometry.ts`: `mm <-> px` round-trips, aspect bounds.
  - `encode.ts`: output strictly within `[min, max]` bytes or explicit `Infeasible`; deterministic across runs.
  - `print-sheet.ts`: zero slot overlap, all slots inside printable bounds, optimal count vs brute-force small cases.
  - `rule-parser.ts`: ≥90% parse accuracy across a corpus of 25–30 real Nigerian portal error/instruction strings, plus `parseQuerySpec` / `toQuerySpec` round-trips and malformed query-param clamping.
  - `inspect.ts`: binary header fixture tests covering `SOF0`/`SOF2` markers, EXIF orientation tags, WebP/PNG/JPEG/HEIC (`ftypheic`) magic bytes, non-sRGB ICC detection, and WhatsApp heuristic.
- **E2E tests (Playwright):** Upload → crop → KB encode → 4×6 print sheet in Chromium/WebKit with:
  1. **Zero-outbound-request network guard** (fails on any request outside same-origin).
  2. **Airplane-mode test** (`context.setOffline(true)` after load).
- **Budgets in CI:** Core shell JS **≤ 80 KB gzip**.
- **Hosting & Guides:** Deployed on Cloudflare Pages (`main`). Static build generates 6–8 **handcrafted portal guide pages** (one per verified preset with genuine portal steps/quirks and deep link `/?spec=<id>`), avoiding thin doorway pages. Script-free Cloudflare edge HTTP metrics measure pageviews per guide without touching user browsers.

---

## 9. Decision log (ADRs)

| # | Decision | Status | Rationale |
|---|---|---|---|
| 001 | No backend, ever | Accepted | Zero upload liability, free static hosting, instant trust proof |
| 002 | Preact + TypeScript (strict) + Vite | Accepted | Tiny runtime footprint for low-RAM Androids; familiar React ergonomics |
| 003 | Unified `Spec` model for JSON presets, `parsePortalRule`, and `?n=` query links | Accepted | One pipeline handles curated portals, pasted error text, and shareable plain-query WhatsApp links |
| 004 | Zero client-side analytics; script-free Cloudflare edge metrics allowed | Amended | Preserves `connect-src 'self'` and zero-cookie privacy while avoiding flying blind on guide traffic |
| 005 | Cloudflare Pages primary, GitHub Pages fallback | Accepted | Real HTTP CSP and `Permissions-Policy` headers via `_headers` |
| 006 | Safe downscale-first decode + explicit bitmap/canvas cleanup | Accepted | Prevents iOS Safari 16.7 MP / 256–384 MB pool crashes and 2 GB Android OOMs |
| 007 | Native canvas JPEG encoder in v0.1; `@jsquash/jpeg` conditional in v0.2 | Reversed (for v0.1) | 0 KB bundle overhead; add WASM only if real-device tests show quality fails at 15–25 KB |
| 008 | No AI background replacement in v0.1 | Reversed | Banned by US/UK/Canada passports, AGPL/non-commercial model licenses, 40–50 MB OOM/data trap |
| 009 | Photos in memory only; silent EXIF strip on export | Accepted | Zero persistence; eliminates separate Scrub tool UI bloat |
| 010 | MIT for code, CC0-1.0 for specs | Accepted | Matches `LICENSE` and `LICENSE-SPECS`; maximises reuse and npm compatibility |
| 011 | Zero-login link for user limit reports; GitHub Issues for devs/PRs | Reversed | Non-technical users hit a login wall on GitHub Issues; remove post-export nagging |
| 012 | Pure DOM-free `src/engine/` extractable as `<kilocrop-input>` | New | Enables clean Web Component / npm extraction in v0.2 without rewriting processing logic |

---

## 10. Deferred / v0.2+ candidates

Items intentionally kept out of v0.1 (never start before v0.1 ships and clears the 30-day validation gates in [`TODO.md`](TODO.md)):
- Standalone `<kilocrop-input>` Web Component / npm package extraction from `src/engine/`.
- **Certificate / Slip Squeezer** (document mode keeping WAEC/NYSC/degree scans crisp under 100–200 KB) and `pdf-lib` PDF print sheets if user demand warrants them.
- `@jsquash/jpeg` (MozJPEG WASM) if native JPEG fails quality checks under 25 KB (`libheif` WASM remains excluded to protect the ≤ 80 KB bundle budget).
- Lightweight non-AI plain-wall & lighting pre-check (<5 KB, calibrated on contrast/clipping rather than global brightness for dark skin tones) and signature/thumbprint extraction.
