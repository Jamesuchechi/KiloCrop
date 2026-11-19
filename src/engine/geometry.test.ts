import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  clampCropRect,
  computeCenteredCrop,
  computePreviewScale,
  mmToPx,
  orientedDimensions,
  pxToMm,
  resolveOutputDimensions,
} from './geometry';
import type { Spec } from './types';

function makeSpec(overrides: Partial<Spec['output']>): Spec {
  return {
    id: 'test',
    schemaVersion: 1,
    title: 'Test',
    region: 'NG',
    status: 'draft',
    output: {
      units: 'px',
      width: 600,
      height: 600,
      dpi: null,
      format: 'jpeg',
      fileSizeKb: { min: null, max: 25 },
      ...overrides,
    },
    provenance: {
      kind: 'pasted-rule',
      sourceUrl: null,
      archiveUrl: null,
      verifiedOn: null,
    },
  };
}

describe('geometry', () => {
  it('converts standard passport mm to expected pixels at 300 DPI', () => {
    expect(mmToPx(35, 300)).toBe(413);
    expect(mmToPx(45, 300)).toBe(531);
    expect(mmToPx(35, 600)).toBe(827);
  });

  it('resolves pixel and mm output specs', () => {
    expect(resolveOutputDimensions(makeSpec({ units: 'px', width: 600, height: 800 }))).toEqual({
      width: 600,
      height: 800,
      dpi: null,
    });
    expect(
      resolveOutputDimensions(makeSpec({ units: 'mm', width: 35, height: 45, dpi: null })),
    ).toEqual({
      width: 413,
      height: 531,
      dpi: 300,
    });
  });

  it('swaps dimensions only for EXIF orientations 5-8', () => {
    for (const o of [1, 2, 3, 4]) {
      expect(orientedDimensions({ width: 4000, height: 3000 }, o)).toEqual({
        width: 4000,
        height: 3000,
      });
    }
    for (const o of [5, 6, 7, 8]) {
      expect(orientedDimensions({ width: 4000, height: 3000 }, o)).toEqual({
        width: 3000,
        height: 4000,
      });
    }
  });

  it('property: mm -> px -> mm round-trip stays within <= 0.5 px', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 5, max: 300, noNaN: true }),
        fc.integer({ min: 72, max: 600 }),
        (mm, dpi) => {
          const px = mmToPx(mm, dpi);
          const roundTripMm = pxToMm(px, dpi);
          const roundTripPx = (roundTripMm / 25.4) * dpi;
          expect(Math.abs(roundTripPx - (mm / 25.4) * dpi)).toBeLessThanOrEqual(0.51);
        },
      ),
    );
  });

  it('property: computeCenteredCrop stays inside bounds and matches aspect ratio', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 12000 }),
        fc.integer({ min: 100, max: 12000 }),
        fc.double({ min: 0.25, max: 4.0, noNaN: true }),
        (w, h, aspect) => {
          const crop = computeCenteredCrop({ width: w, height: h }, aspect);
          expect(crop.x).toBeGreaterThanOrEqual(0);
          expect(crop.y).toBeGreaterThanOrEqual(0);
          expect(crop.x + crop.width).toBeLessThanOrEqual(w + 1e-6);
          expect(crop.y + crop.height).toBeLessThanOrEqual(h + 1e-6);
          expect(Math.abs(crop.width / crop.height - aspect)).toBeLessThan(1e-6);
        },
      ),
    );
  });

  it('property: clampCropRect keeps any rect strictly inside bounds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 8000 }),
        fc.integer({ min: 10, max: 8000 }),
        fc.double({ min: -5000, max: 10000, noNaN: true }),
        fc.double({ min: -5000, max: 10000, noNaN: true }),
        fc.double({ min: -500, max: 10000, noNaN: true }),
        fc.double({ min: -500, max: 10000, noNaN: true }),
        (bw, bh, x, y, rw, rh) => {
          const clamped = clampCropRect({ x, y, width: rw, height: rh }, { width: bw, height: bh });
          expect(clamped.x).toBeGreaterThanOrEqual(0);
          expect(clamped.y).toBeGreaterThanOrEqual(0);
          expect(clamped.width).toBeGreaterThanOrEqual(1);
          expect(clamped.height).toBeGreaterThanOrEqual(1);
          expect(clamped.x + clamped.width).toBeLessThanOrEqual(bw + 1e-6);
          expect(clamped.y + clamped.height).toBeLessThanOrEqual(bh + 1e-6);
        },
      ),
    );
  });

  it('property: computePreviewScale never upscales and caps long edge', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12000 }),
        fc.integer({ min: 1, max: 12000 }),
        fc.integer({ min: 100, max: 3200 }),
        (w, h, cap) => {
          const out = computePreviewScale({ width: w, height: h }, cap);
          expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(cap);
          expect(out.width).toBeLessThanOrEqual(w);
          expect(out.height).toBeLessThanOrEqual(h);
        },
      ),
    );
  });
});
