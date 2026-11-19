# KiloCrop v0.1 Launch & Deployment Kit (`T-033` / `T-034`)

## 1. Pre-Launch Checklist (`T-033`)

1. **Finish real-device verification:** Run `experiments/mobile-stress-test.html` + the deployed preview URL on at least one **2–4 GB Android phone** and **iPhone (Safari)**, and record timings/notes in [`docs/DEVICE_MATRIX.md`](DEVICE_MATRIX.md).
2. **Swap `REPORT_LIMIT_URL` (optional, recommended before consumer share):** In [`src/ui/pipeline-stats-drawer.tsx`](../src/ui/pipeline-stats-drawer.tsx), replace `REPORT_LIMIT_URL` with a zero-login Tally/Google Form URL so non-technical applicants do not hit a GitHub sign-in wall when reporting a changed portal limit.
3. **Update `README.md`:** Add 2 mobile screenshots (Crop Editor + `"Fixed N hidden issues"` Result screen) and paste real Android/iOS timings from `docs/DEVICE_MATRIX.md`.
4. **Deploy to Cloudflare Pages:**
   - Connect `Jamesuchechi/KiloCrop` (`main` branch).
   - **Build command:** `pnpm build`
   - **Build output directory:** `dist`
   - **Environment variable:** `NODE_VERSION=22`
   - Verify live headers (`curl -sI https://<site>/ | grep -i content-security-policy`) serve `public/_headers` intact.
   - Enable **Cloudflare Web Analytics / HTTP edge metrics** in the Cloudflare dashboard (script-free server-side counts only—do NOT inject any JS snippet so `script-src 'self'` and `connect-src 'self'` stay unbroken).
5. **Tag release:** `git tag v0.1.0 && git push origin v0.1.0`.

---

## 2. 35-Second Phone Screen Demo Storyboard (`T-034`)

Record vertically on a real phone (30–35 seconds total, no talking needed—captions only):
1. **0–6 s (The hook):** Open KiloCrop → tap **Paste rule / Custom** → paste `"UNILORIN: 600x600px, max 25KB"`.
2. **6–12 s (Offline proof):** Turn **Airplane Mode ON** in quick settings before tapping **Choose photo**.
3. **12–20 s (Crop & X-Ray):** Pick a sideways 4 MB phone photo → pinch/drag inside head-zone guide → tap **Fit & Save Photo**.
4. **20–27 s (Payoff):** Pause 2 seconds on **`Fixed 3 hidden issues` (sideways rotation + `.jpeg` extension + EXIF/GPS stripped) · 23.4 KB** + tap **Share this portal link**.
5. **27–35 s (4×6 sheet bonus):** Tap **Make 4×6 Print Sheet** → show **8 photos packed on one 4×6 in (300 DPI PNG)**.

---

## 3. Consumer Launch Copy (Nigerian X / LinkedIn / Student WhatsApp)

> Portals kept rejecting my passport photo for being "over 25 KB" or "invalid image"—and paid passport apps slap watermarks at download.
>
> So I built **KiloCrop**: free, no watermark, works offline on your phone, and **your photo never leaves your device**.
>
> - Paste ANY portal's error text (`"600x600px, max 25KB"`) and it sets everything automatically
> - Fixes hidden portal traps (sideways EXIF, progressive JPEGs, `.jpeg` vs `.jpg`, non-sRGB color)
> - Hits min & max KB limits (NYSC `7–15 KB`, WAEC GCE `5–30 KB`, UNILORIN `≤ 25 KB`, NIS `600×800`)
> - Packs **8 photos on one 4×6 print sheet** (plus Multi-photo mode for cyber cafés!)
> - One tap copies a shareable WhatsApp group link (`?n=UNILORIN&w=600&h=600&max=25`)
>
> Try it free: `<URL>` (Open source on GitHub: `https://github.com/Jamesuchechi/KiloCrop`)

---

## 4. Engineering Launch Outline (Show HN / r/webdev / Dev X)

- **Title:** `Show HN: KiloCrop – Browser-only portal photo fitter (~25 KB bundle, 0 outbound bytes, beats iOS Safari 16.7 MP crash)`
- **Key points to cover:**
  1. Why naive browser resizers crash on iPhones (`16.7 MP` single-canvas cap + `256–384 MB` tab backing pool) and 2 GB Androids, and how capped `createImageBitmap` + immediate `bitmap.close()` / `canvas.width = 1` keeps 5× sequential runs crash-free (`[insert real ms/device numbers from docs/DEVICE_MATRIX.md]`).
  2. Writing a zero-dependency `DataView` binary X-Ray (`src/engine/inspect.ts`) to diagnose `SOF2` progressive JPEGs, TIFF EXIF orientations, Display-P3 ICC profiles, `ftypheic`, and JFIF/PNG `pHYs` 300 DPI injection + `COM` segment min-KB padding.
  3. Verifiable no-upload architecture: strict CSP (`script-src 'self'`, `connect-src 'self'`), Playwright CI route guard + `securitypolicyviolation` listener + real offline Service Worker e2e tests, and a DOM-free `src/engine/` ready to extract into a drop-in `<kilocrop-input>` Web Component.
