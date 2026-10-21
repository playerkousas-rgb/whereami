import { describe, expect, it } from 'vitest';
import { extractSkylineProfile, matchTerrainViews, predictTerrainProfileAt, type TerrainPackage } from './terrainMatcher';
import type { MapRegion } from './offlineMaps';
import type { TerrainFeature } from './terrainData';

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

  it('requires three sufficiently separated, differently oriented camera views', async () => {
    const profile = Array.from({ length: 24 }, (_, index) => Math.sin(index / 4));
    await expect(matchTerrainViews([{ heading: 20, profile, horizontalFov: 60 }], [])).rejects.toThrow(/至少三個/);
    await expect(matchTerrainViews([
      { heading: 10, profile, horizontalFov: 60 },
      { heading: 11, profile, horizontalFov: 60 },
      { heading: 12, profile, horizontalFov: 60 },
    ], [])).rejects.toThrow(/方向太接近/);
  });

  it('runs the terrain search against a synthetic contour package and returns ranked coordinates', async () => {
    const region: MapRegion = { id: 'test', name: '測試區', bounds: [22.30, 114.10, 22.34, 114.14] };
    const features: TerrainFeature[] = [
      { height: 20, paths: [[[114.105, 22.30], [114.105, 22.34]]] },
      { height: 40, paths: [[[114.112, 22.30], [114.112, 22.34]]] },
      { height: 80, paths: [[[114.124, 22.30], [114.124, 22.34]]] },
      { height: 60, paths: [[[114.10, 22.325], [114.14, 22.327]]] },
      { height: 100, paths: [[[114.10, 22.335], [114.14, 22.332]]] },
    ];
    const knownLat = 22.30 + 1_200 / 111_320;
    const knownLng = 114.10 + 1_200 / (111_320 * Math.cos(22.32 * Math.PI / 180));
    const views = [0, 120, 240].map(heading => ({
      heading, horizontalFov: 60,
      profile: predictTerrainProfileAt(region, features, knownLat, knownLng, heading),
    }));
    const result = await matchTerrainViews(views, [{ region, features } as TerrainPackage]);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].lat).toBeGreaterThan(region.bounds[0]);
    expect(result.candidates[0].lng).toBeGreaterThan(region.bounds[1]);
    expect(result.candidates[0].scoreDegrees).toBeLessThan(2.5);
    expect(result.candidates[0].uncertaintyMetres).toBeGreaterThanOrEqual(1_500);
  });
});
