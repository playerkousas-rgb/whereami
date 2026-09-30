const CACHE='whereami-shell-v4';
const SHELL=['/','/index.html','/manifest.webmanifest','/icon.svg','/data/facilities.json','/data/lampposts/manifest.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('whereami-shell-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const url=new URL(e.request.url);
 if(url.hostname==='mapapi.geodata.gov.hk'){
  e.respondWith(fetch(e.request).then(r=>r).catch(()=>caches.match(e.request).then(r=>r||Promise.reject(new Error('offline map tile unavailable')))));
  return;
 }
 if(url.origin!==self.location.origin)return;
 if(url.pathname.startsWith('/api/')){e.respondWith(fetch(e.request,{cache:'no-store'}));return;} // 即時安全API永不快取
 e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/index.html'))));
});
