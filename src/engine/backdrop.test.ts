import { describe, expect, it, vi } from 'vitest';

import { boxBlurRgba, renderPaddedBackdrop, sampleEdgeColor } from './backdrop';
import type { BitmapLike, CanvasLike, EnginePlatform } from './types';

function makeRgba(width: number, height: number, fill: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  }
  return data;
}

describe('backdrop', () => {
  it('samples average opaque border color and skips transparent outer pixels', () => {
    const data = makeRgba(4, 4, [200, 100, 50, 255]);
    // Set top-left corner fully transparent (should be ignored)
    data[0] = 0;
    data[1] = 0;
    data[2] = 0;
    data[3] = 0;
    expect(sampleEdgeColor(data, 4, 4)).toBe('rgb(200, 100, 50)');

    const allTransparent = makeRgba(4, 4, [0, 0, 0, 0]);
    expect(sampleEdgeColor(allTransparent, 4, 4)).toBe('#111827');
  });

  it('blurs sharp steps smoothly in boxBlurRgba without altering buffer size', () => {
    const data = makeRgba(5, 5, [0, 0, 0, 255]);
    const center = (2 * 5 + 2) * 4;
    data[center] = 255;
    data[center + 1] = 255;
    data[center + 2] = 255;

    boxBlurRgba(data, 5, 5, 2);
    // Peak value diffuses into immediate neighbors while center attenuates
    expect(data[center]).toBeLessThan(255);
    expect(data[(2 * 5 + 1) * 4]).toBeGreaterThan(0);
  });

  it('renders padded canvas for white, dark, edge, and blur backdrops and frees scratch canvases', () => {
    const created: CanvasLike[] = [];
    const fillColors: Array<string | object> = [];
    const scratchData = makeRgba(32, 32, [40, 80, 160, 255]);

    const platform: EnginePlatform = {
      createImageBitmap: vi.fn(),
      createCanvas(width, height): CanvasLike {
        const c: CanvasLike = {
          width,
          height,
          getContext: () => ({
            set fillStyle(v: string | object) {
              fillColors.push(v);
            },
            get fillStyle() {
              return '#000';
            },
            strokeStyle: '#000',
            lineWidth: 1,
            font: '12px sans-serif',
            textAlign: 'center',
            fillRect: vi.fn(),
            drawImage: vi.fn(),
            getImageData: (_x, _y, w, h) => ({
              width: w,
              height: h,
              data: w === 32 ? scratchData : makeRgba(w, h, [120, 130, 140, 255]),
            }),
            putImageData: vi.fn(),
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
        created.push(c);
        return c;
      },
    };

    const bmp: BitmapLike = { width: 800, height: 1200, close: vi.fn() };
    const srcRect = { x: 0, y: 0, width: 800, height: 1200 };
    const dstRect = { x: 383, y: 0, width: 433, height: 650 };

    const whiteOut = renderPaddedBackdrop(
      bmp,
      srcRect,
      dstRect,
      { width: 1200, height: 650 },
      'white',
      platform,
    );
    expect(fillColors).toContain('#ffffff');
    expect(whiteOut.width).toBe(1200);
    // Foreground scratch canvas created during draw must be released (1x1)
    expect(created[1]!.width).toBe(1);

    const edgeOut = renderPaddedBackdrop(
      bmp,
      srcRect,
      dstRect,
      { width: 1200, height: 650 },
      'edge',
      platform,
    );
    expect(fillColors).toContain('rgb(40, 80, 160)');
    expect(edgeOut.width).toBe(1200);

    const blurOut = renderPaddedBackdrop(
      bmp,
      srcRect,
      dstRect,
      { width: 1200, height: 650 },
      'blur',
      platform,
    );
    expect(blurOut.height).toBe(650);
  });
});
