# Week-0 Mobile Device & Memory Matrix (`T-004` & `T-072`)

`Status: Desktop Chromium stress benchmarks verified; physical Android & iOS Safari runs pending` · `Test harness:` [`experiments/mobile-stress-test.html`](../experiments/mobile-stress-test.html)

This matrix validates **H4 (mobile browser feasibility)** on real hardware *before* writing framework code, specifically testing:
- **iOS Safari** 16.7 MP single-canvas cap (`4096 × 4096`) and ~256–384 MB canvas pool across 5 sequential runs.
- **2–4 GB Android Chrome** (Tecno / Infinix / Samsung A-series class) stability under 48 MP camera JPEGs.
- **Path B (`createImageBitmap` crop-at-decode)** orientation & crop-rect accuracy when EXIF `Orientation !== 1`.
- **Native `canvas.toBlob` JPEG quality** on the hardest `T-003` targets (`UNILORIN 600 × 600 ≤ 25 KB` and `LASU 300 × 300 ≤ 20 KB`).

---

## How to run on real phones (zero external dependencies)

1. From the repo root on your laptop, start a static local server on your LAN:
   ```bash
   python3 -m http.server 8080 --bind 0.0.0.0
   ```
2. Find your laptop's local IP (`hostname -I | awk '{print $1}'`) and open on each phone on the same Wi-Fi:
   ```text
   http://<LAN-IP>:8080/experiments/mobile-stress-test.html
   ```
3. Pick a **real 12–48 MP portrait photo** from the phone camera (not WhatsApp), select **UNILORIN stress: 600×600 px, ≤ 25 KB**, and tap **Run 5× Sequential**.
4. Inspect the 1:1 JPEG preview on screen for unacceptable blockiness/halos, then tap **Copy Markdown Row** and paste into the table below. Repeat for **LASU (≤ 20 KB)** and **NYSC (7–15 KB)** if needed.

---

## Results table

| Device / OS / Browser | RAM (`deviceMemory`) | Input MP | Preset Tested | 5× Sequential | Avg Total Time | Final KB (`q`) | Path B (`createImageBitmap` crop-at-decode) | Visual Quality & Notes |
|---|---|---|---|---|---|---|---|---|
| *2–4 GB Android (Tecno/Infinix/etc.), Chrome* | *TBD* | *48 MP* | *UNILORIN 600×600 ≤25KB* | *TBD* | *TBD* | *TBD* | *TBD* | *Pending physical device run* |
| *iPhone / iOS Safari* | *n/a* | *12–48 MP* | *UNILORIN 600×600 ≤25KB* | *TBD* | *TBD* | *TBD* | *TBD* | *Pending physical device run* |
| *Desktop Chrome / Firefox (baseline)* | *TBD* | *12–48 MP* | *UNILORIN 600×600 ≤25KB* | *TBD* | *TBD* | *TBD* | *TBD* | *Pending run* |

---

## Week-0 Pass / Escalation Checklist

- [ ] **0 tab crashes / reloads** across 5 sequential runs on both 2–4 GB Android and iOS Safari.
- [ ] **Total pipeline time ≤ 2,000 ms** on target mobile devices.
- [ ] **Native JPEG quality verdict at `600×600 ≤ 25 KB` & `300×300 ≤ 20 KB`:**
  - If readable & clean → keep native `canvas.toBlob` (0 KB bundle) for v0.1.
  - If noticeably blocky/artifacted → flag `@jsquash/jpeg` (MozJPEG WASM, lazy-loaded) for v0.1/v0.2 evaluation.
- [ ] **Path B (`createImageBitmap` crop-at-decode) verdict on EXIF-rotated photos:**
  - If `MATCH` across Android + iOS Safari → use `createImageBitmap(file, sx, sy, sw, sh, ...)` in `src/engine/decode.ts`.
  - If `MISMATCH` or `ERROR` on iOS Safari → lock `extractCrop` to the safe `<= 3200 px` capped intermediate decode path in `src/engine/decode.ts`.

---

## Multi-Page Studio Stress Cases (`T-072`)

Once real hardware runs complete on the baseline harness above, verify these studio workloads on **2–4 GB Android Chrome** and **iOS Safari**:

| Workload | Route | Pass Criteria | Result (Verified Desktop Chromium / Physical Phone Status) |
|---|---|---|---|
| **Live enhance + max KB shrink loop** (48 MP `8000×6000` photo → `1200×630` WebP `<= 40 KB` with contrast + sharpen on, cached slider tweak) | `/` | `0` tab reloads; slider updates settle cleanly from cached working bitmap | **Desktop Chromium (Linux headless):** `0` errors · `896 ms` initial (`19 KB` WebP) · `672 ms` cached sharpen tweak (incl. 120 ms debounce). *Android/iOS: Pending physical device run.* |
| **Sequential 20-image Batch ZIP** (20 × `1600×1200` JPEGs → `1200w`, `<= 150 KB`) | `/batch` | `0` OOM crashes; peak backing stores released per file; valid `.zip` | **Desktop Chromium (Linux headless):** `0` errors · `2,877 ms` total (`~144 ms/photo`); `100%` done & valid `STORE` ZIP. *Android/iOS: Pending physical device run.* |
| **Document / Scan shadow leveling** (shadowed 12 MP `4000×3000` paper scan → `<= 150 KB` JPEG) | `/documents` | Printed text & signatures sharp and legible; `<= 1,500 ms` total runtime | **Desktop Chromium (Linux headless):** `0` errors · `874 ms` total (`88 KB` cleaned JPEG). *Android/iOS: Pending physical device run.* |
