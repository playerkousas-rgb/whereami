const CACHE='whereami-shell-v5';
const SHELL=['/','/index.html','/manifest.webmanifest','/icon.svg','/data/facilities.json','/data/lampposts/manifest.json'];
// Cache.addAll() is all-or-nothing: if a single item fails (e.g. the 1.4MB facilities.json on a
// flaky trailside connection — exactly the network condition this app's users actually hike in),
// the WHOLE install used to reject and NOTHING got precached, not even the tiny shell files that
// would have succeeded on their own. Cache each item independently so one bad download can't wipe
// out the rest; whatever fails here can still be picked up opportunistically by the runtime
// fetch handler below on a later successful visit.
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>Promise.all(SHELL.map(url=>c.add(url).catch(()=>{}))))));
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
 // Only an actual page navigation may fall back to the cached index.html shell (correct SPA
 // behaviour when fully offline). A missing hashed JS/CSS chunk, JSON data file, or lamppost
 // district must NOT silently receive index.html's HTML back — a <script> tag trying to execute
 // that as JavaScript breaks the whole app with a blank page, and a JSON.parse of HTML throws a
 // confusing error instead of an honest "unavailable offline" one. Let those genuinely fail so the
 // calling code's own (already-handled) error paths take over.
 const isNavigation=e.request.mode==='navigate'||e.request.destination==='document';
 e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}return r}).catch(()=>caches.match(e.request).then(r=>r||(isNavigation?caches.match('/index.html'):Promise.reject(new Error('resource unavailable offline'))))));
});
