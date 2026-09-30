export type FacilityType = 'toilet'|'aed'|'water'|'distance_post'|'fire_station'|'ambulance_station'|'police'|'hospital'|'other';
export interface Facility { id:string; type:FacilityType; name:string; lat:number; lng:number; address?:string; phone?:string; hours?:string; detail?:string; source:string; updatedAt?:string; }
export interface FacilityDatabase { version:string; generatedAt:string|null; sources:{name:string;url:string;retrievedAt:string}[]; items:Facility[]; }
export interface NearbyFacility extends Facility { distance:number; bearing:number; direction:string; }

const LIVE_SOURCES = [
  {name:'AED',type:'aed' as FacilityType,url:'https://portal.csdi.gov.hk/csdi-webpage/file-api?dataset_id=hkfsd_rcd_1695974242578_37917&format=geojson&layer_name=AED'},
  {name:'郊野加水站',type:'water' as FacilityType,url:'https://portal.csdi.gov.hk/csdi-webpage/file-api?dataset_id=afcd_rcd_1635133835075_48993&format=geojson&layer_name=WaterFillingStation_WaterFillingStation_Ext_GDB'},
  {name:'標距柱',type:'distance_post' as FacilityType,url:'https://portal.csdi.gov.hk/csdi-webpage/file-api?dataset_id=afcd_rcd_1635136039113_86105&format=geojson&layer_name=DistancePosts_DistancePosts_Ext_GDB'},
  {name:'消防局',type:'fire_station' as FacilityType,url:'https://portal.csdi.gov.hk/server/rest/services/common/hkfsd_rcd_1634798867463_89696/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson'},
  {name:'救護站',type:'ambulance_station' as FacilityType,url:'https://portal.csdi.gov.hk/server/rest/services/common/hkfsd_rcd_1634799003993_7633/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson'},
];
let memo: FacilityDatabase | null = null;
const dbOpen=()=>new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('whereami-data',1);r.onupgradeneeded=()=>r.result.createObjectStore('datasets');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
async function stored():Promise<FacilityDatabase|null>{try{const db=await dbOpen();return await new Promise((resolve,reject)=>{const r=db.transaction('datasets').objectStore('datasets').get('facilities');r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)})}catch{return null}}
async function store(data:FacilityDatabase){const db=await dbOpen();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('datasets','readwrite');tx.objectStore('datasets').put(data,'facilities');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
const value=(p:Record<string,unknown>,keys:string[])=>{for(const wanted of keys){const hit=Object.entries(p).find(([k,v])=>k.toLowerCase().includes(wanted)&&v!=null&&v!=='');if(hit)return String(hit[1]).trim()}return ''};
function parseGeoJson(data:unknown,type:FacilityType,source:string):Facility[]{const d=data as {type?:string;features?:Array<{geometry?:{type?:string;coordinates?:unknown[]};properties?:Record<string,unknown>}>};if(d?.type!=='FeatureCollection'||!Array.isArray(d.features))throw new Error(`${source}資料格式異常`);const out:Facility[]=[];d.features.forEach((f,i)=>{const c=f.geometry?.coordinates;if(f.geometry?.type!=='Point'||!Array.isArray(c))return;const lng=Number(c[0]),lat=Number(c[1]);if(!(lat>=22&&lat<=23&&lng>=113&&lng<=115))return;const p=f.properties||{};const code=value(p,['fac_id','post_no','number','code','objectid','id']);const rawName=value(p,['name_tc','chinese_name','location_tc','name','trail_name_tc']);const name=type==='distance_post'&&code?`標距柱 ${code}`:(rawName||code||`${source} ${i+1}`);out.push({id:`${type}:${code||i}`,type,name,lat,lng,address:value(p,['address_tc','address','location']),phone:value(p,['phone','tel']),hours:value(p,['service_hour','opening','hours']),detail:value(p,['remarks_tc','detail','floor']),source})});if(!out.length)throw new Error(`${source}沒有有效香港座標`);return out}
export async function loadFacilities(): Promise<FacilityDatabase> {
  if (memo) return memo;
  const saved=await stored();if(saved&&Array.isArray(saved.items)){memo=saved;return saved}
  const r = await fetch('/data/facilities.json');
  if (!r.ok) throw new Error(`設施資料 HTTP ${r.status}`);
  const d = await r.json();
  if (!d || !Array.isArray(d.items) || typeof d.version !== 'string') throw new Error('設施資料格式異常');
  memo = d; return d;
}
export async function refreshFacilities(onProgress?:(text:string)=>void):Promise<FacilityDatabase>{const now=new Date().toISOString();const results=await Promise.all(LIVE_SOURCES.map(async s=>{onProgress?.(`正在下載${s.name}…`);const r=await fetch(s.url,{cache:'no-store'});if(!r.ok)throw new Error(`${s.name} HTTP ${r.status}`);const items=parseGeoJson(await r.json(),s.type,s.name);return {source:{name:s.name,url:s.url,retrievedAt:now},items}}));const db:FacilityDatabase={version:now.slice(0,10),generatedAt:now,sources:results.map(x=>x.source),items:results.flatMap(x=>x.items)};await store(db);memo=db;return db}
export async function clearFacilityUpdate(){const db=await dbOpen();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('datasets','readwrite');tx.objectStore('datasets').delete('facilities');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)});memo=null}
const rad=(n:number)=>n*Math.PI/180;
export function distanceMeters(aLat:number,aLng:number,bLat:number,bLng:number):number { const R=6371008.8,dLat=rad(bLat-aLat),dLng=rad(bLng-aLng); const x=Math.sin(dLat/2)**2+Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLng/2)**2; return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)); }
export function bearingDegrees(aLat:number,aLng:number,bLat:number,bLng:number):number { const y=Math.sin(rad(bLng-aLng))*Math.cos(rad(bLat)); const x=Math.cos(rad(aLat))*Math.sin(rad(bLat))-Math.sin(rad(aLat))*Math.cos(rad(bLat))*Math.cos(rad(bLng-aLng)); return (Math.atan2(y,x)*180/Math.PI+360)%360; }
const dirs=['北','東北','東','東南','南','西南','西','西北'];
export function nearestFacilities(db:FacilityDatabase,lat:number,lng:number,type:'all'|FacilityType='all',limit=30):NearbyFacility[] { return db.items.filter(x=>type==='all'||x.type===type).map(x=>{const bearing=bearingDegrees(lat,lng,x.lat,x.lng);return {...x,distance:distanceMeters(lat,lng,x.lat,x.lng),bearing,direction:dirs[Math.round(bearing/45)%8]};}).sort((a,b)=>a.distance-b.distance).slice(0,limit); }
export const facilityName:Record<FacilityType,string>={toilet:'公廁',aed:'AED',water:'加水站',distance_post:'標距柱',fire_station:'消防局',ambulance_station:'救護站',police:'警署',hospital:'醫院／急症室',other:'其他設施'};
export const formatDistance=(m:number)=>m<1000?`${Math.round(m)} 米`:`${(m/1000).toFixed(1)} 公里`;
