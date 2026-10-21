export interface SkylineView { heading: number; profile: number[]; horizontalFov: number; }
export interface TerrainCandidate { lat: number; lng: number; scoreDegrees: number; confidence: 'weak'|'possible'; uncertaintyMetres: number; region: string; calculatedAt: string; }
export interface TerrainMatch { candidates: TerrainCandidate[]; message: string; }

function isSky(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const brightness = (r + g + b) / 3;
  const saturation = max === 0 ? 0 : (max - min) / max;
  return (b > 75 && b > r * 1.04 && b > g * 0.93) || (brightness > 178 && saturation < 0.28);
}

/** Extract a coarse sky/terrain boundary from a camera frame; fails closed in poor visibility. */
export function extractSkylineProfile(image: ImageData, bins = 24, verticalFov = 45): number[] {
  const { data, width, height } = image;
  const values: number[] = [];
  for (let bin = 0; bin < bins; bin++) {
    const x = Math.min(width - 1, Math.floor((bin + 0.5) * width / bins));
    let sawSky = false;
    let boundary = -1;
    let nonSkyRun = 0;
    for (let y = Math.floor(height * 0.04); y < Math.floor(height * 0.92); y++) {
      let skyVotes = 0;
      for (let dx = -2; dx <= 2; dx++) {
        const sx = Math.max(0, Math.min(width - 1, x + dx));
        const offset = (y * width + sx) * 4;
        if (isSky(data[offset], data[offset + 1], data[offset + 2])) skyVotes++;
      }
      if (skyVotes >= 3) { sawSky = true; nonSkyRun = 0; }
      else if (sawSky) {
        nonSkyRun++;
        if (nonSkyRun >= 3) { boundary = y - 2; break; }
      }
    }
    if (boundary < 0) values.push(Number.NaN);
    else values.push((0.5 - boundary / height) * verticalFov);
  }
  const valid = values.filter(Number.isFinite);
  if (valid.length < bins * 0.72) throw new Error('未能辨認足夠山脊輪廓；請移到視野較開揚、天空與山線較清楚的位置再拍攝。');
  const fill = values.map((value, i) => {
    if (Number.isFinite(value)) return value;
    const nearest = values.map((v, j) => ({ v, d: Math.abs(i - j) })).filter(x => Number.isFinite(x.v)).sort((a, b) => a.d - b.d)[0];
    return nearest?.v ?? 0;
  });
  const smooth = fill.map((_, i) => {
    const window = [fill[Math.max(0, i - 1)], fill[i], fill[Math.min(bins - 1, i + 1)]].sort((a, b) => a - b);
    return window[1];
  });
  const mean = smooth.reduce((sum, value) => sum + value, 0) / bins;
  return smooth.map(value => value - mean);
}
