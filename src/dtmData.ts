import type { MapRegion } from './offlineMaps';

const DB_NAME = 'whereami-data';
const STORE = 'datasets';
const META = (id: string) => `dtm:${id}:meta`;
const GRID = (id: string) => `dtm:${id}:grid`;

export interface DtmInstall {
  id: string; name: string; importedAt: string; width: number; height: number; cellSize: number;
  xCenter0: number; northCenter0: number; nodata: number; bytes: number; complete: boolean;
}
export interface DtmGrid extends DtmInstall { values: Int16Array; }
type WorkerGrid = Omit<DtmGrid, 'id'|'name'|'importedAt'|'bytes'|'complete'> & { region: MapRegion };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open(DB_NAME,1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function read<T>(key: string): Promise<T|undefined> {
  return openDb().then(db => new Promise((resolve,reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as T|undefined);
    request.onerror = () => reject(request.error);
  }));
}
function writePair(meta: DtmInstall, values: Int16Array): Promise<void> {
  return openDb().then(db => new Promise((resolve,reject) => {
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put(meta,META(meta.id));
    tx.objectStore(STORE).put(values,GRID(meta.id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('DTM 儲存中斷'));
  }));
}

export function dtmInstalls(): Promise<DtmInstall[]> {
  return openDb().then(db => new Promise((resolve,reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAllKeys();
    request.onsuccess = async () => {
      try {
        const installs: DtmInstall[] = [];
        for (const key of request.result.map(String).filter(key => key.startsWith('dtm:') && key.endsWith(':meta'))) {
          const meta = await read<DtmInstall>(key);
          if (meta) installs.push(meta);
        }
        resolve(installs);
      } catch (error) { reject(error); }
    };
    request.onerror = () => reject(request.error);
  }));
}

export function importDtmFile(file: File, region: MapRegion, onProgress: (message: string) => void): Promise<DtmInstall> {
  return new Promise((resolve,reject) => {
    const worker = new Worker(new URL('./dtmImport.worker.ts',import.meta.url),{type:'module'});
    let settled = false;
    const finish = () => { if (!settled) { settled = true; worker.terminate(); } };
    worker.onmessage = async (event: MessageEvent<{type:string;message?:string;grid?:WorkerGrid}>) => {
      if (event.data.type === 'progress') { onProgress(event.data.message || '正在匯入 DTM…'); return; }
      if (event.data.type === 'error') { finish(); reject(new Error(event.data.message || 'DTM 匯入失敗')); return; }
      if (event.data.type !== 'done' || !event.data.grid) return;
      try {
        const grid = event.data.grid;
        const meta: DtmInstall = {
          id: region.id, name: region.name, importedAt: new Date().toISOString(), width: grid.width, height: grid.height,
          cellSize: grid.cellSize, xCenter0: grid.xCenter0, northCenter0: grid.northCenter0, nodata: grid.nodata,
          bytes: grid.values.byteLength, complete: grid.values.length === grid.width * grid.height,
        };
        if (!meta.complete) throw new Error('DTM 格網完整性檢查失敗');
        onProgress(`儲存${region.name}5米格網（${grid.width.toLocaleString()}×${grid.height.toLocaleString()}）…`);
        await writePair(meta,grid.values);
        finish(); resolve(meta);
      } catch (error) { finish(); reject(error instanceof Error ? error : new Error('DTM 儲存失敗')); }
    };
    worker.onerror = event => { finish(); reject(new Error(event.message || 'DTM 背景匯入器失敗')); };
    worker.postMessage({file,region});
  });
}

export async function loadDtmRegion(id: string): Promise<DtmGrid|null> {
  const meta = await read<DtmInstall>(META(id));
  if (!meta?.complete) return null;
  const values = await read<Int16Array>(GRID(id));
  if (!values || values.length !== meta.width * meta.height) throw new Error(`${meta.name}的5米 DTM 格網缺漏`);
  return { ...meta, values };
}

export async function verifyDtmRegion(id: string): Promise<{complete:boolean;cells:number;bytes:number}> {
  const meta = await read<DtmInstall>(META(id));
  if (!meta?.complete) return {complete:false,cells:0,bytes:0};
  const values = await read<Int16Array>(GRID(id));
  const cells = values?.length || 0;
  return {complete:cells === meta.width * meta.height,cells,bytes:values?.byteLength || 0};
}

export async function removeDtmRegion(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(META(id));
    tx.objectStore(STORE).delete(GRID(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
