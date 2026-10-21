import type { MapRegion } from './offlineMaps';
import type { TerrainFeature } from './terrainData';

export interface SkylineView { heading: number; profile: number[]; horizontalFov: number; }
export interface TerrainPackage { region: MapRegion; features: TerrainFeature[]; }
export interface TerrainCandidate { lat: number; lng: number; scoreDegrees: number; confidence: 'weak'|'possible'; uncertaintyMetres: number; region: string; calculatedAt: string; }
export interface TerrainMatch { candidates: TerrainCandidate[]; message: string; }

const DEG_LAT_METRES = 111_320;
const radians = (v: number) => v * Math.PI / 180;
const normalize = (v: number) => ((v % 360) + 360) % 360;
const yieldToUi = () => new Promise<void>(resolve => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
  else setTimeout(resolve, 0);
});

function isSky(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const brightness = (r + g + b) / 3;
  const saturation = max === 0 ? 0 : (max - min) / max;
  return (b > 75 && b > r * 1.04 && b > g * 0.93) || (brightness > 178 && saturation < 0.28);
}

/** Extracts a coarse sky/terrain boundary from a camera frame; fails closed in poor visibility. */
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

interface Raster {
  region: MapRegion;
  originLng: number;
  originLat: number;
  metersPerLng: number;
  cell: number;
  width: number;
  height: number;
  elevation: Float32Array;
  distanceToContour: Uint16Array;
}

function buildRaster(region: MapRegion, features: TerrainFeature[], cell = 100): Raster {
  const [south, west, north, east] = region.bounds;
  const originLat = (south + north) / 2;
  const metersPerLng = DEG_LAT_METRES * Math.cos(radians(originLat));
  const width = Math.ceil((east - west) * metersPerLng / cell) + 1;
  const height = Math.ceil((north - south) * DEG_LAT_METRES / cell) + 1;
  const sums = new Float64Array(width * height);
  const counts = new Uint16Array(width * height);
  const xOf = (lng: number) => (lng - west) * metersPerLng / cell;
  const yOf = (lat: number) => (lat - south) * DEG_LAT_METRES / cell;
  const mark = (x: number, y: number, value: number) => {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= width || iy >= height) return;
    const idx = iy * width + ix;
    sums[idx] += value;
    if (counts[idx] < 65_000) counts[idx]++;
  };
  const sampleStep = Math.max(1, cell / 2);
  for (const feature of features) {
    for (const path of feature.paths) {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        const dx = (b[0] - a[0]) * metersPerLng;
        const dy = (b[1] - a[1]) * DEG_LAT_METRES;
        const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / sampleStep));
        for (let j = 0; j <= steps; j++) {
          const t = j / steps;
          mark(xOf(a[0] + (b[0] - a[0]) * t), yOf(a[1] + (b[1] - a[1]) * t), feature.height);
        }
      }
    }
  }
  const size = width * height;
  const elevation = new Float32Array(size);
  const distanceToContour = new Uint16Array(size);
  distanceToContour.fill(65_535);
  const queue = new Int32Array(size);
  let head = 0, tail = 0;
  for (let i = 0; i < size; i++) {
    if (!counts[i]) continue;
    elevation[i] = sums[i] / counts[i];
    distanceToContour[i] = 0;
    queue[tail++] = i;
  }
  if (!tail) throw new Error(`${region.name}沒有可用等高線`);
  // Multi-source breadth-first interpolation: nearest contour height is used as a coarse
  // terrain estimate. The result is intentionally conservative and never treated as survey-grade.
  while (head < tail) {
    const index = queue[head++];
    const x = index % width, y = Math.floor(index / width);
    const nextDistance = distanceToContour[index] + 1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (distanceToContour[next] <= nextDistance) continue;
      distanceToContour[next] = nextDistance;
      elevation[next] = elevation[index];
      queue[tail++] = next;
    }
  }
  return { region, originLng: west, originLat: south, metersPerLng, cell, width, height, elevation, distanceToContour };
}

function sample(raster: Raster, xMetres: number, yMetres: number): number | null {
  const gx = xMetres / raster.cell, gy = yMetres / raster.cell;
  if (gx < 0 || gy < 0 || gx >= raster.width - 1 || gy >= raster.height - 1) return null;
  const x = Math.floor(gx), y = Math.floor(gy), fx = gx - x, fy = gy - y;
  const i = y * raster.width + x;
  const a = raster.elevation[i] * (1 - fx) + raster.elevation[i + 1] * fx;
  const b = raster.elevation[i + raster.width] * (1 - fx) + raster.elevation[i + raster.width + 1] * fx;
  return a * (1 - fy) + b * fy;
}

function predictedProfile(raster: Raster, x: number, y: number, baseElevation: number, view: SkylineView, bins: number): number[] | null {
  const profile: number[] = [];
  let validBins = 0;
  for (let bin = 0; bin < bins; bin++) {
    const azimuth = radians(normalize(view.heading + ((bin + 0.5) / bins - 0.5) * view.horizontalFov));
    const east = Math.sin(azimuth), north = Math.cos(azimuth);
    let horizon = -5;
    for (let distance = 200; distance <= 12_000; distance += 250) {
      const elevation = sample(raster, x + east * distance, y + north * distance);
      if (elevation == null) continue;
      const angle = Math.atan2(elevation - baseElevation, distance) * 180 / Math.PI;
      if (angle > horizon) horizon = angle;
    }
    if (horizon > -5) validBins++;
    profile.push(horizon);
  }
  if (validBins < bins * 0.65) return null;
  const mean = profile.reduce((sum, value) => sum + value, 0) / bins;
  return profile.map(value => value - mean);
}

export function predictTerrainProfileAt(
  region: MapRegion, features: TerrainFeature[], lat: number, lng: number, heading: number, horizontalFov = 60, bins = 24,
): number[] {
  const raster = buildRaster(region, features);
  const [south, west] = region.bounds;
  const x = (lng - west) * raster.metersPerLng, y = (lat - south) * DEG_LAT_METRES;
  const index = Math.round(y / raster.cell) * raster.width + Math.round(x / raster.cell);
  const baseElevation = raster.elevation[index] + 1.6;
  const profile = predictedProfile(raster, x, y, baseElevation, { heading, horizontalFov, profile: [] }, bins);
  if (!profile) throw new Error('此測試位置的地形覆蓋不足');
  return profile;
}

function rms(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum / a.length);
}

export async function matchTerrainViews(
  views: SkylineView[], packages: TerrainPackage[], onProgress?: (text: string) => void,
): Promise<TerrainMatch> {
  if (views.length < 3) throw new Error('請從至少三個不同方向各拍一張山形畫面，再開始比對。');
  const headings = views.map(view => view.heading).sort((a, b) => a - b);
  const gaps = headings.slice(0, -1).map((heading, i) => headings[i + 1] - heading);
  gaps.push(360 - headings[headings.length - 1] + headings[0]);
  const coveredArc = 360 - Math.max(...gaps);
  if (coveredArc < 25) throw new Error('三個鏡頭方向太接近；請原地轉向不同方向重新拍攝。');
  const bins = views[0].profile.length;
  const calculatedAt = new Date().toISOString();
  const candidates: TerrainCandidate[] = [];
  for (const item of packages) {
    onProgress?.(`正在建立${item.region.name}地形輪廓…`);
    const raster = buildRaster(item.region, item.features);
    const [south, west, north, east] = item.region.bounds;
    const midLat = (south + north) / 2;
    const metersPerLng = DEG_LAT_METRES * Math.cos(radians(midLat));
    const xMax = (east - west) * metersPerLng;
    const yMax = (north - south) * DEG_LAT_METRES;
    const step = 400;
    let rowNumber = 0;
    for (let y = step; y < yMax - step; y += step) {
      rowNumber++;
      for (let x = step; x < xMax - step; x += step) {
        const ix = Math.round(x / raster.cell), iy = Math.round(y / raster.cell);
        const idx = iy * raster.width + ix;
        if (idx < 0 || idx >= raster.elevation.length || raster.distanceToContour[idx] > 12) continue;
        const base = raster.elevation[idx] + 1.6;
        let totalScore = 0, usable = 0;
        for (const view of views) {
          const predicted = predictedProfile(raster, x, y, base, view, bins);
          if (!predicted) continue;
          totalScore += rms(predicted, view.profile);
          usable++;
        }
        if (usable < Math.ceil(views.length * 0.75)) continue;
        const score = totalScore / usable;
        const lat = south + y / DEG_LAT_METRES;
        const lng = west + x / metersPerLng;
        candidates.push({ lat, lng, scoreDegrees: score, confidence: score < 2.5 ? 'possible' : 'weak', uncertaintyMetres: Math.max(1_500, Math.round(score * 750 + step * 0.75)), region: item.region.name, calculatedAt });
      }
      if (rowNumber % 5 === 0) {
        onProgress?.(`正在比對${item.region.name}地形：${Math.min(100, Math.round(y / yMax * 100))}%`);
        await yieldToUi();
      }
    }
  }
  if (!candidates.length) throw new Error('地形資料不足以產生候選位置；請下載觀察方向周邊地區，並在開揚位置重新拍攝。');
  candidates.sort((a, b) => a.scoreDegrees - b.scoreDegrees);
  const distinct: TerrainCandidate[] = [];
  for (const candidate of candidates) {
    if (distinct.some(other => Math.hypot((other.lat - candidate.lat) * DEG_LAT_METRES, (other.lng - candidate.lng) * DEG_LAT_METRES * Math.cos(radians(candidate.lat))) < 600)) continue;
    distinct.push(candidate);
    if (distinct.length >= 5) break;
  }
  const best = distinct[0];
  const plausible = best.scoreDegrees < 2.5 && distinct.length > 1 && distinct[1].scoreDegrees - best.scoreDegrees > 0.35;
  const results = distinct.map(candidate => ({ ...candidate, confidence: plausible && candidate === best ? 'possible' as const : 'weak' as const }));
  return {
    candidates: results,
    message: plausible
      ? '找到一個較吻合的山形候選位置；目前只用20米等高線和粗略鏡頭校準，請用標距柱或 GPS 再核對。'
      : '找到多個可能位置或比對度偏低；結果只供測試，請勿作為求救座標。',
  };
}
