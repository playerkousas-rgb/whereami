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
export async function downloadRegion(region:MapRegion,onProgress:(done:number,total:number)=>void,signal?:AbortSignal){const urls=regionUrls(region),cache=await caches.open(`whereami-map-${region.id}-v1`);let done=0;const queue=[...urls];const worker=async()=>{while(queue.length){if(signal?.aborted)throw new DOMException('下載已取消','AbortError');const url=queue.shift()!;if(!await cache.match(url)){const response=await fetch(url,{signal});if(!response.ok)throw new Error(`地圖圖磚 HTTP ${response.status}`);await cache.put(url,response)}done++;onProgress(done,urls.length)}};try{await Promise.all(Array.from({length:4},worker));const list=mapInstalls().filter(x=>x.id!==region.id);list.push({id:region.id,name:region.name,installedAt:new Date().toISOString(),tiles:urls.length,minZoom:10,maxZoom:16,complete:true});save(list)}catch(e){await caches.delete(`whereami-map-${region.id}-v1`);save(mapInstalls().filter(x=>x.id!==region.id));throw e}}
export async function verifyRegion(region:MapRegion,onProgress?:(done:number,total:number)=>void){const urls=regionUrls(region),cache=await caches.open(`whereami-map-${region.id}-v1`);let missing=0,done=0;for(const url of urls){if(!await cache.match(url))missing++;done++;if(done%100===0||done===urls.length)onProgress?.(done,urls.length)}return{complete:missing===0,missing,total:urls.length}}
export async function removeRegion(id:string){await caches.delete(`whereami-map-${id}-v1`);save(mapInstalls().filter(x=>x.id!==id))}
