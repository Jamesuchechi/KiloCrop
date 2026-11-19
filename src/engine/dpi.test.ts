import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { crc32, padJpegWithCom, readJpegDpi, readPngDpi, setJpegDpi, setPngDpi } from './dpi';

function makeMinimalJpeg(withApp0: boolean): Uint8Array {
  const head = [0xff, 0xd8];
  const app0 = withApp0
    ? [
        0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x60, 0x00,
        0x60, 0x00, 0x00,
      ]
    : [];
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xaa, 0xbb, 0xff, 0xd9];
  return new Uint8Array([...head, ...app0, ...sos]);
}

function makeMinimalPng(): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = new Uint8Array(25);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, 13, false);
  ihdr.set([0x49, 0x48, 0x44, 0x52], 4);
  dv.setUint32(8, 1200, false);
  dv.setUint32(12, 1800, false);
  ihdr[16] = 8;
  ihdr[17] = 2;
  dv.setUint32(21, crc32(ihdr.subarray(4, 21)), false);

  const iend = new Uint8Array(12);
  const idv = new DataView(iend.buffer);
  idv.setUint32(0, 0, false);
  iend.set([0x49, 0x45, 0x4e, 0x44], 4);
  idv.setUint32(8, crc32(iend.subarray(4, 8)), false);

  const out = new Uint8Array(sig.length + ihdr.length + iend.length);
  out.set(sig, 0);
  out.set(ihdr, sig.length);
  out.set(iend, sig.length + ihdr.length);
  return out;
}

describe('dpi & JPEG COM padding', () => {
  it('sets and reads JPEG DPI whether APP0 was originally present or absent', () => {
    const withApp0 = setJpegDpi(makeMinimalJpeg(true), 300);
    expect(readJpegDpi(withApp0)).toEqual({ xDpi: 300, yDpi: 300 });

    const withoutApp0 = setJpegDpi(makeMinimalJpeg(false), 200);
    expect(readJpegDpi(withoutApp0)).toEqual({ xDpi: 200, yDpi: 200 });
  });

  it('inserts and replaces PNG pHYs DPI chunk with valid CRC32', () => {
    const base = makeMinimalPng();
    expect(readPngDpi(base)).toBeNull();

    const p300 = setPngDpi(base, 300);
    expect(readPngDpi(p300)).toEqual({ xDpi: 300, yDpi: 300 });

    const p600 = setPngDpi(p300, 600);
    expect(readPngDpi(p600)).toEqual({ xDpi: 600, yDpi: 600 });
    expect(p600.length).toBe(p300.length);
  });

  it('property: padJpegWithCom matches targetBytes >= len + 4 and preserves SOI/EOI', () => {
    const base = makeMinimalJpeg(true);
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 140000 }), (extra) => {
        const target = base.length + extra;
        const padded = padJpegWithCom(base, target);
        expect(padded.length).toBe(target);
        expect(padded[0]).toBe(0xff);
        expect(padded[1]).toBe(0xd8);
        expect(padded[padded.length - 2]).toBe(0xff);
        expect(padded[padded.length - 1]).toBe(0xd9);
      }),
    );
  });
});
