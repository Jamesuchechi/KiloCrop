import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { crc32, readPngDpi } from './dpi';
import { computePrintSheetLayout, renderPrintSheet } from './print-sheet';
import type { BitmapLike, CanvasLike, EnginePlatform } from './types';

function makeMinimalPngBytes(): Uint8Array<ArrayBuffer> {
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

  const out = new Uint8Array(new ArrayBuffer(sig.length + ihdr.length + iend.length));
  out.set(sig, 0);
  out.set(ihdr, sig.length);
  out.set(iend, sig.length + ihdr.length);
  return out;
}

function createSheetTestPlatform() {
  const closeSpy = vi.fn();
  const drawSpy = vi.fn();
  const fillTextSpy = vi.fn();
  const createdCanvases: CanvasLike[] = [];

  const platform: EnginePlatform = {
    async createImageBitmap(): Promise<BitmapLike> {
      return { width: 600, height: 800, close: closeSpy };
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
            textAlign: 'center',
            fillRect: vi.fn(),
            drawImage: drawSpy,
            save: vi.fn(),
            restore: vi.fn(),
            translate: vi.fn(),
            rotate: vi.fn(),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            stroke: vi.fn(),
            fillText: fillTextSpy,
          };
        },
        async convertToBlob() {
          return new Blob([makeMinimalPngBytes()], { type: 'image/png' });
        },
      };
      createdCanvases.push(canvas);
      return canvas;
    },
  };

  return { platform, closeSpy, drawSpy, fillTextSpy, createdCanvases };
}

describe('print-sheet packer', () => {
  it('fits 8 rotated 35x45 mm photos onto a 4x6 in sheet at 300 DPI', () => {
    const layout = computePrintSheetLayout({
      sheetId: '4x6',
      photoWidthMm: 35,
      photoHeightMm: 45,
      dpi: 300,
    });

    expect(layout.sheetWidthPx).toBe(1200);
    expect(layout.sheetHeightPx).toBe(1800);
    expect(layout.rotated).toBe(true);
    expect(layout.cols).toBe(2);
    expect(layout.rows).toBe(4);
    expect(layout.capacity).toBe(8);
    expect(layout.slots).toHaveLength(8);
  });

  it('renders single-photo sheet, stamps 300 DPI pHYs, and releases memory', async () => {
    const { platform, closeSpy, drawSpy, createdCanvases } = createSheetTestPlatform();
    const layout = computePrintSheetLayout({
      sheetId: '4x6',
      photoWidthMm: 35,
      photoHeightMm: 45,
    });
    const dummyBlob = new Blob([makeMinimalPngBytes()], { type: 'image/png' });

    const res = await renderPrintSheet(layout, [{ blob: dummyBlob }], platform, {
      mode: 'single',
      copies: 8,
    });

    expect(res.count).toBe(8);
    expect(res.dpi).toBe(300);
    expect(drawSpy).toHaveBeenCalledTimes(8);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(createdCanvases[0]?.width).toBe(1);
    expect(createdCanvases[0]?.height).toBe(1);
    const pngBytes = new Uint8Array(await res.blob.arrayBuffer());
    expect(readPngDpi(pngBytes)).toEqual({ xDpi: 300, yDpi: 300 });
  });

  it('renders multi-photo Cafe mode decoding and closing one photo at a time', async () => {
    const { platform, closeSpy, drawSpy, fillTextSpy } = createSheetTestPlatform();
    const layout = computePrintSheetLayout({
      sheetId: '4x6',
      photoWidthMm: 35,
      photoHeightMm: 45,
    });
    const dummyBlob = new Blob([makeMinimalPngBytes()], { type: 'image/png' });

    const res = await renderPrintSheet(
      layout,
      [
        { blob: dummyBlob, label: 'Amina' },
        { blob: dummyBlob, label: 'Chidi' },
        { blob: dummyBlob, label: 'Tunde' },
      ],
      platform,
      { mode: 'multi' },
    );

    expect(res.count).toBe(3);
    expect(drawSpy).toHaveBeenCalledTimes(3);
    expect(closeSpy).toHaveBeenCalledTimes(3);
    expect(fillTextSpy).toHaveBeenCalledTimes(3);
  });

  it('property: slots never overlap, stay within printable margins, and maximize count', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('4x6' as const, '5x7' as const, 'a4' as const),
        fc.integer({ min: 20, max: 70 }),
        fc.integer({ min: 20, max: 70 }),
        (sheetId, pw, ph) => {
          const layout = computePrintSheetLayout({
            sheetId,
            photoWidthMm: pw,
            photoHeightMm: ph,
            dpi: 300,
          });

          for (let i = 0; i < layout.slots.length; i++) {
            const a = layout.slots[i]!;
            expect(a.x).toBeGreaterThanOrEqual(layout.marginPx);
            expect(a.y).toBeGreaterThanOrEqual(layout.marginPx);
            expect(a.x + a.width).toBeLessThanOrEqual(layout.sheetWidthPx - layout.marginPx);
            expect(a.y + a.height).toBeLessThanOrEqual(layout.sheetHeightPx - layout.marginPx);

            for (let j = i + 1; j < layout.slots.length; j++) {
              const b = layout.slots[j]!;
              const disjoint =
                a.x + a.width <= b.x ||
                b.x + b.width <= a.x ||
                a.y + a.height <= b.y ||
                b.y + b.height <= a.y;
              expect(disjoint).toBe(true);
            }
          }
        },
      ),
    );
  });
});
