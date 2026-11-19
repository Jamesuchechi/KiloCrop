import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { inspectImageBytes } from './inspect';

function buildJpegFixture(options: {
  progressive?: boolean;
  width?: number;
  height?: number;
  components?: number;
  orientation?: number;
  withGps?: boolean;
  iccLabel?: string;
}): Uint8Array {
  const segs: number[] = [0xff, 0xd8];
  const w = options.width ?? 1200;
  const h = options.height ?? 1600;
  const comp = options.components ?? 3;

  if (options.orientation !== undefined || options.withGps) {
    const entries = options.withGps ? 2 : 1;
    const ifdSize = 2 + entries * 12 + 4;
    const tiffLen = 8 + ifdSize;
    const segLen = 2 + 6 + tiffLen;
    const app1 = new Uint8Array(2 + segLen);
    const dv = new DataView(app1.buffer);
    app1[0] = 0xff;
    app1[1] = 0xe1;
    dv.setUint16(2, segLen, false);
    app1.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4); // Exif\0\0
    const tiff = 10;
    app1[tiff] = 0x49; // II little-endian
    app1[tiff + 1] = 0x49;
    dv.setUint16(tiff + 2, 42, true);
    dv.setUint32(tiff + 4, 8, true);
    const ifd0 = tiff + 8;
    dv.setUint16(ifd0, entries, true);
    // Orientation tag 0x0112
    dv.setUint16(ifd0 + 2, 0x0112, true);
    dv.setUint16(ifd0 + 4, 3, true);
    dv.setUint32(ifd0 + 6, 1, true);
    dv.setUint16(ifd0 + 10, options.orientation ?? 1, true);
    if (options.withGps) {
      dv.setUint16(ifd0 + 14, 0x8825, true);
      dv.setUint16(ifd0 + 16, 4, true);
      dv.setUint32(ifd0 + 18, 1, true);
      dv.setUint32(ifd0 + 22, 128, true);
    }
    segs.push(...app1);
  }

  if (options.iccLabel) {
    const header = [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00, 1, 1];
    const labelBytes = Array.from(options.iccLabel).map((c) => c.charCodeAt(0));
    const segLen = 2 + header.length + labelBytes.length;
    segs.push(0xff, 0xe2, (segLen >> 8) & 0xff, segLen & 0xff, ...header, ...labelBytes);
  }

  // SOF0 (0xC0) or SOF2 (0xC2)
  const sofMarker = options.progressive ? 0xc2 : 0xc0;
  const sofLen = 8 + comp * 3;
  const sof = new Uint8Array(2 + sofLen);
  const sdv = new DataView(sof.buffer);
  sof[0] = 0xff;
  sof[1] = sofMarker;
  sdv.setUint16(2, sofLen, false);
  sof[4] = 8;
  sdv.setUint16(5, h, false);
  sdv.setUint16(7, w, false);
  sof[9] = comp;
  segs.push(...sof, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xff, 0xd9);

  return new Uint8Array(segs);
}

describe('inspectImageBytes', () => {
  it('detects progressive JPEG, sideways EXIF orientation, GPS tag, and Display-P3 ICC', () => {
    const bytes = buildJpegFixture({
      progressive: true,
      width: 4000,
      height: 3000,
      orientation: 6,
      withGps: true,
      iccLabel: 'Apple Display P3 profile',
    });

    const report = inspectImageBytes(bytes, 'IMG_001.jpeg', 3_500_000);
    expect(report.container).toBe('jpeg');
    expect(report.isProgressiveJpeg).toBe(true);
    expect(report.orientation).toBe(6);
    expect(report.hasExif).toBe(true);
    expect(report.hasGpsExif).toBe(true);
    expect(report.iccProfile).toBe('display-p3');
    expect(report.rawDimensions).toEqual({ width: 4000, height: 3000 });
    expect(report.orientedDimensions).toEqual({ width: 3000, height: 4000 });

    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain('progressive-jpeg');
    expect(codes).toContain('exif-orientation');
    expect(codes).toContain('non-srgb-icc');
    expect(codes).toContain('extension-mismatch');
  });

  it('detects renamed WebP pretending to be .jpg', () => {
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    const report = inspectImageBytes(webp, 'passport.jpg');
    expect(report.container).toBe('webp');
    expect(report.issues.map((i) => i.code)).toContain('extension-mismatch');
  });

  it('detects iPhone HEIC container (ftypheic) as blocking with actionable tip', () => {
    const heic = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ]);
    const report = inspectImageBytes(heic, 'IMG_999.HEIC');
    expect(report.container).toBe('heic');
    expect(report.issues[0]?.code).toBe('heic-container');
    expect(report.issues[0]?.severity).toBe('blocking');
  });

  it('detects CMYK 4-channel JPEGs', () => {
    const cmyk = buildJpegFixture({ components: 4 });
    const report = inspectImageBytes(cmyk, 'studio.jpg');
    expect(report.isCmyk).toBe(true);
    expect(report.issues.map((i) => i.code)).toContain('cmyk-color');
  });

  it('flags likely WhatsApp-compressed 1600px EXIF-less JPEGs', () => {
    const wa = buildJpegFixture({ width: 1200, height: 1600 });
    const report = inspectImageBytes(wa, 'WhatsApp Image.jpg', 95_000);
    expect(report.issues.map((i) => i.code)).toContain('whatsapp-compressed');
  });

  it('fuzz: never throws on arbitrary bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 512 }), (buf) => {
        const report = inspectImageBytes(buf, 'fuzz.jpg');
        expect(report.fileBytes).toBe(buf.length);
      }),
    );
  });
});
