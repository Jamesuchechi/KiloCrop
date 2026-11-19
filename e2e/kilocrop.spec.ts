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
  // Build minimal APP1 Exif segment: Orientation=6 (0x0112) + GPSInfoIFDPointer (0x8825)
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
  // Orientation = 6
  dv.setUint16(ifd0 + 2, 0x0112, true);
  dv.setUint16(ifd0 + 4, 3, true);
  dv.setUint32(ifd0 + 6, 1, true);
  dv.setUint16(ifd0 + 10, 6, true);
  // GPS pointer
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

test.describe('KiloCrop E2E', () => {
  test('full paste-rule -> crop -> <= 25 KB export -> pipeline stats -> 4x6 print sheet with zero outbound requests', async ({
    page,
  }) => {
    const guard = attachPrivacyAndCspGuards(page);
    await page.goto('/');

    const sampleJpeg = await createSampleExifJpeg(page);

    // Switch to Paste rule / Custom and paste UNILORIN rule
    await page.getByRole('tab', { name: 'Paste rule / Custom' }).click();
    await page
      .getByLabel('Paste portal instruction or error message')
      .fill('UNILORIN: 600x600px, max 25KB');

    await page.locator('input[type="file"]').setInputFiles({
      name: 'IMG_TEST.jpeg',
      mimeType: 'image/jpeg',
      buffer: sampleJpeg,
    });

    // Wait for crop editor bitmap decode, then export
    const fitBtn = page.getByRole('button', { name: 'Fit & Save Photo' });
    await expect(fitBtn).toBeEnabled();
    await fitBtn.click();

    // Verify Binary X-Ray summary & output dimensions/KB
    await expect(page.locator('.xray-card')).toContainText(/Fixed \d+ hidden issue/);
    await expect(page.locator('.result-preview-wrap')).toContainText('600×600 px');
    const kbText = await page.locator('.xray-card .badge-ok').innerText();
    const kb = Number.parseFloat(kbText);
    expect(kb).toBeGreaterThan(0);
    expect(kb).toBeLessThanOrEqual(25);

    // Open quiet footer Pipeline stats drawer and verify 0 B outbound
    await page.getByRole('button', { name: 'Pipeline stats' }).click();
    await expect(page.getByRole('region', { name: 'Pipeline telemetry' })).toContainText('0 B');

    // Make 4x6 Print Sheet (8-up at 300 DPI)
    await page.getByRole('button', { name: 'Make 4×6 Print Sheet' }).click();
    await page.getByRole('button', { name: 'Generate 4X6 Print Sheet' }).click();
    await expect(page.getByAltText('Generated 300 DPI print sheet')).toBeVisible();
    await expect(page.locator('section.card')).toContainText('1200×1800 px (300 DPI PNG)');
    await expect(page.locator('section.card')).toContainText('8 photos');

    await guard.assertClean();
  });

  test('shareable plain-query link sanitizes XSS label and enforces clamped dimensions & KB', async ({
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
      '/?n=%3Cscript%3Ealert(1)%3C%2Fscript%3EUNILAG+Post-UTME&w=300&h=300&max=25&u=px',
    );
    await expect(page.locator('.banner-warn')).toContainText('Shared custom rule');
    await expect(page.locator('.banner-warn')).toContainText('UNILAG Post-UTME');
    expect(dialogs).toEqual([]);

    await page.locator('input[type="file"]').setInputFiles({
      name: 'portrait.jpg',
      mimeType: 'image/jpeg',
      buffer: sampleJpeg,
    });

    const fitBtn = page.getByRole('button', { name: 'Fit & Save Photo' });
    await expect(fitBtn).toBeEnabled();
    await fitBtn.click();

    await expect(page.locator('.result-preview-wrap')).toContainText('300×300 px');
    const kb = Number.parseFloat(await page.locator('.xray-card .badge-ok').innerText());
    expect(kb).toBeLessThanOrEqual(25);

    await guard.assertClean();
  });

  test('airplane mode: offline Service Worker caches app shell and processes NYSC 200x200 (7-15 KB)', async ({
    page,
    context,
  }) => {
    const guard = attachPrivacyAndCspGuards(page);
    await page.goto('/');
    const sampleJpeg = await createSampleExifJpeg(page);

    // Wait for SW install + activation, then reload once so SW controls the client
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    expect(controlled).toBe(true);

    // Flip browser into true offline / airplane mode
    await context.setOffline(true);

    // Navigate offline with deep link ?spec=ng-nysc-portal
    await page.goto('/?spec=ng-nysc-portal');
    await expect(page.locator('.spec-card')).toContainText('NYSC Mobilization Portal');

    await page.locator('input[type="file"]').setInputFiles({
      name: 'nysc-src.jpg',
      mimeType: 'image/jpeg',
      buffer: sampleJpeg,
    });

    const fitBtn = page.getByRole('button', { name: 'Fit & Save Photo' });
    await expect(fitBtn).toBeEnabled();
    await fitBtn.click();

    await expect(page.locator('.result-preview-wrap')).toContainText('200×200 px');
    const kb = Number.parseFloat(await page.locator('.xray-card .badge-ok').innerText());
    expect(kb).toBeGreaterThanOrEqual(7);
    expect(kb).toBeLessThanOrEqual(15);

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
    await expect(page.locator('.spec-card')).toContainText('NYSC Mobilization Portal');

    await guard.assertClean();
  });
});
