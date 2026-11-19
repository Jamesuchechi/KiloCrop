# Week-0 Portal Ground-Truth Audit (`T-003`)

`Status: Week-0 audit complete (14 portals reviewed)` · `Spec data license: CC0-1.0`

This audit verifies which portals actually accept **user-uploaded digital photos** before writing application code, records exact published limits, and separates publicly documented specs from authenticated portal screens that require a live screenshot before promoting a preset from `draft` to `checked` in `T-020`.

---

## 1. Recommended 8 v0.1 Launch Presets

| Preset ID | Portal / Authority | Dimensions | File Size (KB) | Format | Background | Provenance & Readiness |
|---|---|---|---|---|---|---|
| `ng-nis-passport-online` | **Nigeria Immigration Service (NIS)** Online Passport | `600 × 800 px` portrait (print: `35 × 45 mm`) | `< 2048 KB` (`< 2 MB`) | JPEG, JPG, PNG | Plain white / off-white | `public-page` (`https://passport.immigration.gov.ng`, `https://portal.immigration.gov.ng` — includes live *Test Photo Upload* tool). No glasses. Ready to archive & publish as `checked`. |
| `ng-nysc-portal` | **NYSC** Mobilization Portal (`portal.nysc.org.ng`) | `200 × 200 px` square | `7–15 KB` (**min & max**) | JPEG / JPG | Plain white / off-white | `authenticated-portal`. Needs 1 active registration screenshot to confirm current cycle prompt before `checked`. |
| `ng-waec-gce` | **WAEC GCE** Private Candidate Registration | `275 × 314 px` (standard reported; verify active series) | `5–30 KB` (`< 30 KB`) | JPEG / JPG | Plain white or red (series-dependent) | `authenticated-portal`. Confirm exact series background prompt before promoting from `draft`. |
| `ng-unilorin-post-utme` | **UNILORIN** Post-UTME | `>= 600 × 600 px` (`>= 200 DPI`) | `<= 25 KB` | JPEG / JPG | Uniform **red** | `authenticated-portal`. **Key `T-004` stress case:** fitting `600 × 600 px` into `<= 25 KB` cleanly tests native JPEG quality limits. |
| `ng-oau-post-utme` | **OAU** Screening / Registration Portal (`oauife.edu.ng`) | `360 × 400 px` | `<= 30–50 KB` (module-dependent) | JPEG / JPG | **Light sky-blue** | `authenticated-portal`. Confirm active intake module limit before promoting from `draft`. |
| `ng-lasu-post-utme` | **LASU** Screening Portal (`lasu.edu.ng`) | Exact px behind portal login *(test at `300 × 300 px`)* | `<= 20 KB` | JPEG / JPG | Plain white (confirm on active screen) | `authenticated-portal`. Needs active portal screenshot for exact px before promoting from `draft`. |
| `us-visa-ds160` | **U.S. Visa Form DS-160** (Department of State) | `600 × 600 px` min to `1200 × 1200 px` max (default `600 × 600 px`) | `<= 240 KB` | JPEG (`.jpg`, 24-bit sRGB, `<= 20:1` ratio) | Plain white / off-white | `public-page` (`https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/photos/digital-image-requirements.html`). No glasses, no digital BG alteration. Ready for `checked`. |
| `uk-passport-digital` | **UK Digital Passport** (`gov.uk`) | `>= 600 × 750 px` | `50 KB – 10 MB` (**min floor**) | Color image | Plain light-coloured | `public-page` (`https://www.gov.uk/photos-for-passports`). **Important UI note:** GOV.UK asks users *not* to pre-crop tightly so their own cropper can frame; warn user in UI. Ready for `checked`. |

---

## 2. Additional Audited Portals (Reference / Beyond Top 8)

| Portal | Observed Upload Rules | Why Deferred from Top 8 (Use Paste-a-Rule / Custom in v0.1) |
|---|---|---|
| **UNN** Post-UTME (`unn.edu.ng`) | `<= 40–100 KB`, JPEG/JPG, plain white or red background | Varies by portal module; easily covered by Paste-a-Rule or `?n=UNN` link. |
| **UNILAG** Post-UTME / Student ID (`unilag.edu.ng`) | Pure white background, `<= 100–200 KB`, JPEG (px varies by form) | Less restrictive KB limit; confirm exact active Post-UTME px if added later. |
| **University of Ibadan (UI)** | CBT uses JAMB biometrics; biodata (`admissions.ui.edu.ng`) `< 100 KB` white/neutral; physical clearance `5.2 × 5.2 cm` | Physical clearance is print-sheet oriented (`5.2 × 5.2 cm` fits on 4×6 via Custom mm). |
| **Federal Civil Service Commission (FCSC)** | `20–60 KB`, `35 × 45 mm` at `300 DPI`, white/off-white background | Strong candidate for post-launch #9 preset once a live recruitment window opens. |
| **PTDF / NELFUND / FSB** Scholarships & Loans | Typically `600 × 600 px` to `600 × 800 px`, `50–500 KB` (safe target `<= 200 KB`), JPEG/PNG | Broad limits; NIS/DS-160/Custom cover these immediately. |
| **Canada IRCC Online** (`canada.ca`) | `>= 420 × 540 px` (specific PR portals require `715 × 1000` to `2000 × 2800 px`), ~`240 KB` target (`<= 4 MB`), JPEG | Permanent Residence submissions require photographer receipt metadata on a separate file. |

*Print-sheet physical sizes (built into the 4×6 Print Sheet Packer from Day 1):* `35 × 45 mm` (8-up rotated on 4×6 in at 300 DPI) and `2 × 2 in` / `51 × 51 mm` (6-up on 4×6 in at 300 DPI).

---

## 3. Explicitly Excluded (Live Biometric Capture Only)

These documents do **not** accept self-uploaded digital photos and will **not** ship as KiloCrop presets:
- **NIN (NIMC)** — captured live on-site at NIMC enrolment centres.
- **FRSC Driver's Licence** — captured live at FRSC / VIO biometric stations.
- **JAMB UTME** — captured live at accredited CBT registration centres.
- **School WAEC / NECO** — captured via school biometric/offline candidate software (distinct from private WAEC GCE web registration).

---

## 4. Key Engineering Takeaways for KiloCrop v0.1

1. **`min` KB floors are real, not theoretical:** NYSC (`7–15 KB`), WAEC GCE (`5–30 KB`), FCSC (`20–60 KB`), and UK Passport (`>= 50 KB`) all enforce minimum file sizes. `encode.ts` must keep the `q = 1.0` + disclosed JPEG `COM` padding path.
2. **UNILORIN (`>= 600 × 600 px` at `<= 25 KB`) & LASU (`<= 20 KB`) are the real quality benchmark:** Testing native `canvas.toBlob` on `600 × 600 px` at `<= 25 KB` in `T-004` tells us immediately whether native JPEG is sharp enough or whether `@jsquash/jpeg` (MozJPEG) is actually justified.
3. **Nigeria's multi-color background rules (White, Red, Sky-Blue):** Because AI background replacement is out of scope for v0.1 (OOM/data/policy risks), each preset card must show the required backdrop colour prominently before the user picks a photo.
4. **Most Nigerian school/exam portals sit behind logins:** Public official `sourceUrl`s often do not exist. Keeping `provenance.kind = "authenticated-portal"`, **Paste-a-Rule**, and **Shareable `?n=` links** first-class solves the long tail without stalling on missing URLs.
