/* Parking PWA: isolated offline cache. Other apps share this origin. */
const PREFIX = "parking-shell-";
const CACHE = PREFIX + "v24-street-view";
const FILES = ["./","./index.html","./manifest.webmanifest","./icon.svg","./hero-banner.webp"];

self.addEventListener("install",event=>{
  // Bypass the browser HTTP cache when installing a new version.
  const requests=FILES.map(file=>new Request(file,{cache:"reload"}));
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(requests)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(
      keys.filter(key=>key.startsWith(PREFIX) && key!==CACHE)
        .map(key=>caches.delete(key))
    )),
    self.clients.claim()
  ]));
});
self.addEventListener("fetch",event=>{
  const request=event.request;
  const url=new URL(request.url);
  const scope=new URL(self.registration.scope);
  if(request.method!=="GET" || url.origin!==scope.origin ||
     !url.pathname.startsWith(scope.pathname))return;

  // Never cache the tiny release marker, even when it has a cache-busting query.
  if(url.pathname===new URL("./version.json",scope).pathname){
    event.respondWith(fetch(request,{cache:"no-store"}));
    return;
  }
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(request.mode==="navigate"){
      try{
        // Installed mobile browsers can otherwise reuse an old HTTP-cached HTML.
        const response=await fetch(request,{cache:"no-store"});
        if(response.ok){try{await cache.put("./index.html",response.clone());}catch(_){/* Keep the successful network response. */}}
        return response;
      }catch{
        return await cache.match("./index.html") ||
          await cache.match("./") || Response.error();
      }
    }
    const cached=await cache.match(request);
    if(cached)return cached;
    const response=await fetch(request);
    if(response.ok)try{await cache.put(request,response.clone())}catch(_){}
    return response;
  })());
});
