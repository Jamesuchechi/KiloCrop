# TODO — KiloCrop v0.1 (3-Week MVP Sprint)

Working plan for **KiloCrop** (`~30–40 h` part-time across 3 weeks, preceded by a Week-0 validation gate). Companion to [`README.md`](README.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md).

**Rules**
- Task IDs (`T-0xx`) are stable; reference them in commits/PRs.
- Estimates assume one solo part-time developer: `S` ≤ 2 h · `M` ≈ half day · `L` ≈ 1–2 days.
- Status: `[ ]` open · `[~]` in progress · `[x]` done · `[-]` dropped.
- **Hard gate:** Do not start Week 1 scaffolding until Week-0 exit criteria pass.

---

## Week 0: Validation & Risk Burn-Down (Days 1–4, before app scaffolding)

- [x] **T-001 (S)** Rename the GitHub repository to `KiloCrop`, update local `git remote` (`git@github.com:Jamesuchechi/KiloCrop.git`), and verify domain/npm availability (`kilocrop.app` unused, `kilocrop` 404 on npm).
- [x] **T-002 (S)** Switched `LICENSE` to MIT and added `LICENSE-SPECS` (`CC0-1.0`); synced docs.
- [x] **T-003 (M)** **E1 — Nigerian & Visa Portal Ground-Truth Audit:** Inspected 14 real portals and documented in `docs/PORTAL_AUDIT.md`, picking **8 recommended launch presets** (`ng-nis-passport-online`, `ng-nysc-portal`, `ng-waec-gce`, `ng-unilorin-post-utme`, `ng-oau-post-utme`, `ng-lasu-post-utme`, `us-visa-ds160`, `uk-passport-digital`). *(Authenticated Nigerian portals must be screenshot-verified before promoting from `draft` to `checked` in `T-020`. NIN/NIMC, FRSC Driver's Licence, JAMB UTME, and school WAEC/NECO explicitly excluded—live biometric capture only.)*
- [~] **T-004 (M)** **E4 — 150-line Mobile Memory Stress Test:** Built standalone zero-dependency harness in `experiments/mobile-stress-test.html` + runbook in `docs/DEVICE_MATRIX.md`. **Remaining (manual):** run 5× sequentially on a 2–4 GB Android (Tecno/Infinix class) AND iOS Safari and record results in `docs/DEVICE_MATRIX.md`.
- [ ] **T-005 (M)** **E2 — Reality Check (3–5 applicants / cyber cafés):** Observation guide ready in `docs/WEEK0_FIELD_CHECK.md`. Run with 3–5 real Nigerian applicants / cyber cafés using `imresizer.com`, `pi7.org`, or their usual workflow; record times and multi-photo 4×6 print-sheet interest.

**Week-0 Exit Gate:** ≥ 6 verified uploadable presets documented; 0 crashes across 5× sequential 48 MP runs on target mobile devices; native JPEG quality acceptable at 25 KB (or flag `@jsquash/jpeg` fallback).

---

## Week 1: Walking Skeleton & Pure Engine (Days 5–9)

- [x] **T-010 (S)** Scaffold Vite + Preact + TypeScript (strict), Vitest, `fast-check`, ESLint + `eslint-plugin-boundaries` (`src/engine/` imports zero DOM/UI globals), Prettier, `.gitignore`, and GitHub Actions CI (`lint`, `typecheck`, `test`, `build`).
- [x] **T-011 (M)** `src/engine/geometry.ts` + `src/engine/decode.ts`: `mm <-> px <-> dpi`, safe downscale-first `createImageBitmap` decode (`<= 1600 px` preview), explicit `bitmap.close()` and canvas reset helpers, tested with EXIF-rotated fixtures.
- [x] **T-012 (M)** `src/engine/encode.ts` + `src/engine/dpi.ts`: native JPEG binary search (`min`/`max` KB, disclosed `COM` segment padding for `min`), silent EXIF stripping, pure-TS JFIF `APP0` + PNG `pHYs` 300 DPI writer, and `fast-check` property tests.
- [x] **T-013 (M)** `src/engine/rule-parser.ts` + `src/engine/inspect.ts`: deterministic `"Paste portal rule / error message"` parser + plain-query `?n=&w=&h=&min=&max=&u=` parse/serialize (tested against 30 real Nigerian/global portal snippets, 100% pass) AND zero-dep `DataView` binary X-Ray (`SOF2` progressive JPEG, EXIF orientation, container/magic bytes incl. `ftypheic`, non-sRGB/CMYK ICC markers, and advisory WhatsApp check) with header fixture unit tests.
- [x] **T-014 (S)** Single plain Web Worker wrapper (`src/workers/engine.worker.ts` + `src/workers/client.ts`) using typed `postMessage` + transferables (`ImageBitmap`/`ArrayBuffer`), clean main-thread fallback, and walking-skeleton `src/app/` shell.

---

## Week 2: Mobile UX, Verified Presets & 4×6 Print Sheet (Days 10–15)

- [x] **T-020 (M)** Authored 9 portal JSON specs in `specs/` (`specs/schema.json`, `specs/_template.json` draft, 4 `checked` public specs, 5 `community` authenticated Nigerian portals) + `scripts/validate-specs.ts` emitting `specs/bundle.json` (1,770 B gzip < 3 KB) + `src/engine/specs.ts` tests.
- [x] **T-021 (L)** Mobile-first UI flow (`src/ui/` + `src/app/`):
  - 2 clear entry paths: **Pick your portal** (preset chips, search, background swatch, honest provenance badge) OR **Paste rule / Custom** (editable parsed chips), plus `?spec=` & `?n=&w=&h=&min=&max=&u=` query handling badged `"Shared custom rule — confirm on portal"`.
  - Pointer + pinch + wheel + keyboard pan/zoom crop editor under a fixed aspect ratio + toggleable visual head-zone guide (`src/ui/crop-editor/CropEditor.tsx`).
  - Result screen (`src/ui/result-view.tsx`): `"Fixed N hidden issues"` X-Ray summary (plus blocking `ftypheic` iPhone export tip), instant KB/dimension summary, **Save photo** (`NYSC-photo-12KB.jpg`), Web Share API, `"Share this portal link"` button, and 2-step WhatsApp Document tip.
  - Quiet footer link (`Offline-ready · 0 B sent · Pipeline stats`) opening the compact **Pipeline stats** drawer (`src/ui/pipeline-stats-drawer.tsx`).
- [x] **T-022 (M)** `src/engine/print-sheet.ts` + Print Sheet UI (`src/ui/print-sheet-view.tsx`) + worker wiring: deterministic 4×6 in (8-up rotated `35×45 mm`), 5×7 in, and A4 300 DPI PNG packer with cut marks, toggleable **Multi-photo (Café / Family) mode** with gutter labels, and `fast-check` no-overlap/bounds tests.

---

## Week 3: Offline PWA, Proof, Deploy & Launch (Days 16–21)

- [x] **T-030 (M)** Offline PWA & CSP: removed all inline `style=` attributes across `src/ui/`, added `public/_headers` (strict CSP, `Permissions-Policy`, immutable cache rules), `public/manifest.webmanifest` + SVG/192/512 PNG icons, dynamic Precaching Service Worker generator (`scripts/build-sw.ts`), and production SW registration in `src/app/main.tsx`. *(Manual deploy step: enable script-free Cloudflare edge HTTP metrics in Cloudflare dashboard.)*
- [x] **T-031 (M)** Bundle budget gate (`scripts/check-bundle-budget.ts`: `≤ 80 KB` gzip core JS, `≤ 20 KB` gzip worker, `< 3 KB` gzip specs) + Playwright e2e suite (`e2e/kilocrop.spec.ts` + `scripts/serve-dist.ts` serving real `_headers` CSP): full paste-rule → crop → ≤ 25 KB export → Pipeline stats → 4×6 print sheet, XSS query-param clamping, offline airplane-mode NYSC (`200×200`, `7–15 KB`) flow, and static guide deep link — all guarded by zero-outbound-request & zero-CSP-violation assertions, wired into `.github/workflows/ci.yml`.
- [x] **T-032 (M)** 8 handcrafted static portal guide pages (`scripts/guides-data.ts` + `scripts/build-guides.ts` + `public/guides.css`) with deep links `/?spec=<id>`, `sitemap.xml`, `robots.txt`, and quiet footer `Report a wrong limit` & `Portal guides` links.
- [~] **T-033 (S)** Deploy & real-device wrap-up: launch checklist prepared in `docs/LAUNCH_KIT.md`. **Remaining (manual):** run physical 2–4 GB Android + iOS Safari verification (`docs/DEVICE_MATRIX.md`), update `README.md` with real phone screenshots/timings, deploy to Cloudflare Pages, swap `REPORT_LIMIT_URL` to a zero-login form if desired, and tag `v0.1.0`.
- [~] **T-034 (M)** **Dual-audience launch:** 35-second demo storyboard, consumer Nigerian X/WhatsApp post copy, and Show HN / r/webdev outline ready in `docs/LAUNCH_KIT.md`. **Remaining (manual):** record phone screen demo and publish after live deploy.

---

## Kill Criteria & Pivot Triggers (Evaluate 30 Days After v0.1 Launch)

Stop the consumer web app—or pivot cleanly to `<kilocrop-input>` (embeddable widget) or a Portal Document Kit—if any trigger fires:
1. **No user gap in Week 0 (`T-005`):** ≥ 4 of 5 real applicants finish in < 60 s using `imresizer.com` or `pi7.org` with zero frustration.
2. **Low organic pull:** < 200 completed exports in the first 30 days after sharing across 10 Nigerian communities and 5 cyber cafés.
3. **Budget overrun:** Core v0.1 exceeds 45 part-time hours or mobile Safari/2 GB Android edge cases consume > 50% of build time.

---

## Conditional v0.2 Backlog (Do NOT start before v0.1 ships & passes kill criteria)

- **Certificate / Slip Squeezer (v0.1.1/v0.2):** Document mode keeping WAEC/NYSC/degree scans sharp and readable under 100–200 KB (if users report credential uploads hurt alongside photos).
- Extract `src/engine/` into a standalone `<kilocrop-input>` Web Component / npm package for Nigerian school/HR/fintech portal forms.
- Add `@jsquash/jpeg` (MozJPEG WASM, Apache-2.0) *only* if real-device tests show native JPEG fails quality at 15–25 KB.
- Lightweight non-AI plain-wall & lighting pre-check (< 5 KB canvas heuristic calibrated on contrast/clipping rather than global brightness for dark skin tones).
- Signature & thumbprint cleanup tool (if requested by v0.1 users).
- `pdf-lib` PDF print sheet export (only if Nigerian print shops reject 300 DPI PNG sheets).

---

## Explicitly Dropped (Keep Out of Scope)

- **NIN (NIMC), FRSC Driver's Licence, JAMB UTME, school WAEC/NECO presets:** In-person live biometric capture only; no digital upload portal.
- **AI background replacement (ONNX/RMBG):** Banned by US/UK/Canada passport rules, license-toxic (AGPL/non-commercial models), 40–50 MB data & OOM trap.
- **Live camera Shot Guide (`getUserMedia` ML):** High cross-browser complexity; native phone camera apps are better.
- **Standalone Scrub tool:** Canvas re-encode already strips EXIF silently on every export; WhatsApp/iOS share already strips GPS.
- **Comlink worker pool & Ajv standalone validators:** Over-engineered for a single worker and < 3 KB bundled specs.
- **Bundled `libheif` WASM (~1.5 MB):** Blows the 80 KB bundle budget; detect `ftypheic` in `inspect.ts` and show a clear 1-line iPhone export tip instead.
- **Opaque base64 recipe hashes & WebRTC/QR phone-to-PC transfer gimmicks:** Replaced by readable `?n=&w=&h=&max=` query links that work directly inside WhatsApp.
- **Top-bar Privacy Meter banner, Reproducible build attestations, OPFS Family Batch, Android Share Target, 5-language i18n, low-literacy audio mode:** Engineering/scope bloat before product-market fit (technical proof moves to the unobtrusive footer **Pipeline stats** drawer).
- **GitHub-login-gated "Did it work?" outcome buttons:** Excludes > 99% of non-technical users behind a GitHub sign-in wall.
