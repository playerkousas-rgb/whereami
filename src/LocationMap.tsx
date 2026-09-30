import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { NearbyFacility } from './facilities';

interface Props { lat:number; lng:number; accuracy:number; locked:boolean; devicePosition?:boolean; landmark?:{lat:number;lng:number;name:string}|null; facilities?:NearbyFacility[]; alerts?:{title:string;detail?:string;lat?:number;lng?:number;publishedAt?:string}[]; }
const TILE='https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/WGS84/{z}/{x}/{y}.png';
const LABEL='https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/tc/WGS84/{z}/{x}/{y}.png';
// 標距柱／燈柱的名稱例如「標距柱 M047」「燈柱 CW1234A」，取最後一節作為現場柱號標籤，
// 讓使用者可直接對照現場實物編號，而不是只看到一個沒有意義的顏色點。
const extractCode=(name:string):string=>{const parts=name.trim().split(/\s+/);const last=parts[parts.length-1];return last&&last!==name?last:'';};
export const FACILITY_COLORS:Record<string,string>={aed:'#c93434',toilet:'#5577b8',water:'#168b9b',distance_post:'#7652a8',fire_station:'#d65a31',ambulance_station:'#d63568',police:'#334e8a',hospital:'#bd3c72',other:'#69756e'};
export const ALERT_COLOR='#d26b2f';
const shortLabel:Record<string,(f:{type:string;name:string})=>string>={
 distance_post:f=>extractCode(f.name)||'柱',
 other:f=>extractCode(f.name)||'？',
 aed:()=>'AED',
 toilet:()=>'廁',
 water:()=>'水',
 fire_station:()=>'消',
 ambulance_station:()=>'救',
 police:()=>'警',
 hospital:()=>'急',
};
export default function LocationMap({lat,lng,accuracy,locked,devicePosition=true,landmark,facilities=[],alerts=[]}:Props){
 const host=useRef<HTMLDivElement>(null), map=useRef<L.Map|null>(null), marker=useRef<L.CircleMarker|null>(null), circle=useRef<L.Circle|null>(null), landmarkMarker=useRef<L.CircleMarker|null>(null), link=useRef<L.Polyline|null>(null), facilityLayer=useRef<L.LayerGroup|null>(null);
 useEffect(()=>{if(!host.current||map.current)return;const m=L.map(host.current,{zoomControl:true,attributionControl:true}).setView([lat,lng],16);L.tileLayer(TILE,{minZoom:10,maxZoom:20,attribution:'Map from Lands Department'}).addTo(m);L.tileLayer(LABEL,{minZoom:10,maxZoom:20,pane:'overlayPane'}).addTo(m);map.current=m;setTimeout(()=>m.invalidateSize(),0);return()=>{m.remove();map.current=null}},[]);
 useEffect(()=>{const m=map.current;if(!m)return;const ll=L.latLng(lat,lng);if(!marker.current)marker.current=L.circleMarker(ll,{radius:devicePosition?8:10,color:'#fff',weight:3,fillColor:devicePosition?(locked?'#e9a23b':'#2078d4'):'#c53d35',fillOpacity:1}).bindTooltip(devicePosition?'裝置定位':'已確認地標',{permanent:!devicePosition,direction:'top'}).addTo(m);else marker.current.setLatLng(ll).setRadius(devicePosition?8:10).setStyle({fillColor:devicePosition?(locked?'#e9a23b':'#2078d4'):'#c53d35'}).bindTooltip(devicePosition?'裝置定位':'已確認地標',{permanent:!devicePosition,direction:'top'});if(!circle.current)circle.current=L.circle(ll,{radius:accuracy,color:'#2078d4',weight:1,fillOpacity:.12}).addTo(m);else circle.current.setLatLng(ll).setRadius(accuracy);if(landmark){const lm=L.latLng(landmark.lat,landmark.lng);if(!landmarkMarker.current)landmarkMarker.current=L.circleMarker(lm,{radius:10,color:'#fff',weight:3,fillColor:'#c53d35',fillOpacity:1}).addTo(m);landmarkMarker.current.setLatLng(lm).bindTooltip(`已確認：${landmark.name}`,{permanent:true,direction:'top'});if(!link.current)link.current=L.polyline([ll,lm],{color:'#c53d35',dashArray:'5 7',weight:2}).addTo(m);else link.current.setLatLngs([ll,lm]);m.fitBounds(L.latLngBounds([ll,lm]).pad(.35),{maxZoom:18});}else{landmarkMarker.current?.remove();landmarkMarker.current=null;link.current?.remove();link.current=null;m.panTo(ll)}},[lat,lng,accuracy,locked,devicePosition,landmark]);
 useEffect(()=>{const m=map.current;if(!m)return;if(!facilityLayer.current)facilityLayer.current=L.layerGroup().addTo(m);facilityLayer.current.clearLayers();const colors=FACILITY_COLORS;alerts.filter(a=>a.lat!=null&&a.lng!=null).slice(0,50).forEach(a=>{const dot=L.circleMarker([a.lat!,a.lng!],{radius:8,color:'#fff',weight:2,fillColor:ALERT_COLOR,fillOpacity:.95});const tip=document.createElement('span');tip.className='facility-label';tip.style.borderColor=ALERT_COLOR;tip.textContent='！封閉';dot.bindTooltip(tip,{permanent:true,direction:'right',offset:[7,0],className:'facility-label-wrap'});dot.bindPopup(`<strong>${a.title}</strong>${a.detail?`<p>${a.detail}</p>`:''}${a.publishedAt?`<small>官方日期：${a.publishedAt}</small>`:''}`).addTo(facilityLayer.current!)});facilities.slice(0,50).forEach(f=>{const color=colors[f.type]||colors.other;const dot=L.circleMarker([f.lat,f.lng],{radius:6,color:'#fff',weight:2,fillColor:color,fillOpacity:.95});const label=(shortLabel[f.type]||shortLabel.other)(f);const tip=document.createElement('span');tip.className='facility-label';tip.style.borderColor=color;tip.textContent=label;dot.bindTooltip(tip,{permanent:true,direction:'right',offset:[7,0],className:'facility-label-wrap'});const box=document.createElement('div');const title=document.createElement('strong');title.textContent=f.name;const meta=document.createElement('p');meta.textContent=`直線距離 ${Math.round(f.distance)} 米 · ${f.direction} ${Math.round(f.bearing)}°`;box.append(title,meta);if(f.address){const address=document.createElement('p');address.textContent=f.address;box.append(address)}if(f.hours){const hours=document.createElement('p');hours.textContent=`開放時間：${f.hours}`;box.append(hours)}if(f.phone){const phone=document.createElement('p');phone.textContent=`電話：${f.phone}`;box.append(phone)}if(f.detail){const detail=document.createElement('p');detail.textContent=f.detail;box.append(detail)}dot.bindPopup(box).addTo(facilityLayer.current!)});},[facilities,alerts]);
 return <div className="location-map" ref={host} aria-label="目前位置地圖"/>;
}
