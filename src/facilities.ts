export type FacilityType = 'toilet'|'aed'|'water'|'distance_post'|'fire_station'|'ambulance_station'|'police'|'hospital'|'other';
export interface Facility { id:string; type:FacilityType; name:string; lat:number; lng:number; address?:string; phone?:string; hours?:string; detail?:string; source:string; updatedAt?:string; }
export interface FacilityDatabase { version:string; generatedAt:string|null; sources:{name:string;url:string;retrievedAt:string}[]; items:Facility[]; }
export interface NearbyFacility extends Facility { distance:number; bearing:number; direction:string; }

let memo: FacilityDatabase | null = null;
export async function loadFacilities(): Promise<FacilityDatabase> {
  if (memo) return memo;
  const r = await fetch('/data/facilities.json');
  if (!r.ok) throw new Error(`設施資料 HTTP ${r.status}`);
  const d = await r.json();
  if (!d || !Array.isArray(d.items) || typeof d.version !== 'string') throw new Error('設施資料格式異常');
  memo = d; return d;
}
const rad=(n:number)=>n*Math.PI/180;
export function distanceMeters(aLat:number,aLng:number,bLat:number,bLng:number):number { const R=6371008.8,dLat=rad(bLat-aLat),dLng=rad(bLng-aLng); const x=Math.sin(dLat/2)**2+Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLng/2)**2; return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)); }
export function bearingDegrees(aLat:number,aLng:number,bLat:number,bLng:number):number { const y=Math.sin(rad(bLng-aLng))*Math.cos(rad(bLat)); const x=Math.cos(rad(aLat))*Math.sin(rad(bLat))-Math.sin(rad(aLat))*Math.cos(rad(bLat))*Math.cos(rad(bLng-aLng)); return (Math.atan2(y,x)*180/Math.PI+360)%360; }
const dirs=['北','東北','東','東南','南','西南','西','西北'];
export function nearestFacilities(db:FacilityDatabase,lat:number,lng:number,type:'all'|FacilityType='all',limit=30):NearbyFacility[] { return db.items.filter(x=>type==='all'||x.type===type).map(x=>{const bearing=bearingDegrees(lat,lng,x.lat,x.lng);return {...x,distance:distanceMeters(lat,lng,x.lat,x.lng),bearing,direction:dirs[Math.round(bearing/45)%8]};}).sort((a,b)=>a.distance-b.distance).slice(0,limit); }
export const facilityName:Record<FacilityType,string>={toilet:'公廁',aed:'AED',water:'加水站',distance_post:'標距柱',fire_station:'消防局',ambulance_station:'救護站',police:'警署',hospital:'醫院／急症室',other:'其他設施'};
export const formatDistance=(m:number)=>m<1000?`${Math.round(m)} 米`:`${(m/1000).toFixed(1)} 公里`;
