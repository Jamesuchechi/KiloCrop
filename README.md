# KiloCrop

> Crop, fit, and compress photos to exact portal KB & pixel rules — right in your browser.
> Free, no watermark, works offline, and **your photo never leaves your device**.

`Status: pre-alpha (v0.1 sprint)` · `License: MIT (code) / CC0-1.0 (specs)` · `Hosting: static files only`

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the technical design and [`TODO.md`](TODO.md) for the 3-week v0.1 MVP plan.

---

## Why KiloCrop exists

Online forms and portals routinely reject valid photos for rigid, poorly explained file rules:

- **Strict KB windows:** Post-UTME, NYSC, WAEC GCE, and scholarship portals frequently demand 25–100 KB JPEGs (and sometimes reject files that are *too small*). Phone cameras output 3–8 MB.
- **Paywalled passport apps:** Global photo sites charge US$9–$14+ at download or add watermarks.
- **WhatsApp-crushed photos:** Sending a passport photo over normal WhatsApp recompresses and resizes it, breaking portal dimension checks.
- **Single-photo print markups:** Cyber cafés and studios often charge per cut instead of tiling 6–8 photos onto one cheap 4×6 print sheet.

**Scope honesty on Nigerian documents:** KiloCrop targets portals that actually accept digital photo uploads (such as NIS online passport uploads, NYSC mobilization, WAEC GCE private registration, university Post-UTME portals, jobs/scholarships, and US/UK visas). **NIN (NIMC), FRSC Driver's Licence, JAMB UTME, and school WAEC/NECO are explicitly excluded** because those agencies capture photos live on-site via biometric hardware rather than user uploads.

---

## What v0.1 does

| Capability | What you get |
|---|---|
| **Verified Portal Presets** | 6–8 Week-0-audited presets for real uploadable Nigerian portals and major visas (plus clear guidance on quirks) |
| **Paste-a-Rule & Custom Fit** | Paste any portal requirement or error text (e.g. `"Passport must be JPG, max 25KB, 300x300px"`) to auto-fill editable width, height, and KB settings |
| **Shareable Portal Links** | Copy a plain link (`?n=UNILAG&w=300&h=300&max=25`) for WhatsApp/Telegram groups so classmates skip setup (badged `"Shared custom rule — confirm on portal"`) |
| **Exact KB Window Encoding** | Binary search over JPEG quality to land cleanly under `max` KB and above `min` KB, with neutral filenames (`NYSC-photo-42KB.jpg`) and Web Share support |
| **4×6 Print Sheet Packer** | Deterministic 300 DPI PNG tiling (with optimal 0°/90° rotation and cut marks), supporting both single-person sheets and multi-photo café/family mode |
| **Binary X-Ray & Silent EXIF Scrub** | Zero-dependency header inspector (`inspect.ts`) detects and auto-fixes common silent rejection traps (progressive JPEG `SOF2`, sideways EXIF orientation, `.jpeg`/container mismatches incl. HEIC guidance, wide-gamut/CMYK ICC profiles, WhatsApp compression) and strips GPS/EXIF on export |

---

## How privacy is verified (without taking our word for it)

- **Static files only:** There is no backend, database, account system, or upload endpoint.
- **Strict Content-Security-Policy:** Deployed with `connect-src 'self'`, `script-src 'self'`, and `Permissions-Policy: camera=(), microphone=(), geolocation=()`. The page physically cannot transmit photos off-device.
- **Automated CI network guard:** Playwright e2e tests assert zero outbound non-same-origin network requests and verify full export flows in **airplane/offline mode**.
- **Quiet Pipeline stats drawer:** An unobtrusive footer link (`Offline · 0 B sent · Pipeline stats`) lets engineers inspect decode time, search steps, output format, and `0` outbound bytes without cluttering everyday users.
- **No client-side trackers or cookies:** Zero third-party scripts, fonts, or JS analytics beacons. Only script-free Cloudflare edge HTTP counts (pageviews per portal guide, country, status codes; zero PII) are used to see which portal guides help users.

---

## Portal specs as data

Each built-in preset is stored as a JSON file in `specs/` and validated at build time. The values below are placeholders—real values are verified directly against portals in Week 0 (`TODO.md` T-003) before any preset ships.

```json
{
  "id": "example-portal-photo",
  "schemaVersion": 1,
  "title": "Example portal photo (placeholder)",
  "region": "NG",
  "status": "draft",
  "output": {
    "units": "px",
    "width": 300,
    "height": 300,
    "dpi": null,
    "format": "jpeg",
    "fileSizeKb": { "min": 15, "max": 50 }
  },
  "framing": {
    "headHeightPct": [65, 80],
    "eyeLineFromTopPct": [40, 50]
  },
  "provenance": {
    "kind": "public-page",
    "sourceUrl": null,
    "archiveUrl": null,
    "verifiedOn": null,
    "notes": "Placeholder only; verify live portal before publishing."
  }
}
```

### Spec status levels

| Status | Meaning |
|---|---|
| `draft` | Unverified placeholder; excluded from production builds. |
| `checked` | Verified by a maintainer against an official public page (`sourceUrl` + archive snapshot) or a live authenticated portal screenshot/check, with `verifiedOn` date. |
| `stale` | Not re-checked in over 12 months or flagged as changed. Shown with a warning banner. |

---

## Tech stack & performance budgets

| Concern | Choice (v0.1) | Why |
|---|---|---|
| **UI & Build** | Preact + TypeScript (strict) + Vite | Small runtime bundle for budget Android devices and fast 3G/4G loads |
| **Core Engine** | Pure DOM-free `src/engine/` + single plain Web Worker | Keeps image processing off the UI thread; cleanly extractable as a future `<kilocrop-input>` Web Component |
| **Image Pipeline** | `createImageBitmap` (downscale-first), native `canvas.toBlob` / `convertToBlob`, pure-TS JFIF/PNG DPI writer | 0 KB extra WASM payload; explicitly bounded for iOS Safari's 16.7 MP canvas cap and 2–4 GB Android RAM |
| **Offline & Hosting** | Minimal Service Worker + Cloudflare Pages (`_headers` CSP) | Instant offline repeat use; GitHub Pages supported as fallback |
| **Testing** | Vitest + `fast-check` + Playwright | Property-based KB/layout guarantees + CI zero-network & offline assertions |

**v0.1 Budgets:** Core shell JS ≤ 80 KB gzip · 0 MB ML model downloads · Tested on 2–4 GB Android (Tecno/Infinix class) and iOS Safari across 5 sequential 48 MP inputs with zero crashes.

---

## Getting started (developers)

> **Note:** KiloCrop is currently in Week 0 (pre-scaffold validation). The layout and commands below describe the v0.1 codebase starting in Week 1 (`TODO.md` T-010).

Requirements: Node 20+ and pnpm 9+.

```bash
git clone https://github.com/Jamesuchechi/KiloCrop.git
cd KiloCrop
pnpm install
pnpm dev              # local dev server
pnpm test             # Vitest unit + fast-check property tests
pnpm validate:specs   # schema + range sanity checks on specs/
pnpm test:e2e         # Playwright (includes zero-network guard & offline suite)
pnpm build            # static output in dist/
```

Planned v0.1 layout:

```text
KiloCrop/
├─ specs/            # JSON portal presets + schema + validation
├─ src/
│  ├─ app/           # Preact shell, routing, state
│  ├─ ui/            # crop editor (head-zone overlay), rule paster, print sheet UI
│  ├─ engine/        # pure DOM-free TS: inspect, decode, geometry, encode, dpi, print-sheet, rule-parser
│  ├─ workers/       # single plain Web Worker wrapper + main-thread fallback
│  └─ sw/            # minimal offline service worker
├─ scripts/          # spec validation/bundling + static portal guide generator
├─ e2e/              # Playwright flows + zero-outbound-request guard + offline tests
└─ public/           # Cloudflare _headers, manifest, icons
```

---

## Roadmap & non-goals

- **v0.1 (Weeks 0–3):** Week-0 portal audit & mobile 48 MP memory stress test → manual crop with head-zone guide, Paste-a-Rule parser & shareable query links, Binary X-Ray (`inspect.ts`), min–max KB binary search, 6–8 verified upload presets, 4×6 300 DPI print sheet (single & multi-photo café mode), offline PWA, handcrafted portal guides.
- **v0.2+ (Conditional on v0.1 traction):** Extract `src/engine/` into a drop-in `<kilocrop-input>` Web Component / npm package; add a **Certificate / Slip Squeezer** (document mode keeping WAEC/NYSC/degree scans sharp under 100–200 KB); evaluate `@jsquash/jpeg` (Apache-2.0) only if native JPEG struggles under 25 KB; lightweight non-AI plain-wall/lighting check (<5 KB); signature cleanup if users ask for it.

**Explicit non-goals:** Accounts, cloud uploads/sync, cosmetic filters or face modification, bundling heavy WASM decoders like `libheif` (~1.5 MB), AI background replacement (explicitly banned by US/UK/Canada passports, heavy on mobile data/RAM, and prone to restrictive licenses), live-capture-only IDs (NIN, JAMB UTME, FRSC, school WAEC/NECO), and guaranteeing agency approval.

---

## Honest limitations & disclaimer

- KiloCrop formats photos to **published technical limits** (pixel size, aspect ratio, DPI, KB range); it **cannot guarantee acceptance** by any agency or portal.
- Portal rules change frequently and sometimes sit behind login walls. Always double-check the target form's instructions—and use **Paste portal rule** or **Custom** if a limit changed.
- Not affiliated with any government agency, examination body, or university.

---

## License

- **Code:** MIT License ([`LICENSE`](LICENSE)).
- **Specs & guide data:** CC0 1.0 Universal ([`LICENSE-SPECS`](LICENSE-SPECS)).
