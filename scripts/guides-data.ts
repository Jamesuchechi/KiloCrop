export interface PortalGuide {
  slug: string;
  specId: string;
  headline: string;
  summary: string;
  steps: string[];
  commonRejections: string[];
  faq: Array<{ q: string; a: string }>;
}

export const PORTAL_GUIDES: readonly PortalGuide[] = [
  {
    slug: 'nigeria-passport-photo-online',
    specId: 'ng-nis-passport-online',
    headline: 'Nigeria Immigration Service (NIS) Online Passport Photo Size & Guide',
    summary:
      'Format a 600×800 px plain white-background portrait under 2 MB for the Nigeria Immigration Service passport portal—straight from your phone.',
    steps: [
      'Stand 1 metre in front of a plain white or off-white wall facing natural window light (no shadows, no glasses).',
      'Open KiloCrop with the NIS Passport preset pre-selected, upload your original camera photo (not via WhatsApp), and center your head inside the oval guide.',
      'Export your 600×800 px baseline JPEG and verify it with the Test Photo Upload tool on passport.immigration.gov.ng.',
    ],
    commonRejections: [
      'Any eyeglasses (even clear prescription glasses) or headphones.',
      'Shadows behind ears/neck or patterned/coloured curtains.',
      'Uploading a WhatsApp-compressed photo or wrong pixel ratio (NIS checks 600×800 px).',
    ],
    faq: [
      {
        q: 'Can I use an old studio photo?',
        a: 'Only if it is recent, has a plain white background, and was shared at full quality (via WhatsApp as Document or direct cable/file transfer).',
      },
      {
        q: 'Do I also need physical 35×45 mm prints for capture?',
        a: 'Online portals ask for 600×800 px digital uploads; if you need physical prints too, tap Make 4×6 Print Sheet in KiloCrop for 8 copies on one 4×6 sheet.',
      },
    ],
  },
  {
    slug: 'nysc-passport-photo-size',
    specId: 'ng-nysc-portal',
    headline: 'NYSC Mobilization Passport Photo Size (200×200 px, 7–15 KB)',
    summary:
      'Crop to 200×200 px and hit NYSC’s tight 7–15 KB window—including automatic harmless padding if a clean background compresses under 7 KB.',
    steps: [
      'Take a bright chest-up photo against a plain white or off-white wall with both ears visible.',
      'Select the NYSC preset in KiloCrop (or confirm the exact prompt shown inside portal.nysc.org.ng).',
      'Save the resulting 200×200 px JPEG (7–15 KB) and upload straight from Downloads.',
    ],
    commonRejections: [
      'Uploading a photo under 7 KB or over 15 KB (KiloCrop searches quality and pads to meet the 7 KB floor without altering pixels).',
      'Sideways EXIF phone rotation or progressive JPEG encoding rejected by legacy PHP validators.',
      'Heavy shadows or patterned walls.',
    ],
    faq: [
      {
        q: 'Why did my 200×200 photo fail for being under 7 KB?',
        a: 'Plain white backgrounds compress very aggressively at 200×200 px. KiloCrop detects files below 7 KB, tries quality 1.0, and adds harmless JPEG COM metadata padding up to 7 KB.',
      },
      {
        q: 'How do I send it to a cyber café without ruining it?',
        a: 'Attach it in WhatsApp via Document instead of Gallery so WhatsApp does not resize it.',
      },
    ],
  },
  {
    slug: 'waec-gce-passport-photo',
    specId: 'ng-waec-gce',
    headline: 'WAEC GCE Private Candidate Passport Photo (275×314 px, 5–30 KB)',
    summary:
      'Resize private WAEC GCE candidate photos cleanly to 275×314 px and 5–30 KB on your phone before registration closes.',
    steps: [
      'Check your active WAEC GCE registration prompt to confirm whether that exam series specifies a white or red background.',
      'Crop cleanly in KiloCrop with your head centered and ears visible.',
      'Save the baseline .jpg file (5–30 KB) and upload it directly on the registration portal.',
    ],
    commonRejections: [
      'Using school WAEC/NECO biometric rules instead of private GCE web limits.',
      'Exceeding 30 KB or dropping below 5 KB.',
      'Uploading a sideways photo or renamed WebP file.',
    ],
    faq: [
      {
        q: 'Does this cover school WAEC/NECO or JAMB UTME?',
        a: 'No. School WAEC/NECO and JAMB UTME capture candidate biometrics live on-site, not via browser uploads.',
      },
    ],
  },
  {
    slug: 'unilorin-post-utme-passport-photo',
    specId: 'ng-unilorin-post-utme',
    headline: 'UNILORIN Post-UTME Passport Photo (600×600 px, ≤ 25 KB, Red Background)',
    summary:
      'Meet UNILORIN’s notoriously strict 600×600 px under 25 KB JPEG limit on a uniform red background without blurry artifacts.',
    steps: [
      'Take your photo against a uniform red backdrop (KiloCrop does not fake backgrounds so you will not fail clearance verification).',
      'Crop square at 600×600 px in KiloCrop; the encoder binary-searches JPEG quality to stay strictly ≤ 25 KB and injects 200 DPI into the JFIF header.',
      'Double-check the live UNILORIN screening prompt inside portal.unilorin.edu.ng before submitting.',
    ],
    commonRejections: [
      'Exceeding 25 KB at 600×600 px (most phone photos are 2–5 MB).',
      'Using a white or blue background instead of uniform red.',
      'Progressive JPEG or non-sRGB iPhone Display-P3 profiles.',
    ],
    faq: [
      {
        q: 'Does KiloCrop swap my background to red automatically?',
        a: 'No. Nigerian universities cross-check screening photos at physical clearance and reject obvious cutouts; retake against a red backdrop or cloth.',
      },
    ],
  },
  {
    slug: 'oau-post-utme-passport-photo',
    specId: 'ng-oau-post-utme',
    headline: 'OAU Screening & Portal Passport Photo (360×400 px, Light Sky-Blue)',
    summary:
      'Crop and compress OAU portal passport uploads to 360×400 px under 30–50 KB with exact portal aspect framing.',
    steps: [
      'Take a frontal chest-up photo against a light sky-blue background.',
      'Load the OAU preset in KiloCrop and adjust the Max KB chip to 30 KB if your active OAU module specifies a tighter cap.',
      'Save the 360×400 px baseline JPEG and upload.',
    ],
    commonRejections: [
      'Using a red or pure white background when the module specifies light sky-blue.',
      'Uploading raw megabyte files straight from a phone camera.',
    ],
    faq: [
      {
        q: 'What if my OAU module says max 30 KB instead of 50 KB?',
        a: 'Tap Paste rule / Custom in KiloCrop and change Max KB to 30—the binary search hits it cleanly.',
      },
    ],
  },
  {
    slug: 'lasu-screening-passport-photo',
    specId: 'ng-lasu-post-utme',
    headline: 'LASU Screening Portal Passport Photo (≤ 20 KB)',
    summary:
      'Squeeze a clean JPEG strictly under 20 KB for Lagos State University screening portals without losing facial clarity.',
    steps: [
      'Log into your active LASU screening screen to verify exact pixel dimensions (300×300 px is pre-filled as a starting point).',
      'Adjust Width/Height under Paste rule / Custom if your form specifies different dimensions, keeping Max KB at 20.',
      'Save the baseline .jpg file and upload directly.',
    ],
    commonRejections: [
      'Files over 20 KB or saved with a .jpeg/.png extension instead of .jpg.',
      'Cropping out shoulders or tilting the head.',
    ],
    faq: [
      {
        q: 'Why does KiloCrop label LASU as "Login portal — confirm limits"?',
        a: 'LASU’s exact upload prompt sits behind applicant authentication and can change between admission cycles, so we prompt you to verify dimensions on screen.',
      },
    ],
  },
  {
    slug: 'us-visa-ds160-photo-size',
    specId: 'us-visa-ds160',
    headline: 'U.S. Visa DS-160 Digital Photo Requirements (600×600 px, ≤ 240 KB)',
    summary:
      'Format an authentic, unretouched 600×600 px sRGB JPEG under 240 KB matching official U.S. Department of State DS-160 digital photo specs.',
    steps: [
      'Take a recent photo in front of a plain white or off-white wall with even lighting, neutral expression, and NO eyeglasses.',
      'Use KiloCrop’s US DS-160 preset (head height guide 50–69%) to crop a centered 600×600 px square.',
      'Export the sRGB baseline JPEG (≤ 240 KB) and test it inside the official DS-160 form uploader.',
    ],
    commonRejections: [
      'Digitally altered or AI-replaced backgrounds (explicitly banned by travel.state.gov).',
      'Wearing glasses, smiling with teeth, or shadows across the face.',
      'Display-P3 wide-gamut color profile or file size over 240 KB.',
    ],
    faq: [
      {
        q: 'Can I also make 2×2 inch (51×51 mm) physical prints for my visa interview?',
        a: 'Yes. After exporting, click Make 4×6 Print Sheet and choose 2×2 in (50.8×50.8 mm) to tile 6 interview photos onto one 4×6 sheet.',
      },
    ],
  },
  {
    slug: 'uk-digital-passport-photo',
    specId: 'uk-passport-digital',
    headline: 'UK Digital Passport Photo Requirements (≥ 600×750 px, 50 KB–10 MB)',
    summary:
      'Prepare a clean, unaltered portrait meeting GOV.UK’s minimum 600×750 px resolution and 50 KB file-size floor.',
    steps: [
      'Stand against a plain light-coloured wall with clear contrast and no other people or shadows.',
      'Leave generous space around your head and shoulders—GOV.UK instructs applicants NOT to pre-crop tightly so their online tool can frame you.',
      'Export with KiloCrop to guarantee at least 600×750 px, sRGB color, upright pixels, and ≥ 50 KB size.',
    ],
    commonRejections: [
      'Cropping too tightly around the face before uploading to GOV.UK.',
      'Digitally edited/replaced background or beauty filters.',
      'Uploading a heavily crushed WhatsApp photo under 50 KB.',
    ],
    faq: [
      {
        q: 'Why does KiloCrop ensure the file stays at least 50 KB?',
        a: 'GOV.UK rejects digital passport uploads smaller than 50 KB because over-compressed images fail automated facial quality checks.',
      },
    ],
  },
];
