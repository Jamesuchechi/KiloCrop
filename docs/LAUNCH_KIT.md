# KiloCrop Launch & Deployment Kit (`T-074`)

## 1. Pre-Launch Checklist

1. **Finish real-device verification:** Run `experiments/mobile-stress-test.html` plus single-photo enhance, `/documents` leveling, and a 20-image `/batch` ZIP export on at least one **2–4 GB Android phone** and **iPhone (Safari)**; record timings and notes in [`docs/DEVICE_MATRIX.md`](DEVICE_MATRIX.md).
2. **Swap `REPORT_LIMIT_URL` (optional before broad launch):** In [`src/ui/pipeline-stats-drawer.tsx`](../src/ui/pipeline-stats-drawer.tsx), replace `REPORT_LIMIT_URL` with a zero-login form URL if non-developer portal reporting grows.
3. **Update `README.md`:** Add real desktop (Royal Blue/White/Dark Gray) and mobile screenshots once multi-page routes ship, and fill in real Android/iOS timings from [`docs/DEVICE_MATRIX.md`](DEVICE_MATRIX.md).
4. **Deploy to Cloudflare Pages:**
   - Connect `Jamesuchechi/KiloCrop` (`main` branch).
   - **Build command:** `pnpm build`
   - **Build output directory:** `dist`
   - **Environment variable:** `NODE_VERSION=22`
   - Verify live headers (`curl -sI https://<site>/ | grep -i content-security-policy`) serve `public/_headers` intact and SPA routes (`/batch`, `/compare`, `/documents`, `/inspect`, `/print`, `/presets`, `/web-kit`) fall back cleanly while `/guides/*` serves static HTML.
   - Enable **Cloudflare script-free HTTP edge metrics** in the dashboard only (zero JS snippets injected so `script-src 'self'` and `connect-src 'self'` stay unbroken).
5. **Tag release:** `git tag v1.0.0 && git push origin v1.0.0`.

---

## 2. 35-Second Phone Screen Demo Storyboard

Record vertically on a real phone (30–35 seconds total, captions only):
1. **0–6 s (Drop or paste):** Open KiloCrop in Royal Blue / Dark Gray → flip **Airplane Mode ON** → drop or pick a 4 MB camera photo.
2. **6–14 s (Sharper + smaller live):** Pick **Link preview (OG)** or **NYSC (`<= 15 KB`)** → toggle **Fix dull contrast** + **Sharpen**, drag the preview frame to adjust crop, toggle **Preview in context** (safe zones), and hold **Original vs Result**.
3. **14–22 s (Power pages):** Tap **`/batch`** to drop 8 product shots and download one offline `.zip` — or tap **`/documents`** to level a shadowed certificate scan under 150 KB.
4. **22–30 s (Inspect & Print bonus):** Tap **`/inspect`** (or footer **Pipeline stats**) showing EXIF/GPS stripped and `0 B` outbound → flip to **`/print`** showing 8 photos packed on one 300 DPI `4×6` sheet.

---

## 3. Consumer Launch Copy (X / LinkedIn / WhatsApp)

> Tired of online image resizers that blur your photos, slap rate limits, or upload every file to a random server?
>
> **KiloCrop** is a free, open-source browser image studio that resizes, enhances, and compresses photos to fit anywhere — **offline**, with **zero uploads**:
>
> - **Look sharper after shrinking:** progressive step-down scaling, auto-contrast & edge sharpening (zero watermarks)
> - **Hit exact pixels or max KB:** presets for Instagram, YouTube, LinkedIn banners, OG cards, blogs, email, plus Nigerian & global visa/exam portals (`25 KB`, `7–15 KB`, `300 DPI`)
> - **Preview in context** (avatar overlap, YouTube timestamp pill, Story safe zones) & **Pad with matching blurred backdrop** when cropping won't fit
> - Multi-page toolkit: **Batch ZIP** (`/batch`), **Format Lab** (`/compare`), **Document/Scan Squeezer** (`/documents`), **Metadata X-Ray** (`/inspect`), **4×6 Print Sheets** (`/print`), **Presets Directory** (`/presets`), and **Responsive `<picture>` Web Kit** (`/web-kit`)
>
> Try it free: `<URL>` · MIT open source: `https://github.com/Jamesuchechi/KiloCrop`

---

## 4. Engineering Launch Outline (Show HN / r/webdev / Dev X)

- **Title:** `Show HN: KiloCrop – Multi-page offline browser image studio (~35 KB initial / ~61 KB all routes gzip, 0 outbound bytes, Web Worker + pure-TS ZIP, DPI & scan cleaner)`
- **Key technical talking points:**
  1. **Mobile-first canvas memory budget:** Why naive resizers crash iOS Safari (`16.7 MP` canvas limit, `256–384 MB` pool) and 2–4 GB Androids, and how cached working-bitmap reuse + 0.5× step-halving + immediate `releaseCanvas()` (`width = height = 1`) + 1-at-a-time `/batch` queueing handle 48 MP (`896 ms` on desktop Chromium; `2.88 s` for 20-image batch) safely (`[add real phone ms from docs/DEVICE_MATRIX.md once run]`).
  2. **Pure DOM-free `src/engine/` (`eslint-plugin-boundaries` enforced):** Binary `DataView` header X-Ray (`inspect.ts`), alpha-safe Rec.709 auto-contrast & Laplacian sharpening (`enhance.ts`), `0.9×` adaptive shrink loop + JFIF/PNG `pHYs` DPI writer + JPEG `COM` min-KB padding, pure-TS `STORE` ZIP writer (`zip.ts`), 64×64 salience auto-focus (`salience.ts`), local document illumination leveling (`document.ts`), and responsive Web Kit / LQIP export (`web-kit.ts`) — `0 KB` ML/WASM downloads.
  3. **Verifiable zero-upload isolation:** Strict `style-src 'self'`, `script-src 'self'`, `connect-src 'self'` CSP, `70` Vitest unit/property tests + `11` Playwright route/CSP/offline/OS-launch tests, and a clean Royal Blue / White / Dark Gray UI with zero inline styles or external fonts.
