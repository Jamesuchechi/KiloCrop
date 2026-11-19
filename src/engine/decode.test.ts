import { describe, expect, it, vi } from 'vitest';

import {
  MAX_INPUT_BYTES,
  assertInputSafe,
  decodePreview,
  extractCroppedCanvas,
  releaseCanvas,
} from './decode';
import type { BitmapLike, CanvasLike, EnginePlatform } from './types';

function createFakePlatform(
  options: {
    bmpWidth?: number;
    bmpHeight?: number;
    throwOnDraw?: boolean;
  } = {},
) {
  const closeSpy = vi.fn();
  const drawSpy = vi.fn(() => {
    if (options.throwOnDraw) throw new Error('Simulated GPU draw failure');
  });
  const createBitmapSpy = vi.fn(
    async (
      _src: Blob,
      opts?: { resizeWidth?: number; resizeHeight?: number },
    ): Promise<BitmapLike> => ({
      width: options.bmpWidth ?? opts?.resizeWidth ?? 1600,
      height: options.bmpHeight ?? opts?.resizeHeight ?? 1200,
      close: closeSpy,
    }),
  );
  const createCroppedSpy = vi.fn(
    async (
      _src: Blob,
      _sx: number,
      _sy: number,
      _sw: number,
      _sh: number,
      opts?: { resizeWidth?: number; resizeHeight?: number },
    ): Promise<BitmapLike> => ({
      width: opts?.resizeWidth ?? 600,
      height: opts?.resizeHeight ?? 600,
      close: closeSpy,
    }),
  );
  const createdCanvases: CanvasLike[] = [];

  const platform: EnginePlatform = {
    createImageBitmap: createBitmapSpy,
    createCroppedImageBitmap: createCroppedSpy,
    createCanvas(width: number, height: number): CanvasLike {
      const canvas: CanvasLike = {
        width,
        height,
        getContext() {
          return {
            fillStyle: '#000',
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
            fillText: vi.fn(),
          };
        },
      };
      createdCanvases.push(canvas);
      return canvas;
    },
  };

  return { platform, closeSpy, drawSpy, createBitmapSpy, createCroppedSpy, createdCanvases };
}

describe('decode', () => {
  it('enforces input byte safety limits', () => {
    expect(() => assertInputSafe(0)).toThrow(RangeError);
    expect(() => assertInputSafe(MAX_INPUT_BYTES + 1)).toThrow(RangeError);
    expect(() => assertInputSafe(4 * 1024 * 1024)).not.toThrow();
  });

  it('caps preview decode at 1600 px on the oriented long edge (portrait EXIF orientation 6)', async () => {
    const { platform, createBitmapSpy } = createFakePlatform();
    const blob = new Blob([new Uint8Array(1024)], { type: 'image/jpeg' });
    // Raw 8000x6000 rotated by EXIF orientation 6 -> oriented 6000x8000 (portrait)
    await decodePreview(blob, { width: 8000, height: 6000 }, 6, platform);

    expect(createBitmapSpy).toHaveBeenCalledWith(blob, {
      imageOrientation: 'from-image',
      resizeWidth: 1200,
      resizeHeight: 1600,
    });
  });

  it('rejects output dimensions over 16 MP safe canvas limit', async () => {
    const { platform } = createFakePlatform();
    const blob = new Blob([new Uint8Array(512)], { type: 'image/jpeg' });

    await expect(
      extractCroppedCanvas(
        blob,
        { x: 0, y: 0, width: 5000, height: 5000 },
        { width: 5000, height: 5000 },
        { width: 4500, height: 4000 },
        platform,
      ),
    ).rejects.toThrow(RangeError);
  });

  it('closes bitmap and resets canvas even when drawImage throws', async () => {
    const { platform, closeSpy, createdCanvases } = createFakePlatform({ throwOnDraw: true });
    const blob = new Blob([new Uint8Array(512)], { type: 'image/jpeg' });

    await expect(
      extractCroppedCanvas(
        blob,
        { x: 100, y: 100, width: 1000, height: 1000 },
        { width: 4000, height: 3000 },
        { width: 600, height: 600 },
        platform,
      ),
    ).rejects.toThrow('Simulated GPU draw failure');

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(createdCanvases[0]?.width).toBe(1);
    expect(createdCanvases[0]?.height).toBe(1);
  });

  it('scales crop proportionally on default capped intermediate decode and closes bitmap', async () => {
    // Oriented 6000x8000 -> intermediate decode scales to 2400x3200 (0.4x)
    const { platform, closeSpy, drawSpy } = createFakePlatform({ bmpWidth: 2400, bmpHeight: 3200 });
    const blob = new Blob([new Uint8Array(2048)], { type: 'image/jpeg' });

    const canvas = await extractCroppedCanvas(
      blob,
      { x: 1000, y: 2000, width: 3000, height: 3000 },
      { width: 6000, height: 8000 },
      { width: 600, height: 600 },
      platform,
    );

    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(600);
    expect(drawSpy).toHaveBeenCalledWith(expect.anything(), 400, 800, 1200, 1200, 0, 0, 600, 600);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    releaseCanvas(canvas);
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
  });

  it('supports opt-in crop-at-decode path when enabled', async () => {
    const { platform, closeSpy, createCroppedSpy } = createFakePlatform();
    const blob = new Blob([new Uint8Array(2048)], { type: 'image/jpeg' });

    await extractCroppedCanvas(
      blob,
      { x: 500, y: 500, width: 2000, height: 2000 },
      { width: 4000, height: 3000 },
      { width: 600, height: 600 },
      platform,
      { useCropAtDecode: true },
    );

    expect(createCroppedSpy).toHaveBeenCalledWith(blob, 500, 500, 2000, 2000, {
      imageOrientation: 'from-image',
      resizeWidth: 600,
      resizeHeight: 600,
    });
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
