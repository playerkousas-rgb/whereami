import { describe, expect, it } from 'vitest';
import { extractSkylineProfile } from './terrainMatcher';

function syntheticSkyline(): ImageData {
  const width = 320, height = 180;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const boundary = 72 + Math.round(18 * Math.sin(x / 38));
    const sky = y < boundary;
    const offset = (y * width + x) * 4;
    data[offset] = sky ? 110 : 42;
    data[offset + 1] = sky ? 165 : 82;
    data[offset + 2] = sky ? 225 : 45;
    data[offset + 3] = 255;
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

describe('camera skyline extraction', () => {
  it('extracts a centered, non-flat profile from a clear synthetic ridge', () => {
    const profile = extractSkylineProfile(syntheticSkyline());
    expect(profile).toHaveLength(24);
    expect(profile.every(Number.isFinite)).toBe(true);
    expect(profile.reduce((sum, value) => sum + value, 0) / profile.length).toBeCloseTo(0, 8);
    expect(Math.max(...profile) - Math.min(...profile)).toBeGreaterThan(3);
  });

  it('rejects a frame with no detectable sky/terrain boundary', () => {
    const width = 320, height = 180;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = 40; data[i + 1] = 75; data[i + 2] = 42; data[i + 3] = 255; }
    expect(() => extractSkylineProfile({ data, width, height, colorSpace: 'srgb' } as ImageData)).toThrow(/未能辨認/);
  });
});
