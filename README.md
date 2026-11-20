# KiloCrop

> Resize, enhance, and compress images so they look sharper and fit anywhere they are placed — right in your browser.
> Free, no watermark, works offline, and **your photo never leaves your device**.

`Status: Multi-page browser image studio built (Phases 1–3); ready for real-device stress & Cloudflare Pages deploy` · `License: MIT (code) / CC0-1.0 (specs)` · `Hosting: static files only`

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the technical architecture and [`TODO.md`](TODO.md) for the multi-page roadmap and task tracker.

---

## Why KiloCrop exists

Getting an image to fit a website, social platform, email, document, or strict upload portal usually forces bad tradeoffs:

- **Bloated downloads & paywalls:** Online compressors inject trackers, enforce tiny daily quotas, or paywall passport/batch exports.
- **Mushy downscaled images:** Naive one-shot browser resizers soften details and wash out low-contrast photos when shrinking large phone photos.
- **Opaque size vs. pixel tradeoffs:** Forms and portals demand exact pixel ratios or hard KB caps (25–100 KB, or min–max windows like 7–15 KB) while silently rejecting progressive JPEGs, sideways EXIF rotation, or Display-P3/CMYK profiles.
- **Single-purpose toys:** Everyday users shouldn't need five separate apps to resize an OG banner, squeeze a scanned WAEC/NYSC certificate, strip GPS metadata, batch-compress 20 product photos, or tile a 4×6 print sheet.

---

## What is built today (v0.1 Live Workbench)

| Capability | What is implemented now |
|---|---|
| **Live Resize & Compress Workbench (`/`)** | Drop, paste (`Ctrl+V`), or pick any JPG/PNG/WebP image with instant live KB readout, `%` delta, and `Hold to see the original` comparison |
| **Fit Modes & Interactive Framing** | *Fit inside (keep proportions)*, *Fill & crop edges* (with drag-to-adjust focal point), *Fill & stretch*, and *Don’t enlarge small images* |
| **Image Enhancement (`enhance.ts`)** | Multi-step halving downscale + Rec.709 `0.5%`-clipped auto-contrast + alpha-aware post-shrink sharpening (`0–100%`) |
| **Adaptive Format & KB Compression** | Export to `JPEG` (with automatic white background flattening), `WebP` (smallest), or lossless `PNG`; use the quality slider or set an exact max KB limit (binary search + up to 14 `0.9×` pixel step-down passes + min-KB JPEG `COM` padding + JFIF/`pHYs` DPI headers) |
| **Unified Size & Portal Presets** | Common web/social presets (Instagram post/story, YouTube thumbnail, OG image, LinkedIn banner, WhatsApp profile, 35×45 mm Passport, Web hero, Email-safe 600 px, App icon) alongside 9 bundled portal presets (`specs/bundle.json`), `?spec=` links, and sanitized `?n=&w=&h=&min=&max=` share links |
| **Print Sheet Packer & Static Guides** | Deterministic 300 DPI `4×6`, `5×7`, and `A4` sheet tiling (0°/90° optimal packing + multi-photo café/family mode) plus 8 handcrafted `/guides/*` pages |
| **Binary X-Ray & Privacy Isolation** | Pure-TS `DataView` header inspection (`inspect.ts`), transparent EXIF/GPS scrubbing on export, Royal Blue / White / Dark Gray light & dark themes, offline Service Worker PWA, and an unobtrusive `Pipeline stats` footer drawer confirming `0 B` outbound |

---

## Multi-Page Studio Routes & Features

KiloCrop is a multi-page offline browser image studio sharing one pure TypeScript engine (`src/engine/`) and one Web Worker (`src/workers/`):

### Studio Routes

| Route | Purpose |
|---|---|
| `/` | **Resize & Compress** — interactive single-image workbench with 4 fit modes (`inside`, `fill`, `pad`, `stretch`), salience auto-focus + drag pan, Backdrop styles, Placement Simulator, Quality Meter, clipboard copy, Saved Custom Presets, and recipe share links |
| `/batch` | **Bulk Resize & ZIP** — process 2–50 images strictly 1-at-a-time in worker memory and export one `STORE` ZIP archive (`zip.ts`) |
| `/compare` | **Format & Quality Lab** — compare JPEG vs. WebP vs. PNG side-by-side with exact KB deltas, luma PSNR ratings, and a synchronized 2×/4× zoom loupe |
| `/documents` | **Document & Certificate Squeezer** — coarse-grid illumination leveling, paper whitening, Color Clean / Grayscale / Clean B&W modes, text sharpen, and tight 50–200 KB caps (`document.ts`) |
| `/inspect` | **Image X-Ray & Privacy Scrub** — full `DataView` header inspection (EXIF/GPS, ICC profile, progressive `SOF2`, WhatsApp heuristic) + 1-click clean download |
| `/print` | **Print Sheet Packer** — 300 DPI `4×6`, `5×7`, and `A4` single/multi-photo café sheet tiling (`print-sheet.ts`) |
| `/presets` | **Size & Portal Directory** — searchable social, web, print, saved, and portal preset cards with `/guides/*` links and Paste-a-Rule input |
| `/web-kit` | **Responsive Web Export Kit** — generate non-upscaling `480w`/`960w`/`1600w` WebP + JPEG assets, ~20 px blurred LQIP data URI, copy-ready `<picture>` HTML, and full `.zip` bundle (`web-kit.ts`) |
| `/guides/*` | **Static Portal Guides** — 8 static HTML/SEO guides deep-linking straight into `/?spec=<id>` |

### Core Capabilities

1. **Placement Simulator ("Preview in context"):** Pure-CSS stage overlays checking LinkedIn banner avatar overlap, Instagram Story safe zones, YouTube timestamp pills, circular avatar crops, and OG link cards.
2. **Pad with Matching Backdrop (`backdrop.ts`):** Fit mismatched orientations cleanly with 2-pass blurred echo, edge-sampled solid color, White, or Dark Gray backdrops.
3. **Zero-ML Smart Salience Auto-Focus (`salience.ts`):** Fast 64×64 edge-energy + upper-third bias sets smart initial `focalX`/`focalY` in *Fill & crop*, with drag override.
4. **Honest Quality Meter (`quality-score.ts`) & Clipboard Copy:** `< 128 px` symmetric luma PSNR comparison (*Crisp* / *Good* / *Heavy* + 1-click WebP nudge) plus 1-click `Copy image`.
5. **PWA OS Integration (`public/manifest.webmanifest` + `pwa-launch.ts`):** `file_handlers` and Service Worker `share_target` allow desktop and Android devices to launch or share photos into KiloCrop completely offline.

---

## How privacy is verified (without taking our word for it)

- **Static files only:** No backend, database, user accounts, cookies, or upload endpoints.
- **Strict Content-Security-Policy (`public/_headers` + production build):** `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'` — zero external fonts, scripts, or beacons, and zero inline `style=` attributes.
- **Automated CI network & CSP guards:** Playwright E2E tests intercept and fail on any non-same-origin request or `securitypolicyviolation` event, and verify offline processing in browser airplane mode.
- **On-demand `Pipeline stats` telemetry:** Quiet footer drawer (`Offline-ready · 0 B sent · Pipeline stats`) displays decode/enhance/encode timings, quality steps, and `0 B` outbound bytes.

---

## Tech stack & verified footprint

| Concern | Current Choice | Verified Metric / Reason |
|---|---|---|
| **UI & Build** | Preact 10 + TypeScript (strict) + Vite 8 | Initial `index` bundle `35,423 B` gz (`61,448 B` gz across all 10 non-worker chunks, `<= 80 KB` budget); CSS `7,203 B` gz |
| **Core Engine** | Pure DOM-free `src/engine/` + single Web Worker | `eslint-plugin-boundaries` + `no-restricted-globals` enforced; worker `13,869 B` gz (`<= 20 KB` budget) |
| **Image Pipeline** | Downscale-first `createImageBitmap`, step-halving `OffscreenCanvas`/`canvas`, Rec.709 enhance, adaptive `convertToBlob`/`toBlob`, pure-TS JFIF/`pHYs` DPI, `STORE` ZIP, paper leveling, Web Kit | 0 MB ML/WASM downloads; capped `<= 16 MP` canvas pool + explicit `bitmap.close()` and `releaseCanvas()` cleanup |
| **Offline & Hosting** | Minimal Service Worker (`scripts/build-sw.ts`) + Cloudflare Pages (`_headers`, `_redirects`) | Precaches `19` app shell/chunk/icon assets + handles `share_target` offline; script-free edge metrics only |
| **Testing** | Vitest + `fast-check` + Playwright | `70` unit/property tests across `17` suites + `11` Chromium E2E/offline/CSP/OS-launch tests |

---

## Developers & repository layout

Requirements: Node 24+ (scripts run with `--experimental-strip-types`) and pnpm 9+.

```bash
git clone https://github.com/Jamesuchechi/KiloCrop.git
cd KiloCrop
pnpm install
pnpm dev              # local Vite dev server
pnpm test             # Vitest unit + fast-check property tests
pnpm lint             # ESLint + boundary enforcement
pnpm typecheck        # TypeScript strict check
pnpm format:check     # Prettier formatting check
pnpm validate:specs   # validate specs/ and emit specs/bundle.json
pnpm build            # validate specs -> Vite build -> guides -> SW -> bundle budget gate
pnpm test:e2e         # Playwright E2E + zero-network + offline airplane-mode tests
```

```text
KiloCrop/
├─ index.html                     # App entry HTML (production CSP injected on build)
├─ specs/                         # Verified JSON portal presets + schema + bundle.json (1,776 B gzip)
├─ src/
│  ├─ app/                        # Preact shell (App.tsx, main.tsx, router.tsx, pwa-launch.ts, styles.css)
│  ├─ ui/                         # Studio controls, stage, placement simulator, and lazy /pages/* views
│  ├─ engine/                     # Pure DOM-free TS: decode, geometry, enhance, backdrop, salience, encode, dpi, inspect, presets, print-sheet, rule-parser, specs, quality-score, zip, document, web-kit, pipeline
│  └─ workers/                    # Typed postMessage protocol, single worker bitmap cache, main-thread fallback
├─ scripts/                       # validate-specs, build-guides, build-sw, check-bundle-budget, serve-dist
├─ e2e/                           # Playwright CSP, zero-outbound-network, and offline SW tests
├─ docs/                          # PORTAL_AUDIT, DEVICE_MATRIX, WEEK0_FIELD_CHECK, LAUNCH_KIT
├─ experiments/                   # Standalone 48 MP mobile memory stress harness
└─ public/                        # _headers, manifest.webmanifest, guides.css, icons
```

---

## Explicit non-goals & honest limitations

- **Explicit non-goals:** User accounts, cloud storage/sync, beauty filters or face retouching, heavyweight ~1.5 MB WASM decoders (`libheif`), AI background removal (banned on US/UK/Canada passports, heavy on 2–4 GB mobile RAM/data, and license-hazardous), live-biometric-only portals (`NIN`, `FRSC`, `JAMB UTME`, school `WAEC`/`NECO`), and guaranteeing official agency acceptance.
- **Limitations:** HEIC files from iPhones cannot be decoded by Chrome on Windows/Android natively (`inspect.ts` detects `ftypheic` and shows a 1-line iPhone Safari / *Most Compatible* tip). Browser WebP encoding support varies slightly on older browsers (automatically detected and surfaced in the status note). Always confirm final portal rules on live forms.

---

## License

- **Code:** MIT License ([`LICENSE`](LICENSE)).
- **Specs & guide data:** CC0 1.0 Universal ([`LICENSE-SPECS`](LICENSE-SPECS)).
