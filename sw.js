/* Parking PWA: isolated offline cache. Other apps share this origin. */
const PREFIX = "parking-shell-";
const CACHE = PREFIX + "v15";
const FILES = ["./","./index.html","./manifest.webmanifest","./icon.svg","./hero-banner.webp"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));
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

  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(request.mode==="navigate"){
      try{
        const response=await fetch(request);
        if(response.ok)await cache.put(request,response.clone());
        return response;
      }catch{
        return await cache.match(request,{ignoreSearch:true}) ||
          await cache.match("./index.html") || Response.error();
      }
    }
    const cached=await cache.match(request);
    if(cached)return cached;
    const response=await fetch(request);
    if(response.ok)try{await cache.put(request,response.clone())}catch(_){}
    return response;
  })());
});
