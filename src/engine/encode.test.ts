import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { readJpegDpi } from './dpi';
import { encodeAdaptiveCanvas, encodeToSizeWindow } from './encode';
import type { CanvasLike, EnginePlatform } from './types';

function makeSizedJpeg(totalLen: number, withApp0 = false): Uint8Array<ArrayBuffer> {
  const len = Math.max(24, Math.round(totalLen));
  const out = new Uint8Array(new ArrayBuffer(len));
  out[0] = 0xff;
  out[1] = 0xd8;
  let pos = 2;
  if (withApp0) {
    const app0 = [
      0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x60, 0x00,
      0x60, 0x00, 0x00,
    ];
    out.set(app0, pos);
    pos += app0.length;
  }
  out[pos] = 0xff;
  out[pos + 1] = 0xda; // SOS
  out[pos + 2] = 0x00;
  out[pos + 3] = 0x08;
  out[len - 2] = 0xff;
  out[len - 1] = 0xd9; // EOI
  return out;
}

describe('encodeToSizeWindow', () => {
  it('stays strictly within maxKb even when inserting 18-byte JFIF APP0 DPI header', async () => {
    // Raw JPEG without APP0 is 25,600 bytes at boundary -> +18 bytes would overshoot 25 KB (25,600)
    // unless DPI patching happens inside the binary search evaluation.
    const encoder = async (q: number) => makeSizedJpeg(8000 + q * 22000, false);
    const res = await encodeToSizeWindow(encoder, {
      width: 600,
      height: 600,
      format: 'jpeg',
      minKb: null,
      maxKb: 25,
      dpi: 300,
    });

    expect(res.status).toBe('ok');
    expect(res.bytes).toBeLessThanOrEqual(25 * 1024);
    const outBytes = new Uint8Array(await res.blob.arrayBuffer());
    expect(readJpegDpi(outBytes)).toEqual({ xDpi: 300, yDpi: 300 });
  });

  it('uses COM padding when q=1.0 is still below minKb (e.g. NYSC 7-15 KB)', async () => {
    const encoder = async (q: number) => makeSizedJpeg(3000 + q * 2000, true); // max ~5 KB < 7 KB
    const res = await encodeToSizeWindow(encoder, {
      width: 200,
      height: 200,
      format: 'jpeg',
      minKb: 7,
      maxKb: 15,
      dpi: null,
    });

    expect(res.status).toBe('padded-min');
    expect(res.bytes).toBeGreaterThanOrEqual(7 * 1024);
    expect(res.bytes).toBeLessThanOrEqual(15 * 1024);
    expect(res.paddedBytes).toBeGreaterThan(0);
  });

  it('returns infeasible-max when qualityFloor exceeds maxKb', async () => {
    const encoder = async (q: number) => makeSizedJpeg(30000 + q * 20000, true);
    const res = await encodeToSizeWindow(encoder, {
      width: 600,
      height: 600,
      format: 'jpeg',
      minKb: null,
      maxKb: 25,
      dpi: null,
    });

    expect(res.status).toBe('infeasible-max');
    expect(res.bytes).toBeGreaterThan(25 * 1024);
  });

  it('property: always lands inside [minBytes, maxBytes] when feasible and is deterministic', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 8, max: 100 }),
        fc.integer({ min: 4000, max: 15000 }),
        fc.integer({ min: 15000, max: 80000 }),
        fc.boolean(),
        async (maxKb, baseBytes, spanBytes, noisy) => {
          const minKb = Math.max(4, Math.floor(maxKb * 0.4));
          const encoder = async (q: number) => {
            const wobble = noisy ? Math.round(Math.sin(q * 37) * 200) : 0;
            return makeSizedJpeg(baseBytes + q * spanBytes + wobble, true);
          };

          const opts = {
            width: 600,
            height: 600,
            format: 'jpeg' as const,
            minKb,
            maxKb,
            dpi: 300,
          };

          const r1 = await encodeToSizeWindow(encoder, opts);
          const r2 = await encodeToSizeWindow(encoder, opts);

          expect(r1.bytes).toBe(r2.bytes);
          expect(r1.status).toBe(r2.status);
          expect(r1.quality).toBe(r2.quality);

          if (r1.status === 'ok' || r1.status === 'padded-min') {
            expect(r1.bytes).toBeGreaterThanOrEqual(minKb * 1024);
            expect(r1.bytes).toBeLessThanOrEqual(maxKb * 1024);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('encodeAdaptiveCanvas', () => {
  it('shrinks pixel dimensions 0.9x per step until PNG/large canvas fits maxKb and releases intermediates', async () => {
    const created: CanvasLike[] = [];
    const makeCanvas = (width: number, height: number): CanvasLike => {
      const c: CanvasLike = {
        width,
        height,
        getContext: () => ({
          fillStyle: '#fff',
          strokeStyle: '#000',
          lineWidth: 1,
          font: '12px sans-serif',
          textAlign: 'center',
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
        }),
        async convertToBlob(opts) {
          // Byte size proportional to pixel count so 0.9x shrinking brings it under maxKb
          const areaBytes = Math.max(1200, Math.round((c.width * c.height) / 10));
          return new Blob([makeSizedJpeg(areaBytes, true)], { type: opts?.type ?? 'image/png' });
        },
      };
      created.push(c);
      return c;
    };

    const platform: EnginePlatform = {
      createImageBitmap: vi.fn(),
      createCanvas: makeCanvas,
    };

    const initial = makeCanvas(800, 800); // ~64 KB at 0.1 bytes/px -> shrink to fit <= 40 KB
    const res = await encodeAdaptiveCanvas(
      initial,
      { format: 'png', quality: 0.82, minKb: null, maxKb: 40, dpi: null },
      platform,
    );

    expect(res.shrunkToFitKb).toBe(true);
    expect(res.bytes).toBeLessThanOrEqual(40 * 1024);
    expect(res.width).toBeLessThan(800);
    // Initial canvas must remain untouched for caller cleanup; internal intermediates are released (1x1)
    expect(initial.width).toBe(800);
    for (const c of created.slice(1)) {
      expect(c.width).toBe(1);
      expect(c.height).toBe(1);
    }
  });

  it('detects browser format fallback from WebP to PNG and flattens transparent inputs only for JPEG', async () => {
    const fillRectSpy = vi.fn();
    const makeCanvas = (width: number, height: number): CanvasLike => ({
      width,
      height,
      getContext: () => ({
        fillStyle: '#fff',
        strokeStyle: '#000',
        lineWidth: 1,
        font: '12px sans-serif',
        textAlign: 'center',
        fillRect: fillRectSpy,
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
      }),
      async convertToBlob() {
        return new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
      },
    });
    const platform: EnginePlatform = {
      createImageBitmap: vi.fn(),
      createCanvas: makeCanvas,
    };

    const src = makeCanvas(400, 400);
    const webpAttempt = await encodeAdaptiveCanvas(
      src,
      { format: 'webp', quality: 0.8, minKb: null, maxKb: null, dpi: null },
      platform,
    );
    expect(webpAttempt.requestedFormat).toBe('webp');
    expect(webpAttempt.actualFormat).toBe('png');
    expect(fillRectSpy).not.toHaveBeenCalled();

    await encodeAdaptiveCanvas(
      src,
      { format: 'jpeg', quality: 0.8, minKb: null, maxKb: null, dpi: null },
      platform,
    );
    expect(fillRectSpy).toHaveBeenCalledTimes(1);
  });
});
