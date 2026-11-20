import { describe, expect, it, vi } from 'vitest';

import { runInspect } from './pipeline';
import type { BitmapLike, CanvasLike, EnginePlatform } from './types';
import {
  buildPictureMarkup,
  bytesToBase64,
  resolveWebKitWidths,
  runWebKitExport,
  sanitizeWebKitStem,
} from './web-kit';

describe('web-kit', () => {
  it('resolves widths monotonically without upscaling past source width', () => {
    expect(resolveWebKitWidths(2400, [1600, 480, 960, 480])).toEqual([480, 960, 1600]);
    expect(resolveWebKitWidths(1200, [480, 960, 1600])).toEqual([480, 960, 1200]);
    expect(resolveWebKitWidths(400, [480, 960, 1600])).toEqual([400]);
  });

  it('encodes binary Uint8Arrays with RFC 4648 base64 accurately', () => {
    expect(bytesToBase64(new TextEncoder().encode('Hello'))).toBe('SGVsbG8=');
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
    expect(bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('/9j/');
  });

  it('sanitizes stems and builds escaped <picture> markup without inline styles', () => {
    expect(sanitizeWebKitStem('My Hero Banner!.PNG')).toBe('my-hero-banner');
    const html = buildPictureMarkup({
      prefix: '/img/assets',
      alt: 'Banner "2026" <script>',
      sizes: '(max-width: 800px) 100vw, 960px',
      webpAssets: [
        {
          filename: 'hero-480w.webp',
          width: 480,
          height: 270,
          format: 'webp',
          mime: 'image/webp',
          bytes: 8000,
          blob: new Blob([]),
        },
      ],
      fallbackAssets: [
        {
          filename: 'hero-480w.jpg',
          width: 480,
          height: 270,
          format: 'jpeg',
          mime: 'image/jpeg',
          bytes: 12000,
          blob: new Blob([]),
        },
      ],
      width: 480,
      height: 270,
    });

    expect(html).toContain('<source type="image/webp" srcset="/img/assets/hero-480w.webp 480w"');
    expect(html).toContain('<img src="/img/assets/hero-480w.jpg"');
    expect(html).toContain('alt="Banner &quot;2026&quot; &lt;script&gt;"');
    expect(html).not.toMatch(/style\s*=/i);
  });

  it('exports responsive variants + LQIP data URI and releases every canvas', async () => {
    const createdCanvases: CanvasLike[] = [];
    const closeSpy = vi.fn();

    const platform: EnginePlatform = {
      async createImageBitmap(): Promise<BitmapLike> {
        return { width: 2000, height: 1000, close: closeSpy };
      },
      createCanvas(width, height): CanvasLike {
        const canvas: CanvasLike = {
          width,
          height,
          getContext() {
            return {
              fillStyle: '#fff',
              strokeStyle: '#000',
              lineWidth: 1,
              font: '12px sans-serif',
              textAlign: 'left',
              fillRect: vi.fn(),
              drawImage: vi.fn(),
              save: vi.fn(),
              restore: vi.fn(),
              translate: vi.fn(),
              rotate: vi.fn(),
              beginPath: vi.fn(),
              moveTo: vi.fn(),
              lineTo: vi.fn(),
              stroke: vi.fn(),
              fillText: vi.fn(),
            };
          },
          async convertToBlob(opts) {
            const type = opts?.type ?? 'image/jpeg';
            return new Blob([new Uint8Array(new ArrayBuffer(2048))], { type });
          },
        };
        createdCanvases.push(canvas);
        return canvas;
      },
    };

    const raw = new Uint8Array(new ArrayBuffer(24));
    raw.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x03, 0xe8, 0x07, 0xd0, 0x03]);
    const report = await runInspect(new Blob([raw], { type: 'image/jpeg' }), 'Hero Shot.JPG');

    const res = await runWebKitExport(
      new Blob([raw], { type: 'image/jpeg' }),
      {
        widths: [480, 960, 1600],
        includeWebp: true,
        includeJpeg: true,
        includeLqip: true,
        quality: 0.82,
        autoContrast: false,
        sharpenPct: 0,
        assetPrefix: '/images/',
        altText: 'Hero cover',
        sizesAttr: '100vw',
        baseName: 'Hero Shot.JPG',
      },
      report,
      platform,
    );

    expect(res.assets.map((a) => a.filename)).toEqual([
      'hero-shot-480w.webp',
      'hero-shot-480w.jpg',
      'hero-shot-960w.webp',
      'hero-shot-960w.jpg',
      'hero-shot-1600w.webp',
      'hero-shot-1600w.jpg',
    ]);
    expect(res.lqipDataUri).toMatch(/^data:image\/webp;base64,/);
    expect(res.lqipWidth).toBe(20);
    expect(res.lqipHeight).toBe(10);
    expect(res.pictureHtml).toContain('hero-shot-1600w.jpg');
    expect(closeSpy).toHaveBeenCalledTimes(1);
    for (const c of createdCanvases) {
      expect(c.width).toBe(1);
      expect(c.height).toBe(1);
    }
  });
});
