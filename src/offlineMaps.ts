export interface MapRegion { id:string; name:string; bounds:[number,number,number,number] }
export const MAP_REGIONS:MapRegion[]=[
 {id:'hk-island',name:'香港島',bounds:[22.195,114.105,22.295,114.255]},
 {id:'kowloon',name:'九龍',bounds:[22.275,114.125,22.365,114.255]},
 {id:'nt-west',name:'新界西',bounds:[22.325,113.87,22.55,114.15]},
 {id:'nt-east',name:'新界東北',bounds:[22.36,114.10,22.58,114.36]},
 {id:'sai-kung',name:'西貢及清水灣',bounds:[22.25,114.22,22.50,114.51]},
 {id:'lantau',name:'大嶼山及離島',bounds:[22.15,113.80,22.36,114.12]},
];
const BASE='https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/WGS84';
const LABEL='https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/tc/WGS84';
const tile=(lat:number,lng:number,z:number)=>{const n=2**z;const x=Math.floor((lng+180)/360*n);const y=Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n);return{x,y}};
export function regionUrls(r:MapRegion,minZoom=10,maxZoom=16){const urls:string[]=[];for(let z=minZoom;z<=maxZoom;z++){const nw=tile(r.bounds[2],r.bounds[1],z),se=tile(r.bounds[0],r.bounds[3],z);for(let x=nw.x;x<=se.x;x++)for(let y=nw.y;y<=se.y;y++){urls.push(`${BASE}/${z}/${x}/${y}.png`,`${LABEL}/${z}/${x}/${y}.png`)}}return urls}
const statusKey='whereami-offline-maps';
export interface MapInstall {id:string;name:string;installedAt:string;tiles:number;minZoom:number;maxZoom:number;complete:boolean}
export function mapInstalls():MapInstall[]{try{return JSON.parse(localStorage.getItem(statusKey)||'[]')}catch{return[]}}
const save=(list:MapInstall[])=>localStorage.setItem(statusKey,JSON.stringify(list));
// A single flaky tile among thousands (very plausible on the patchy trailside connections this
// offline-map feature exists for) used to abort and wipe the ENTIRE region download. Retry each
// tile a few times before giving up on it, so brief blips don't escalate into a whole-batch failure.
async function fetchTileWithRetry(url:string,signal?:AbortSignal,attempts=3):Promise<Response>{
  let lastErr:unknown;
  for(let i=0;i<attempts;i++){
    if(signal?.aborted)throw new DOMException('下載已取消','AbortError');
    try{const response=await fetch(url,{signal});if(!response.ok)throw new Error(`地圖圖磚 HTTP ${response.status}`);return response}
    catch(e){if(e instanceof DOMException&&e.name==='AbortError')throw e;lastErr=e;if(i<attempts-1)await new Promise(r=>setTimeout(r,400*(i+1)))}
  }
  throw lastErr instanceof Error?lastErr:new Error('圖磚下載失敗');
}
export async function downloadRegion(region:MapRegion,onProgress:(done:number,total:number)=>void,signal?:AbortSignal){const urls=regionUrls(region),cache=await caches.open(`whereami-map-${region.id}-v1`);let done=0;const queue=[...urls];const worker=async()=>{while(queue.length){if(signal?.aborted)throw new DOMException('下載已取消','AbortError');const url=queue.shift()!;if(!await cache.match(url)){const response=await fetchTileWithRetry(url,signal);await cache.put(url,response)}done++;onProgress(done,urls.length)}};try{await Promise.all(Array.from({length:4},worker));const list=mapInstalls().filter(x=>x.id!==region.id);list.push({id:region.id,name:region.name,installedAt:new Date().toISOString(),tiles:urls.length,minZoom:10,maxZoom:16,complete:true});save(list)}catch(e){if(e instanceof DOMException&&e.name==='AbortError'){await caches.delete(`whereami-map-${region.id}-v1`);save(mapInstalls().filter(x=>x.id!==region.id))}throw e}}

export async function checkRegionUpdate(region:MapRegion){
 const urls=regionUrls(region); const cache=await caches.open(`whereami-map-${region.id}-v1`); const sample=urls[Math.floor(urls.length/2)]; const cached=await cache.match(sample); if(!cached) return {available:false,updated:true,detail:'本機沒有完整快取'};
 try { const remote=await fetch(sample,{method:'HEAD',cache:'no-store'}); if(!remote.ok) return {available:false,updated:false,detail:`官方服務回應 HTTP ${remote.status}`}; const oldDate=cached.headers.get('last-modified'),newDate=remote.headers.get('last-modified'); if(oldDate&&newDate) return {available:true,updated:oldDate!==newDate,detail:`官方更新日期：${newDate}`};
 // 官方沒有提供 Last-Modified 時，才退回比較一塊代表性圖磚的內容；不把推測結果當成官方更新日期。
 const latest=await fetch(sample,{cache:'no-store'}); if(!latest.ok) return {available:false,updated:false,detail:`官方服務回應 HTTP ${latest.status}`}; const [a,b]=await Promise.all([cached.arrayBuffer(),latest.arrayBuffer()]); if(a.byteLength!==b.byteLength)return {available:true,updated:true,detail:'官方未提供更新日期；代表性圖磚內容有變更'}; const aa=new Uint8Array(a),bb=new Uint8Array(b); const same=aa.every((v,i)=>v===bb[i]); return {available:true,updated:!same,detail:same?'官方未提供更新日期；代表性圖磚未見變更':'官方未提供更新日期；代表性圖磚內容有變更'}; } catch { return {available:false,updated:false,detail:'暫時無法連線檢查官方版本'}; }
}
export async function verifyRegion(region:MapRegion,onProgress?:(done:number,total:number)=>void){const urls=regionUrls(region),cache=await caches.open(`whereami-map-${region.id}-v1`);let missing=0,done=0;for(const url of urls){if(!await cache.match(url))missing++;done++;if(done%100===0||done===urls.length)onProgress?.(done,urls.length)}return{complete:missing===0,missing,total:urls.length}}
export async function removeRegion(id:string){await caches.delete(`whereami-map-${id}-v1`);save(mapInstalls().filter(x=>x.id!==id))}
