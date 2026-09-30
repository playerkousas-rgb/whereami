import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface Props { lat:number; lng:number; accuracy:number; locked:boolean; }
const TILE='https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/WGS84/{z}/{x}/{y}.png';
const LABEL='https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/tc/WGS84/{z}/{x}/{y}.png';
export default function LocationMap({lat,lng,accuracy,locked}:Props){
 const host=useRef<HTMLDivElement>(null), map=useRef<L.Map|null>(null), marker=useRef<L.CircleMarker|null>(null), circle=useRef<L.Circle|null>(null);
 useEffect(()=>{if(!host.current||map.current)return;const m=L.map(host.current,{zoomControl:true,attributionControl:true}).setView([lat,lng],16);L.tileLayer(TILE,{minZoom:10,maxZoom:20,attribution:'Map from Lands Department'}).addTo(m);L.tileLayer(LABEL,{minZoom:10,maxZoom:20,pane:'overlayPane'}).addTo(m);map.current=m;setTimeout(()=>m.invalidateSize(),0);return()=>{m.remove();map.current=null}},[]);
 useEffect(()=>{const m=map.current;if(!m)return;const ll=L.latLng(lat,lng);if(!marker.current)marker.current=L.circleMarker(ll,{radius:8,color:'#fff',weight:3,fillColor:locked?'#e9a23b':'#2078d4',fillOpacity:1}).addTo(m);else marker.current.setLatLng(ll).setStyle({fillColor:locked?'#e9a23b':'#2078d4'});if(!circle.current)circle.current=L.circle(ll,{radius:accuracy,color:'#2078d4',weight:1,fillOpacity:.12}).addTo(m);else circle.current.setLatLng(ll).setRadius(accuracy);m.panTo(ll)},[lat,lng,accuracy,locked]);
 return <div className="location-map" ref={host} aria-label="目前位置地圖"/>;
}
