import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { applyAutoContrast, applySharpen, enhanceCanvas } from './enhance';
import type { CanvasLike } from './types';

function makeSolidBuffer(width: number, height: number, r: number, g: number, b: number, a = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return data;
}

describe('enhance', () => {
  it('stretches dull narrow-range RGB pixels while preserving alpha', () => {
    const data = new Uint8ClampedArray(20 * 10 * 4);
    for (let i = 0; i < data.length; i += 4) {
      const idx = i / 4;
      const v = idx % 2 === 0 ? 80 : 160;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = idx < 4 ? 0 : 255; // transparent corner pixels ignored
    }
    data[0] = 0;
    data[1] = 0;
    data[2] = 0;
    data[3] = 0; // should NOT pin histogram lo=0 because alpha=0

    const applied = applyAutoContrast(data, 20, 10);
    expect(applied).toBe(true);
    // Pixel 4 had v=80 -> stretches near 0; pixel 5 had v=160 -> stretches near 255
    expect(data[4 * 4]).toBe(0);
    expect(data[5 * 4]).toBe(255);
    expect(data[3]).toBe(0);
  });

  it('skips flat or already high-contrast images', () => {
    const flat = makeSolidBuffer(8, 8, 120, 120, 120);
    expect(applyAutoContrast(flat, 8, 8)).toBe(false);

    const wide = makeSolidBuffer(10, 10, 0, 0, 0);
    for (let i = 0; i < wide.length / 2; i += 4) {
      wide[i] = 255;
      wide[i + 1] = 255;
      wide[i + 2] = 255;
    }
    expect(applyAutoContrast(wide, 10, 10)).toBe(false);
  });

  it('increases edge contrast on sharpen while leaving flat interior & transparent borders clean', () => {
    const data = makeSolidBuffer(5, 5, 100, 100, 100, 255);
    // Make center column bright (200)
    for (let y = 0; y < 5; y++) {
      const i = (y * 5 + 2) * 4;
      data[i] = 200;
      data[i + 1] = 200;
      data[i + 2] = 200;
    }
    // Make top-left neighbor transparent (0,0) -> (1,1) borders alpha=0 so skipped
    data[3] = 0;
    data[1 * 4 + 3] = 0;

    const applied = applySharpen(data, 5, 5, 50);
    expect(applied).toBe(true);
    // Interior bright edge (x=2, y=2) gets boosted > 200
    const center = (2 * 5 + 2) * 4;
    expect(data[center]).toBeGreaterThan(200);
    // Adjacent dark side (x=1, y=2) gets pulled < 100
    const left = (2 * 5 + 1) * 4;
    expect(data[left]).toBeLessThan(100);
    // Neighbor of transparent pixel (x=1, y=1) was protected against dark halos
    const nearAlpha = (1 * 5 + 1) * 4;
    expect(data[nearAlpha]).toBe(100);
  });

  it('property: enhance skips getImageData when disabled and preserves alpha everywhere', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 16 }),
        fc.integer({ min: 4, max: 16 }),
        fc.integer({ min: 0, max: 100 }),
        fc.boolean(),
        (w, h, sharp, auto) => {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < data.length; i += 4) {
            data[i] = ((i * 13) % 180) + 30;
            data[i + 1] = ((i * 7) % 180) + 30;
            data[i + 2] = ((i * 17) % 180) + 30;
            data[i + 3] = i % 16 === 0 ? 0 : 255;
          }
          const origAlpha = Array.from({ length: w * h }, (_, idx) => data[idx * 4 + 3]);

          const getImageDataSpy = vi.fn(() => ({ width: w, height: h, data }));
          const putImageDataSpy = vi.fn();
          const canvas: CanvasLike = {
            width: w,
            height: h,
            getContext: () => ({
              fillStyle: '#000',
              strokeStyle: '#000',
              lineWidth: 1,
              font: '12px sans-serif',
              textAlign: 'center',
              fillRect: vi.fn(),
              drawImage: vi.fn(),
              getImageData: getImageDataSpy,
              putImageData: putImageDataSpy,
              save: vi.fn(),
              restore: vi.fn(),
              translate: vi.fn(),
              rotate: vi.fn(),
              beginPath: vi.fn(),
              moveTo: vi.fn(),
              lineTo: vi.fn(),
              stroke: vi.fn(),
              fillText: vi.fn(),
            }),
          };

          const off = enhanceCanvas(canvas, { autoContrast: false, sharpenPct: 0 });
          expect(off).toEqual({ contrastApplied: false, sharpenApplied: false });
          expect(getImageDataSpy).not.toHaveBeenCalled();

          enhanceCanvas(canvas, { autoContrast: auto, sharpenPct: sharp });
          const nextAlpha = Array.from({ length: w * h }, (_, idx) => data[idx * 4 + 3]);
          expect(nextAlpha).toEqual(origAlpha);
        },
      ),
      { numRuns: 25 },
    );
  });
});
