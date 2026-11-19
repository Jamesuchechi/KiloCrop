import { describe, expect, it, vi } from 'vitest';

import { runExport, runInspect } from './pipeline';
import { parsePortalRule } from './rule-parser';
import type { BitmapLike, CanvasLike, EnginePlatform } from './types';

function makeMinimalJpegBytes(bytesLen = 8000): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytesLen));
  out[0] = 0xff;
  out[1] = 0xd8;
  // SOF2 progressive marker at offset 2 (1200x1600)
  out.set([0xff, 0xc2, 0x00, 0x0b, 0x08, 0x06, 0x40, 0x04, 0xb0, 0x03], 2);
  out[15] = 0xff;
  out[16] = 0xda;
  out[17] = 0x00;
  out[18] = 0x08;
  out[bytesLen - 2] = 0xff;
  out[bytesLen - 1] = 0xd9;
  return out;
}

function createPipelineTestPlatform() {
  const closeSpy = vi.fn();
  const createdCanvases: CanvasLike[] = [];

  const platform: EnginePlatform = {
    async createImageBitmap(_src, opts): Promise<BitmapLike> {
      return {
        width: opts?.resizeWidth ?? 1200,
        height: opts?.resizeHeight ?? 1600,
        close: closeSpy,
      };
    },
    createCanvas(width, height): CanvasLike {
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
          };
        },
        async convertToBlob(opts) {
          const q = opts?.quality ?? 0.9;
          const size = Math.round(5000 + q * 35000);
          return new Blob([makeMinimalJpegBytes(size)], { type: 'image/jpeg' });
        },
      };
      createdCanvases.push(canvas);
      return canvas;
    },
  };

  return { platform, closeSpy, createdCanvases };
}

describe('pipeline', () => {
  it('runs inspect -> export, emits stats with fixedIssues, and cleans up canvas/bitmap', async () => {
    const { platform, closeSpy, createdCanvases } = createPipelineTestPlatform();
    const blob = new Blob([new Uint8Array(makeMinimalJpegBytes(12000))], { type: 'image/jpeg' });
    const report = await runInspect(blob, 'photo.jpeg');
    const { spec } = parsePortalRule('600x600px, max 25KB');

    const { result, stats } = await runExport(blob, spec, null, report, platform);

    expect(result.status).toBe('ok');
    expect(result.bytes).toBeLessThanOrEqual(25 * 1024);
    expect(stats.outboundBytes).toBe(0);
    expect(stats.fixedIssues).toContain('Progressive JPEG (SOF2)');
    expect(stats.fixedIssues).toContain('Non-standard .jpeg filename');
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(createdCanvases[0]?.width).toBe(1);
    expect(createdCanvases[0]?.height).toBe(1);
  });

  it('aborts cleanly when AbortSignal is already aborted', async () => {
    const { platform } = createPipelineTestPlatform();
    const controller = new AbortController();
    controller.abort();
    const blob = new Blob([new Uint8Array(makeMinimalJpegBytes(2000))], { type: 'image/jpeg' });

    await expect(runInspect(blob, 'a.jpg', controller.signal)).rejects.toThrow(/aborted/i);

    const report = await runInspect(blob, 'a.jpg');
    const { spec } = parsePortalRule('600x600px, max 25KB');
    await expect(
      runExport(blob, spec, null, report, platform, { signal: controller.signal }),
    ).rejects.toThrow(/aborted/i);
  });
});
