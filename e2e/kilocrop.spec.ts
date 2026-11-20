import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

const ALLOWED_ORIGIN = 'http://127.0.0.1:4173';

function attachPrivacyAndCspGuards(page: Page) {
  const outboundRequests: string[] = [];
  const cspViolations: string[] = [];

  page.context().route(
    (url) => {
      const href = url.href;
      return (
        !href.startsWith(ALLOWED_ORIGIN) && !href.startsWith('blob:') && !href.startsWith('data:')
      );
    },
    (route) => {
      outboundRequests.push(route.request().url());
      void route.abort();
    },
  );

  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith(ALLOWED_ORIGIN) && !url.startsWith('blob:') && !url.startsWith('data:')) {
      outboundRequests.push(url);
    }
  });

  void page.addInitScript(() => {
    (window as unknown as { __cspViolations?: string[] }).__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __cspViolations: string[] }).__cspViolations.push(
        `${e.violatedDirective}: ${e.blockedURI}`,
      );
    });
  });

  return {
    async assertClean() {
      const pageViolations = await page.evaluate(
        () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
      );
      cspViolations.push(...pageViolations);
      expect(outboundRequests, 'Zero non-same-origin outbound requests allowed').toEqual([]);
      expect(cspViolations, 'Zero CSP violations allowed').toEqual([]);
    },
  };
}

function injectExifOrientation6AndGps(jpegBytes: Uint8Array): Buffer {
  const entries = 2;
  const ifdSize = 2 + entries * 12 + 4;
  const tiffLen = 8 + ifdSize;
  const segLen = 2 + 6 + tiffLen;
  const app1 = new Uint8Array(2 + segLen);
  const dv = new DataView(app1.buffer);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  dv.setUint16(2, segLen, false);
  app1.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4);
  const tiff = 10;
  app1[tiff] = 0x49;
  app1[tiff + 1] = 0x49;
  dv.setUint16(tiff + 2, 42, true);
  dv.setUint32(tiff + 4, 8, true);
  const ifd0 = tiff + 8;
  dv.setUint16(ifd0, entries, true);
  dv.setUint16(ifd0 + 2, 0x0112, true);
  dv.setUint16(ifd0 + 4, 3, true);
  dv.setUint32(ifd0 + 6, 1, true);
  dv.setUint16(ifd0 + 10, 6, true);
  dv.setUint16(ifd0 + 14, 0x8825, true);
  dv.setUint16(ifd0 + 16, 4, true);
  dv.setUint32(ifd0 + 18, 1, true);
  dv.setUint32(ifd0 + 22, 128, true);

  const out = Buffer.alloc(jpegBytes.length + app1.length);
  out.set(jpegBytes.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(jpegBytes.subarray(2), 2 + app1.length);
  return out;
}

async function createSampleExifJpeg(page: Page): Promise<Buffer> {
  const rawArr = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 900;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 1200, 900);
    grad.addColorStop(0, '#e2e8f0');
    grad.addColorStop(1, '#94a3b8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1200, 900);
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.arc(600, 400, 160, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(420, 580, 360, 320);
    const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.9));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return injectExifOrientation6AndGps(new Uint8Array(rawArr));
}

async function parseSizeKb(page: Page): Promise<number> {
  const txt = await page.locator('#newSize').innerText();
  const num = Number.parseFloat(txt);
  return txt.includes('MB') ? num * 1024 : num;
}

test.describe('KiloCrop E2E', () => {
  test('full studio workflow: sample photo, paste-rule, pad backdrop, placement simulator, saved preset, compare, stats, and /print route', async ({
    page,
  }) => {
    const guard = attachPrivacyAndCspGuards(page);
    await page.goto('/');

    // Try built-in offline sample generator + quick KB chip first
    await page.getByRole('button', { name: 'Try sample photo' }).click();
    await expect(page.locator('#dl')).toBeEnabled();
    await page.getByRole('button', { name: '≤25 KB' }).click();
    await expect(page.locator('#target')).toHaveValue('25');

    // Now reset via Paste rule bar & upload EXIF JPEG fixture
    await page.getByRole('button', { name: 'Paste rule' }).click();
    await page.getByLabel('Paste requirement text').fill('UNILORIN: 600x600px, max 25KB');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('#w')).toHaveValue('600');
    await expect(page.locator('#h')).toHaveValue('600');
    await expect(page.locator('#target')).toHaveValue('25');

    const sampleJpeg = await createSampleExifJpeg(page);
    await page.locator('input#file').setInputFiles({
      name: 'IMG_TEST.jpeg',
      mimeType: 'image/jpeg',
      buffer: sampleJpeg,
    });

    const dlBtn = page.locator('#dl');
    await expect(dlBtn).toBeEnabled();
    await expect(page.locator('#meta')).toContainText('600×600 px, jpg');
    await expect(page.locator('.quality-badge')).toBeVisible();
    const kb = await parseSizeKb(page);
    expect(kb).toBeGreaterThan(0);
    expect(kb).toBeLessThanOrEqual(25);

    // Save custom preset into localStorage
    await page.getByRole('button', { name: 'Save preset' }).click();
    await page.getByLabel('Custom preset name').fill('My Portal 600');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('#preset option:checked')).toContainText('My Portal 600');

    // Switch to Pad segmented button + Dark backdrop swatch + WebP format button & test Placement Simulator
    await page.locator('#w').fill('1200');
    await page.locator('#h').fill('630');
    await page.locator('#fit button[data-fit="pad"]').click();
    await expect(page.locator('#backdrop')).toBeVisible();
    await page.locator('#backdrop button[data-backdrop="dark"]').click();
    await page.locator('#fmt button[data-format="webp"]').click();
    await page.locator('#target').fill('45');
    await expect(dlBtn).toBeEnabled();
    await expect(page.locator('#meta')).toContainText('1200×630 px, webp');

    await page.getByRole('button', { name: 'Preview in context' }).click();
    await expect(page.locator('.sim-frame')).toBeVisible();
    await page.getByLabel('Placement preview context').selectOption('linkedin-banner');
    await expect(page.locator('.sim-li-avatar')).toBeVisible();
    await page.getByRole('button', { name: 'Preview in context' }).click();

    // Hold-to-compare shows Original while pressed
    const cmpBtn = page.locator('#cmp');
    await cmpBtn.dispatchEvent('pointerdown');
    await expect(page.locator('#tag')).toHaveText('Original');
    await cmpBtn.dispatchEvent('pointerup');
    await expect(page.locator('#tag')).toHaveText('Result');

    // Pipeline stats drawer confirms 0 B outbound
    await page.getByRole('button', { name: 'Pipeline stats' }).click();
    await expect(page.getByRole('region', { name: 'Pipeline telemetry' })).toContainText('0 B');

    // Top-nav /print route
    await page.locator('.site-nav').getByRole('link', { name: 'Print Sheet' }).click();
    await expect(page).toHaveURL(/\/print$/);
    await page.getByRole('button', { name: 'Generate 4X6 Print Sheet' }).click();
    await expect(page.getByAltText('Generated 300 DPI print sheet')).toBeVisible();
    await expect(page.locator('section.card')).toContainText('1200×1800 px (300 DPI PNG)');
    await expect(page.locator('section.card')).toContainText('8 photos');

    await page.getByRole('button', { name: '← Back', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#meta')).toContainText('1200×630 px');

    await guard.assertClean();
  });

  test('/inspect route reveals EXIF/GPS metadata, scrubs clean copy, and opens in resizer', async ({
    page,
  }) => {
    const guard = attachPrivacyAndCspGuards(page);
    await page.goto('/inspect');
    const sampleJpeg = await createSampleExifJpeg(page);

    await page.locator('input#file').setInputFiles({
      name: 'vacation-gps.jpeg',
      mimeType: 'image/jpeg',
      buffer: sampleJpeg,
    });

    await expect(page.locator('.inspect-page')).toContainText('GPS IFD present');
    await expect(page.locator('.inspect-page')).toContainText('Sideways EXIF rotation (6)');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Strip metadata & download clean copy' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('vacation-gps-clean.jpg');
    await expect(page.locator('.banner-ok')).toContainText('EXIF, GPS coordinates');

    await page.getByRole('button', { name: /Open in Resize/ }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#dl')).toBeEnabled();

    await guard.assertClean();
  });

  test('shareable recipe query sanitizes XSS label and applies fit=pad & fmt=webp', async ({
    page,
  }) => {
    const guard = attachPrivacyAndCspGuards(page);
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });

    await page.goto('/');
    const sampleJpeg = await createSampleExifJpeg(page);

    await page.goto(
      '/?n=%3Cscript%3Ealert(1)%3C%2Fscript%3EUNILAG+Post-UTME&w=300&h=300&max=25&fit=pad&fmt=webp&u=px',
    );
    await expect(page.locator('.shared-banner')).toContainText('Shared custom rule');
    await expect(page.locator('.shared-banner')).toContainText('UNILAG Post-UTME');
    expect(dialogs).toEqual([]);
    await expect(page.locator('#w')).toHaveValue('300');
    await expect(page.locator('#h')).toHaveValue('300');
    await expect(page.locator('#fit button[data-fit="pad"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.locator('#fmt button[data-format="webp"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.locator('#backdrop')).toBeVisible();

    await page.locator('input#file').setInputFiles({
      name: 'portrait.jpg',
      mimeType: 'image/jpeg',
      buffer: sampleJpeg,
    });

    await expect(page.locator('#dl')).toBeEnabled();
    await expect(page.locator('#meta')).toContainText('300×300 px, webp');
    const kb = await parseSizeKb(page);
    expect(kb).toBeLessThanOrEqual(25);

    await guard.assertClean();
  });

  test('airplane mode offline SW handles /?spec=ng-nysc-portal plus lazy /inspect and /print navigation', async ({
    page,
    context,
  }) => {
    const guard = attachPrivacyAndCspGuards(page);
    await page.goto('/');
    const sampleJpeg = await createSampleExifJpeg(page);

    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    expect(controlled).toBe(true);

    // Offline airplane mode
    await context.setOffline(true);

    await page.goto('/?spec=ng-nysc-portal');
    await expect(page.locator('#preset')).toHaveValue('ng-nysc-portal');

    await page.locator('input#file').setInputFiles({
      name: 'nysc-src.jpg',
      mimeType: 'image/jpeg',
      buffer: sampleJpeg,
    });

    await expect(page.locator('#dl')).toBeEnabled();
    await expect(page.locator('#meta')).toContainText('200×200 px, jpg');
    const kb = await parseSizeKb(page);
    expect(kb).toBeGreaterThanOrEqual(7);
    expect(kb).toBeLessThanOrEqual(15);

    // Offline client-side route transitions for all lazy Phase 1 + Phase 2 chunks
    await page.locator('.site-nav').getByRole('link', { name: 'Batch' }).click();
    await expect(page.locator('h2')).toContainText('Drop 2–50 images here');
    await page.locator('.site-nav').getByRole('link', { name: 'Compare' }).click();
    await expect(page.locator('.compare-card')).toHaveCount(3);
    await page.locator('.site-nav').getByRole('link', { name: 'Documents' }).click();
    await expect(page.locator('#docDl')).toBeEnabled();
    await page.locator('.site-nav').getByRole('link', { name: 'Presets' }).click();
    await expect(page.locator('.preset-card').first()).toBeVisible();
    await page.locator('.site-nav').getByRole('link', { name: 'Web Kit' }).click();
    await expect(page.locator('#webKitZipBtn')).toBeEnabled();
    await page.locator('.site-nav').getByRole('link', { name: 'X-Ray' }).click();
    await expect(page.locator('.inspect-page')).toContainText('Binary Image X-Ray');
    await page.locator('.site-nav').getByRole('link', { name: 'Print Sheet' }).click();
    await expect(page.getByRole('button', { name: 'Generate 4X6 Print Sheet' })).toBeVisible();

    await guard.assertClean();
  });

  test('/batch processes 4 images sequentially and builds a valid stored ZIP archive', async ({
    page,
  }) => {
    const guard = attachPrivacyAndCspGuards(page);
    await page.goto('/batch');

    await page.getByRole('button', { name: 'Try 4 sample photos' }).click();
    await expect(page.locator('.batch-row')).toHaveCount(5); // header + 4 rows

    await page.locator('#batch-maxkb').fill('50');
    await page.getByRole('button', { name: 'Process 4 photos' }).click();
    await expect(page.locator('.batch-pill-done')).toHaveCount(4);

    const zipBtn = page.getByRole('button', { name: 'Download all (.zip)' });
    await expect(zipBtn).toBeEnabled();
    const [download] = await Promise.all([page.waitForEvent('download'), zipBtn.click()]);
    expect(download.suggestedFilename()).toBe('kilocrop-batch-4.zip');

    const zipPath = await download.path();
    expect(zipPath).toBeTruthy();
    const bytes = readFileSync(zipPath!);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdOffset = bytes.byteLength - 22;
    expect(dv.getUint32(eocdOffset, true)).toBe(0x06054b50);
    expect(dv.getUint16(eocdOffset + 10, true)).toBe(4);
    expect(bytes.includes(0x6a)).toBe(true); // .jpg filenames present in central directory

    await guard.assertClean();
  });

  test('/compare benchmarks JPEG, WebP, PNG with synced 2x/4x loupe and transfers to Resize', async ({
    page,
  }) => {
    const guard = attachPrivacyAndCspGuards(page);
    await page.goto('/compare');

    await page.getByRole('button', { name: 'Try sample photo' }).click();
    await expect(page.locator('.compare-card')).toHaveCount(3);
    await expect(page.locator('.loupe-canvas')).toHaveCount(3);
    await expect(page.locator('.compare-card .xray-pill-ok')).toHaveCount(1);

    await page.getByRole('button', { name: '4×' }).click();
    await expect(page.locator('.loupe-head').first()).toContainText('4× Zoom Loupe');

    await page
      .getByRole('button', { name: /Use on Resize/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#dl')).toBeEnabled();

    await guard.assertClean();
  });

  test('/documents levels shadows on synthetic certificate and switches to Clean B&W', async ({
    page,
  }) => {
    const guard = attachPrivacyAndCspGuards(page);
    await page.goto('/documents');

    await page.getByRole('button', { name: 'Try sample document' }).click();
    await expect(page.locator('#docImg')).toBeVisible();
    await expect(page.locator('#docDl')).toBeEnabled();
    const txt = await page.locator('#docNewSize').innerText();
    const kb = Number.parseFloat(txt);
    expect(kb).toBeLessThanOrEqual(150);

    await page.locator('[data-doc-mode="bw"]').click();
    await expect(page.getByText('Ink darkness')).toBeVisible();
    await expect(page.locator('#docDl')).toBeEnabled();

    await guard.assertClean();
  });

  test('/presets searches directory, links portal guide, and opens UNILORIN preset in Resize', async ({
    page,
  }) => {
    const guard = attachPrivacyAndCspGuards(page);
    await page.goto('/presets');

    await page.getByLabel('Search presets').fill('UNILORIN');
    const cards = page.locator('.preset-card');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('UNILORIN');
    await expect(
      cards.first().locator('a[href="/guides/unilorin-post-utme-passport-photo/"]'),
    ).toBeVisible();

    await cards
      .first()
      .getByRole('button', { name: /Use in Resize/ })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#preset')).toHaveValue('ng-unilorin-post-utme');

    await guard.assertClean();
  });

  test('/web-kit builds responsive WebP+JPEG variants, LQIP, <picture> HTML, and valid ZIP kit', async ({
    page,
  }) => {
    const guard = attachPrivacyAndCspGuards(page);
    await page.goto('/web-kit');

    await page.getByRole('button', { name: 'Try sample photo' }).click();
    await expect(page.locator('.webkit-row:not(.batch-head)')).toHaveCount(6);
    await expect(page.locator('.code-block').first()).toContainText('<picture>');
    await expect(page.locator('.code-block').first()).toContainText('type="image/webp"');
    await expect(page.locator('.lqip-preview')).toHaveAttribute('src', /^data:image\//);

    const zipBtn = page.locator('#webKitZipBtn');
    await expect(zipBtn).toBeEnabled();
    const [download] = await Promise.all([page.waitForEvent('download'), zipBtn.click()]);
    expect(download.suggestedFilename()).toBe('studio-sample-portrait-web-kit.zip');

    const zipPath = await download.path();
    expect(zipPath).toBeTruthy();
    const bytes = readFileSync(zipPath!);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdOffset = bytes.byteLength - 22;
    expect(dv.getUint32(eocdOffset, true)).toBe(0x06054b50);
    expect(dv.getUint16(eocdOffset + 10, true)).toBe(8);

    await guard.assertClean();
  });

  test('PWA manifest declares OS handlers and window.launchQueue loads dropped handle into studio', async ({
    page,
  }) => {
    const guard = attachPrivacyAndCspGuards(page);
    await page.goto('/');
    const sampleJpeg = await createSampleExifJpeg(page);

    const manifestRes = await page.request.get('/manifest.webmanifest');
    expect(manifestRes.status()).toBe(200);
    const manifest = (await manifestRes.json()) as {
      file_handlers?: unknown[];
      share_target?: { action?: string };
    };
    expect(manifest.file_handlers?.length).toBeGreaterThan(0);
    expect(manifest.share_target?.action).toBe('/?share-target=1');

    await page.addInitScript(() => {
      let consumerFn: ((params: { files: Array<{ getFile(): Promise<File> }> }) => void) | null =
        null;
      const mockQueue = {
        setConsumer(fn: (params: { files: Array<{ getFile(): Promise<File> }> }) => void) {
          consumerFn = fn;
        },
      };
      try {
        Object.defineProperty(window, 'launchQueue', {
          configurable: true,
          value: mockQueue,
        });
      } catch {
        const existing = (window as unknown as { launchQueue?: typeof mockQueue }).launchQueue;
        if (existing) existing.setConsumer = mockQueue.setConsumer;
      }
      (window as unknown as { __fireLaunch: (bytes: number[]) => void }).__fireLaunch = (
        bytes: number[],
      ) => {
        const u8 = new Uint8Array(bytes);
        const file = new File([u8], 'os-opened-photo.jpg', { type: 'image/jpeg' });
        if (!consumerFn) throw new Error('launchQueue consumer was not registered');
        consumerFn({
          files: [
            {
              async getFile() {
                return file;
              },
            },
          ],
        });
      };
    });

    await page.goto('/?launch=file');
    await page.evaluate((arr) => {
      (window as unknown as { __fireLaunch: (bytes: number[]) => void }).__fireLaunch(arr);
    }, Array.from(sampleJpeg));

    await expect(page.locator('#img')).toBeVisible();
    await expect(page.locator('#dl')).toBeEnabled();

    await guard.assertClean();
  });

  test('static portal guide page passes strict CSP and deep-links into KiloCrop', async ({
    page,
  }) => {
    const guard = attachPrivacyAndCspGuards(page);
    await page.goto('/guides/nysc-passport-photo-size/');
    await expect(page.locator('h1')).toContainText('NYSC Mobilization Passport Photo Size');
    await expect(page.locator('table')).toContainText('200 × 200 px');

    await page.getByRole('link', { name: 'Open in KiloCrop →' }).click();
    await expect(page).toHaveURL(/\/\?spec=ng-nysc-portal/);
    await expect(page.locator('#preset')).toHaveValue('ng-nysc-portal');

    await guard.assertClean();
  });
});
