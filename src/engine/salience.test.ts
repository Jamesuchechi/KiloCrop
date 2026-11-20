import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { estimateSalientFocalPoint } from './salience';

function makeFlatBuffer(width: number, height: number, val = 128) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
    data[i + 3] = 255;
  }
  return data;
}

describe('salience', () => {
  it('returns centered {0, 0} on uniform flat images', () => {
    const flat = makeFlatBuffer(32, 32, 180);
    expect(estimateSalientFocalPoint(flat, 32, 32)).toEqual({ focalX: 0, focalY: 0 });
  });

  it('shifts focalX/focalY smoothly toward high-contrast subject region', () => {
    const data = makeFlatBuffer(40, 40, 220);
    // Draw sharp dark subject cluster in upper-right quadrant (x: 28..35, y: 6..14)
    for (let y = 6; y <= 14; y++) {
      for (let x = 28; x <= 35; x++) {
        const i = (y * 40 + x) * 4;
        data[i] = 20;
        data[i + 1] = 20;
        data[i + 2] = 20;
      }
    }

    const focal = estimateSalientFocalPoint(data, 40, 40);
    expect(focal.focalX).toBeGreaterThan(0.2);
    expect(focal.focalY).toBeLessThan(-0.2);
  });

  it('property: estimated focal coordinates are always finite and within [-1, 1]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 8, max: 32 }),
        fc.integer({ min: 8, max: 32 }),
        fc.integer({ min: 1, max: 255 }),
        (w, h, seed) => {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < data.length; i += 4) {
            const v = (i * seed) % 256;
            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
            data[i + 3] = 255;
          }
          const res = estimateSalientFocalPoint(data, w, h);
          expect(Number.isFinite(res.focalX)).toBe(true);
          expect(Number.isFinite(res.focalY)).toBe(true);
          expect(res.focalX).toBeGreaterThanOrEqual(-1);
          expect(res.focalX).toBeLessThanOrEqual(1);
          expect(res.focalY).toBeGreaterThanOrEqual(-1);
          expect(res.focalY).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 30 },
    );
  });
});
