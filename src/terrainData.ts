import type { MapRegion } from './offlineMaps';

const DB_NAME = 'whereami-data';
const STORE = 'datasets';
const TERRAIN_SOURCE = 'https://services3.arcgis.com/6j1KwZfY2fZrfNMR/arcgis/rest/services/ELEVLINE/FeatureServer/4/query';
const PAGE_SIZE = 500;
const OFFSET_KEY = (id: string, offset: number) => `terrain:${id}:page:${offset}`;
const META_KEY = (id: string) => `terrain:${id}:meta`;

export interface TerrainFeature { height: number; paths: number[][][]; }
export interface TerrainInstall { id: string; name: string; downloadedAt: string; featureCount: number; complete: boolean; }
interface ArcFeature { attributes?: { HEIGHT?: unknown }; geometry?: { paths?: unknown }; }
interface ArcResponse { features?: ArcFeature[]; count?: number; exceededTransferLimit?: boolean; error?: { message?: string; details?: string[] }; }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function storeValue(key: string, value: unknown): Promise<void> {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('地形資料儲存中斷'));
  }));
}
function readValue<T>(key: string): Promise<T | undefined> {
  return openDb().then(db => new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  }));
}
function removeKeys(prefix: string): Promise<void> {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const request = store.openKeyCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (String(cursor.key).startsWith(prefix)) store.delete(cursor.key);
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function urlFor(region: MapRegion, offset: number, countOnly = false): string {
  const [south, west, north, east] = region.bounds;
  const geometry = { xmin: west, ymin: south, xmax: east, ymax: north, spatialReference: { wkid: 4326 } };
  const params = new URLSearchParams({
    where: '1=1', geometry: JSON.stringify(geometry), geometryType: 'esriGeometryEnvelope', inSR: '4326',
    outSR: '4326', outFields: 'HEIGHT', returnGeometry: countOnly ? 'false' : 'true',
    resultOffset: String(offset), resultRecordCount: String(PAGE_SIZE), f: 'json',
  });
  if (countOnly) params.set('returnCountOnly', 'true');
  else params.set('maxAllowableOffset', '0.00004');
  return `${TERRAIN_SOURCE}?${params}`;
}

function jsonp(url: string, signal?: AbortSignal): Promise<ArcResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('下載已取消', 'AbortError')); return; }
    const callback = `__whereamiTerrain${Date.now()}${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    let timer = 0;
    const cleanup = () => {
      window.clearTimeout(timer);
      script.remove();
      delete (window as unknown as Record<string, unknown>)[callback];
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => { cleanup(); reject(new DOMException('下載已取消', 'AbortError')); };
    (window as unknown as Record<string, unknown>)[callback] = (data: ArcResponse) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error('地形服務連線失敗（CORS／JSONP）')); };
    timer = window.setTimeout(() => { cleanup(); reject(new Error('地形服務逾時')); }, 30_000);
    signal?.addEventListener('abort', abort, { once: true });
    script.src = `${url}&callback=${callback}`;
    script.async = true;
    document.head.appendChild(script);
  });
}

async function fetchArcGIS(url: string, signal?: AbortSignal): Promise<ArcResponse> {
  if (signal?.aborted) throw new DOMException('下載已取消', 'AbortError');
  let data: ArcResponse;
  try {
    const response = await fetch(url, { signal, mode: 'cors', credentials: 'omit' });
    if (!response.ok) throw new Error(`地形服務 HTTP ${response.status}`);
    data = await response.json() as ArcResponse;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    data = await jsonp(url, signal);
  }
  if (data.error) throw new Error(data.error.message || data.error.details?.join('；') || '地形服務回傳錯誤');
  return data;
}

function validFeatures(response: ArcResponse): TerrainFeature[] {
  return (response.features || []).flatMap(feature => {
    const height = Number(feature.attributes?.HEIGHT);
    const rawPaths = feature.geometry?.paths;
    if (!Number.isFinite(height) || !Array.isArray(rawPaths)) return [];
    const paths = rawPaths.filter((path): path is number[][] => Array.isArray(path) && path.length > 1 && path.every(point => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))).map(path => path.map(point => [Number(point[0]), Number(point[1])]));
    return paths.length ? [{ height, paths }] : [];
  });
}

export async function terrainInstalls(): Promise<TerrainInstall[]> {
  const db = await openDb();
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const installs: TerrainInstall[] = [];
  for (const key of keys.map(String).filter(key => key.startsWith('terrain:') && key.endsWith(':meta'))) {
    const meta = await readValue<TerrainInstall>(key);
    if (meta) installs.push(meta);
  }
  return installs;
}

export async function downloadTerrainRegion(region: MapRegion, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<TerrainInstall> {
  const countResponse = await fetchArcGIS(urlFor(region, 0, true), signal);
  const total = Number(countResponse.count);
  if (!Number.isFinite(total) || total <= 0) throw new Error('官方等高線服務沒有回傳此區資料');
  if (total > 80_000) throw new Error(`此區等高線資料量過大（${total.toLocaleString()} 段），請改選較小地區`);
  let done = 0;
  const pages = Math.ceil(total / PAGE_SIZE);
  for (let page = 0; page < pages; page++) {
    if (signal?.aborted) throw new DOMException('下載已取消', 'AbortError');
    const offset = page * PAGE_SIZE;
    const existing = await readValue<TerrainFeature[]>(OFFSET_KEY(region.id, offset));
    if (existing?.length) { done += existing.length; onProgress(done, total); continue; }
    const response = await fetchArcGIS(urlFor(region, offset), signal);
    const rawCount = response.features?.length || 0;
    const features = validFeatures(response);
    if (rawCount === 0 || features.length !== rawCount) throw new Error(`地形資料第 ${page + 1} 頁有缺漏或無效等高線；未標示為完整`);
    await storeValue(OFFSET_KEY(region.id, offset), features);
    done += response.features?.length || 0;
    onProgress(Math.min(done, total), total);
  }
  const downloadedAt = new Date().toISOString();
  const install: TerrainInstall = { id: region.id, name: region.name, downloadedAt, featureCount: total, complete: done >= total };
  if (!install.complete) throw new Error('地形資料未完整下載；已下載頁面會保留，可重試續傳');
  await storeValue(META_KEY(region.id), install);
  return install;
}

export async function loadTerrainRegion(id: string): Promise<TerrainFeature[]> {
  const meta = await readValue<TerrainInstall>(META_KEY(id));
  if (!meta?.complete) return [];
  const features: TerrainFeature[] = [];
  const pages = Math.ceil(meta.featureCount / PAGE_SIZE);
  for (let page = 0; page < pages; page++) {
    const values = await readValue<TerrainFeature[]>(OFFSET_KEY(id, page * PAGE_SIZE));
    if (!values) throw new Error(`地形資料不完整：缺少第 ${page + 1} 頁`);
    features.push(...values);
  }
  return features;
}

export async function removeTerrainRegion(id: string): Promise<void> {
  await removeKeys(`terrain:${id}:`);
}

export async function verifyTerrainRegion(id: string): Promise<{ complete: boolean; count: number; missingPages: number }> {
  const meta = await readValue<TerrainInstall>(META_KEY(id));
  if (!meta?.complete) return { complete: false, count: 0, missingPages: 1 };
  const pages = Math.ceil(meta.featureCount / PAGE_SIZE);
  let count = 0;
  let missingPages = 0;
  for (let page = 0; page < pages; page++) {
    const values = await readValue<TerrainFeature[]>(OFFSET_KEY(id, page * PAGE_SIZE));
    if (!values) missingPages++;
    else count += values.length;
  }
  return { complete: missingPages === 0 && count > 0, count, missingPages };
}
