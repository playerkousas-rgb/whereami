export interface LampPost { n:string; a:number; o:number; s?:string }
export interface LampDistrict { id:string; name:string; count:number; bytes:number; file:string; sha256:string }
export interface LampManifest { version:string; generatedAt:string|null; districts:LampDistrict[] }
const openDb=()=>new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('whereami-data',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('datasets'))r.result.createObjectStore('datasets')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
const key=(id:string)=>`lamps:${id}`;
export async function loadLampManifest():Promise<LampManifest>{const r=await fetch('/data/lampposts/manifest.json',{cache:'no-store'});if(!r.ok)throw new Error(`燈柱目錄 HTTP ${r.status}`);const m=await r.json();if(!Array.isArray(m.districts))throw new Error('燈柱目錄格式異常');return m}
export async function installedLampDistricts():Promise<string[]>{const db=await openDb();return new Promise((resolve,reject)=>{const r=db.transaction('datasets').objectStore('datasets').getAllKeys();r.onsuccess=()=>resolve(r.result.map(String).filter(x=>x.startsWith('lamps:')).map(x=>x.slice(6)));r.onerror=()=>reject(r.error)})}
async function digest(text:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
// A lamppost district file can be several hundred KB fetched over the same patchy trailside signal
// the offline map tiles face -- retry transient failures instead of giving up on the first blip
// (mirrors the retry added to offline map tile downloads).
async function fetchWithRetry(url:string,attempts=3):Promise<Response>{
  let lastErr:unknown;
  for(let i=0;i<attempts;i++){
    try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r}
    catch(e){lastErr=e;if(i<attempts-1)await new Promise(res=>setTimeout(res,400*(i+1)))}
  }
  throw lastErr instanceof Error?lastErr:new Error('下載失敗');
}
export async function downloadLampDistrict(d:LampDistrict,onProgress?:(s:string)=>void){onProgress?.(`正在下載${d.name}…`);const r=await fetchWithRetry(d.file);const text=await r.text();if(await digest(text)!==d.sha256)throw new Error('檔案完整性驗證失敗');const data=JSON.parse(text);if(!Array.isArray(data)||data.length!==d.count)throw new Error('燈柱資料數量不符');const db=await openDb();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('datasets','readwrite');tx.objectStore('datasets').put({version:d.sha256,data},key(d.id));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)});onProgress?.(`${d.name}已下載：${d.count.toLocaleString()}支燈柱`)}
export async function removeLampDistrict(id:string){const db=await openDb();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('datasets','readwrite');tx.objectStore('datasets').delete(key(id));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
export async function findLampPost(number:string):Promise<(LampPost&{district:string})|null>{const q=number.trim().toUpperCase().replace(/\s/g,'');if(!q)return null;const db=await openDb();const ids=await installedLampDistricts();for(const id of ids){const pack:any=await new Promise((resolve,reject)=>{const r=db.transaction('datasets').objectStore('datasets').get(key(id));r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const hit=(pack?.data as LampPost[]|undefined)?.find(x=>x.n.toUpperCase().replace(/\s/g,'')===q);if(hit)return {...hit,district:id}}return null}
