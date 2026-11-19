import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Spec } from '../src/engine/types.ts';
import { PORTAL_GUIDES, type PortalGuide } from './guides-data.ts';

const DIST_DIR = join(process.cwd(), 'dist');
const BUNDLE_PATH = join(process.cwd(), 'specs', 'bundle.json');
const SITE_URL = (process.env.SITE_URL ?? 'https://kilocrop.app').replace(/\/+$/, '');

function esc(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSizeRule(spec: Spec): string {
  const { min, max } = spec.output.fileSizeKb;
  if (min !== null && max !== null) return `${min}–${max} KB`;
  if (max !== null) return max >= 1024 ? `≤ ${(max / 1024).toFixed(1)} MB` : `≤ ${max} KB`;
  if (min !== null) return `≥ ${min} KB`;
  return 'No cap';
}

function renderGuidePage(guide: PortalGuide, spec: Spec): string {
  const dimText =
    spec.output.units === 'mm'
      ? `${spec.output.width} × ${spec.output.height} mm (${spec.output.dpi ?? 300} DPI)`
      : `${spec.output.width} × ${spec.output.height} px`;

  const provenanceHtml =
    spec.status === 'checked' && spec.provenance.sourceUrl
      ? `<span class="badge badge-ok">Verified source</span> (<a href="${esc(spec.provenance.sourceUrl)}" target="_blank" rel="noopener noreferrer">official page</a>)`
      : `<span class="badge badge-warn">Login portal — confirm limits</span>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'"
    />
    <meta name="description" content="${esc(guide.summary)}" />
    <link rel="stylesheet" href="/guides.css" />
    <link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
    <title>${esc(guide.headline)} — KiloCrop</title>
  </head>
  <body>
    <main>
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="/">KiloCrop App</a> / <a href="/guides/">Portal Guides</a> / ${esc(spec.shortLabel ?? spec.title)}
      </nav>

      <h1>${esc(guide.headline)}</h1>
      <p class="lead">${esc(guide.summary)}</p>

      <div class="card">
        <a class="cta" href="/?spec=${encodeURIComponent(spec.id)}">Open in KiloCrop →</a>
      </div>

      <section class="card">
        <h2>Required Specifications</h2>
        <table>
          <tbody>
            <tr><th>Dimensions</th><td>${esc(dimText)}</td></tr>
            <tr><th>File Size</th><td>${esc(formatSizeRule(spec))} (${esc(spec.output.format.toUpperCase())})</td></tr>
            <tr><th>Background</th><td>${esc(spec.backgroundHint ?? 'Plain light background')}</td></tr>
            <tr><th>Verification</th><td>${provenanceHtml}</td></tr>
          </tbody>
        </table>
      </section>

      <section class="card">
        <h2>How to Fit Your Photo on Your Phone</h2>
        <ol>
          ${guide.steps.map((s) => `<li>${esc(s)}</li>`).join('\n          ')}
        </ol>
      </section>

      <section class="card">
        <h2>Common Portal Rejection Causes</h2>
        <ul>
          ${guide.commonRejections.map((r) => `<li>${esc(r)}</li>`).join('\n          ')}
        </ul>
      </section>

      <section class="card">
        <h2>Frequently Asked Questions</h2>
        ${guide.faq
          .map(
            (item) => `<div class="faq-item">
          <strong>${esc(item.q)}</strong>
          <div>${esc(item.a)}</div>
        </div>`,
          )
          .join('\n        ')}
      </section>

      <footer>
        Runs 100% offline in your browser — your photo never leaves your device.
        <a href="/">Launch KiloCrop</a> · <a href="/guides/">All Portal Guides</a>
      </footer>
    </main>
  </body>
</html>
`;
}

function renderDirectoryPage(guides: readonly PortalGuide[], specMap: Map<string, Spec>): string {
  const items = guides
    .map((g) => {
      const s = specMap.get(g.specId);
      const sub = s
        ? `${s.output.width}×${s.output.height} ${s.output.units} · ${formatSizeRule(s)}`
        : '';
      return `<li><a href="/guides/${encodeURIComponent(g.slug)}/"><strong>${esc(g.headline)}</strong><span>${esc(sub)}</span></a></li>`;
    })
    .join('\n        ');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'"
    />
    <meta name="description" content="Verified passport and portal photo requirement guides for Nigeria and major visa portals." />
    <link rel="stylesheet" href="/guides.css" />
    <link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
    <title>Portal Photo Guides — KiloCrop</title>
  </head>
  <body>
    <main>
      <nav class="crumbs"><a href="/">← Open KiloCrop App</a></nav>
      <h1>Portal Photo Guides</h1>
      <p class="lead">Exact pixel, KB, and background rules for verified Nigerian and visa portals. Every guide opens straight into KiloCrop offline.</p>
      <ul class="guide-list">
        ${items}
      </ul>
      <footer>
        Note: NIN (NIMC), FRSC Driver's Licence, JAMB UTME, and school WAEC/NECO use live on-site biometric capture and do not accept digital uploads.
      </footer>
    </main>
  </body>
</html>
`;
}

function main(): void {
  const bundle = JSON.parse(readFileSync(BUNDLE_PATH, 'utf8')) as Spec[];
  const specMap = new Map(bundle.map((s) => [s.id, s]));

  const guidesRoot = join(DIST_DIR, 'guides');
  mkdirSync(guidesRoot, { recursive: true });
  writeFileSync(
    join(guidesRoot, 'index.html'),
    renderDirectoryPage(PORTAL_GUIDES, specMap),
    'utf8',
  );

  const urls = [`${SITE_URL}/`, `${SITE_URL}/guides/`];
  for (const guide of PORTAL_GUIDES) {
    const spec = specMap.get(guide.specId);
    if (!spec) {
      throw new Error(`Guide "${guide.slug}" references missing spec "${guide.specId}"`);
    }
    const dir = join(guidesRoot, guide.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), renderGuidePage(guide, spec), 'utf8');
    urls.push(`${SITE_URL}/guides/${guide.slug}/`);
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}
</urlset>
`;
  writeFileSync(join(DIST_DIR, 'sitemap.xml'), sitemap, 'utf8');

  const robots = `User-agent: *
Allow: /
Sitemap: ${SITE_URL}/sitemap.xml
`;
  writeFileSync(join(DIST_DIR, 'robots.txt'), robots, 'utf8');

  console.log(`Generated ${PORTAL_GUIDES.length} static portal guides + sitemap.xml + robots.txt.`);
}

main();
