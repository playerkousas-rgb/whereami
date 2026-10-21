import { describe, expect, it } from 'vitest';
import type { DtmGrid } from './dtmData';
import { matchDtmViews, predictDtmSkyline } from './dtmMatcher';

describe('5m DTM matcher', () => {
  it('requires three camera views covering sufficiently different directions', async () => {
    const profile=Array.from({length:24},(_,index)=>Math.sin(index/4));
    await expect(matchDtmViews([{heading:10,profile,horizontalFov:60}],[])).rejects.toThrow(/至少三個/);
    await expect(matchDtmViews([
      {heading:10,profile,horizontalFov:60},{heading:11,profile,horizontalFov:60},{heading:12,profile,horizontalFov:60},
    ],[])).rejects.toThrow(/方向太接近/);
  });

  it('searches a synthetic 5m elevation grid and returns ranked candidate coordinates', async () => {
    const width = 800, height = 800, cellSize = 5;
    const xCenter0 = 800_000, northCenter0 = 850_000;
    const values = new Int16Array(width * height);
    const peaks = [
      { x: 1_100, y: 1_100, top: 390, spread: 2_800 },
      { x: 2_800, y: 2_500, top: 520, spread: 3_400 },
      { x: 700, y: 3_100, top: 300, spread: 2_100 },
      { x: 3_200, y: 800, top: 270, spread: 1_700 },
    ];
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      const east = col * cellSize, north = (height - row - 1) * cellSize;
      let elevation = 15;
      for (const peak of peaks) {
        const distance = Math.hypot(east - peak.x, north - peak.y);
        elevation = Math.max(elevation, peak.top - distance * (peak.top - 15) / peak.spread);
      }
      values[row * width + col] = Math.round(elevation * 10);
    }
    const grid: DtmGrid = {
      id: 'dtm-test', name: '合成測試區', importedAt: new Date().toISOString(), width, height, cellSize,
      xCenter0, northCenter0, nodata: -32768, bytes: values.byteLength, complete: true, values,
    };
    const targetEast = xCenter0 + 1_200;
    const targetNorth = northCenter0 - 1_200;
    const views = [0, 120, 240].map(heading => ({
      heading, horizontalFov: 60,
      profile: predictDtmSkyline(grid, targetEast, targetNorth, heading),
    }));
    const result = await matchDtmViews(views, [grid]);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].scoreDegrees).toBeLessThan(0.1);
    expect(result.candidates[0].uncertaintyMetres).toBeGreaterThanOrEqual(1_500);
    expect(result.candidates[0].calculatedAt).toBeTruthy();
  });
});
