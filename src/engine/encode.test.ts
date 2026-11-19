import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { readJpegDpi } from './dpi';
import { encodeToSizeWindow } from './encode';

function makeSizedJpeg(totalLen: number, withApp0 = false): Uint8Array {
  const len = Math.max(24, Math.round(totalLen));
  const out = new Uint8Array(len);
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
