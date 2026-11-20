import { describe, expect, it } from 'vitest';

import { classifyQuality, computeLumaPsnr } from './quality-score';

function makeGray(width: number, height: number, val: number, alpha = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
    data[i + 3] = alpha;
  }
  return data;
}

describe('quality-score', () => {
  it('returns 60 dB / crisp for identical buffers and ignores alpha=0 pixels', () => {
    const a = makeGray(10, 10, 120);
    const b = makeGray(10, 10, 120);
    // Divergent transparent pixel should not lower PSNR
    a[3] = 0;
    b[0] = 255;
    b[3] = 0;

    const psnr = computeLumaPsnr(a, b, 10, 10);
    expect(psnr).toBe(60);
    expect(classifyQuality(psnr, 'jpeg', 40)).toEqual({
      psnr: 60,
      band: 'crisp',
      suggestWebp: false,
    });
  });

  it('flags heavily degraded JPEG under a maxKb limit and recommends WebP', () => {
    const a = makeGray(16, 16, 40);
    const b = makeGray(16, 16, 85); // large MSE -> ~15 dB PSNR
    const psnr = computeLumaPsnr(a, b, 16, 16);
    expect(psnr).toBeLessThan(28);

    expect(classifyQuality(psnr, 'jpeg', 20)).toEqual({
      psnr,
      band: 'artifacted',
      suggestWebp: true,
    });
    // WebP already active or unbounded -> suggestWebp stays false
    expect(classifyQuality(psnr, 'webp', 20).suggestWebp).toBe(false);
    expect(classifyQuality(psnr, 'jpeg', null).suggestWebp).toBe(false);
  });
});
