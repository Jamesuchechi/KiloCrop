import { describe, expect, it, vi } from 'vitest';

import { cleanDocumentPixels, runDocumentClean } from './document';
import { runInspect } from './pipeline';
import type { BitmapLike, CanvasLike, EnginePlatform } from './types';

function makeShadowedScan(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const t = x / Math.max(1, width - 1);
      // Paper brightness slopes from 130 (shadowed left) to 235 (bright right)
      const paper = Math.round(130 + t * 105);
      data[i] = paper;
      data[i + 1] = paper;
      data[i + 2] = paper;
      data[i + 3] = 255;
    }
  }

  // Paint dark text strokes across both shadowed and bright halves (row 16-24)
  for (let y = Math.floor(height * 0.45); y < Math.floor(height * 0.55); y++) {
    for (let x = 4; x < width - 4; x += 2) {
      const i = (y * width + x) * 4;
      data[i] = 28;
      data[i + 1] = 28;
      data[i + 2] = 28;
    }
  }

  // Paint a red stamp box on the shadowed side (left)
  for (let y = 6; y < 12; y++) {
    for (let x = 6; x < 12; x++) {
      const i = (y * width + x) * 4;
      data[i] = 115;
      data[i + 1] = 35;
      data[i + 2] = 35;
    }
  }

  return data;
}

describe('document cleaner', () => {
  it('levels uneven paper shadow while keeping dark text legible and preserving red ink hue', () => {
    const w = 64;
    const h = 48;
    const colorBuf = makeShadowedScan(w, h);
    const { leveledApplied } = cleanDocumentPixels(colorBuf, w, h, {
      mode: 'color-clean',
      levelStrength: 80,
      whitenPaper: 55,
      sharpenPct: 40,
    });
    expect(leveledApplied).toBe(true);

    // Shadowed left corner paper pixel -> lifted near white (>= 230)
    const leftPaper = (2 * w + 2) * 4;
    expect(colorBuf[leftPaper]).toBeGreaterThanOrEqual(230);

    // Right corner paper pixel -> >= 240
    const rightPaper = (2 * w + (w - 3)) * 4;
    expect(colorBuf[rightPaper]).toBeGreaterThanOrEqual(240);

    // Dark text stroke on shadowed side stays dark (<= 90)
    const strokeIdx = (Math.floor(h * 0.5) * w + 8) * 4;
    expect(colorBuf[strokeIdx]).toBeLessThanOrEqual(90);

    // Red stamp preserves red channel dominance
    const stampIdx = (8 * w + 8) * 4;
    expect(colorBuf[stampIdx]!).toBeGreaterThan(colorBuf[stampIdx + 1]! + 40);
  });

  it('produces uniform RGB in grayscale mode and high-contrast ink/paper in B&W mode', () => {
    const w = 64;
    const h = 48;
    const grayBuf = makeShadowedScan(w, h);
    cleanDocumentPixels(grayBuf, w, h, {
      mode: 'grayscale',
      levelStrength: 75,
      whitenPaper: 50,
      sharpenPct: 25,
    });
    for (let i = 0; i < grayBuf.length; i += 4) {
      expect(grayBuf[i]).toBe(grayBuf[i + 1]);
      expect(grayBuf[i + 1]).toBe(grayBuf[i + 2]);
    }

    const bwBuf = makeShadowedScan(w, h);
    cleanDocumentPixels(bwBuf, w, h, {
      mode: 'bw',
      levelStrength: 80,
      whitenPaper: 55,
      sharpenPct: 30,
    });
    const cornerIdx = (2 * w + 2) * 4;
    expect(bwBuf[cornerIdx]).toBeGreaterThanOrEqual(245);
    const inkIdx = (Math.floor(h * 0.5) * w + 8) * 4;
    expect(bwBuf[inkIdx]).toBeLessThanOrEqual(30);
  });

  it('runs full document clean pipeline and releases scratch canvases', async () => {
    const w = 160;
    const h = 120;
    const buf = makeShadowedScan(w, h);
    const createdCanvases: CanvasLike[] = [];
    const closeSpy = vi.fn();

    const platform: EnginePlatform = {
      async createImageBitmap(): Promise<BitmapLike> {
        return { width: w, height: h, close: closeSpy };
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
              getImageData: () => ({ width, height, data: buf }),
              putImageData: vi.fn(),
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
          async convertToBlob() {
            return new Blob([new Uint8Array(new ArrayBuffer(12_000))], { type: 'image/jpeg' });
          },
        };
        createdCanvases.push(canvas);
        return canvas;
      },
    };

    const rawBytes = new Uint8Array(new ArrayBuffer(24));
    rawBytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const report = await runInspect(new Blob([rawBytes], { type: 'image/jpeg' }), 'scan.jpg');

    const res = await runDocumentClean(
      new Blob([rawBytes], { type: 'image/jpeg' }),
      {
        targetWidth: 160,
        targetHeight: 160,
        mode: 'bw',
        levelStrength: 75,
        whitenPaper: 55,
        sharpenPct: 45,
        format: 'jpeg',
        quality: 0.85,
        maxKb: 100,
      },
      report,
      platform,
    );

    expect(res.width).toBe(160);
    expect(res.height).toBe(120);
    expect(res.leveledApplied).toBe(true);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    for (const c of createdCanvases) {
      expect(c.width).toBe(1);
      expect(c.height).toBe(1);
    }
  });
});
