"use strict";
/* Service worker : cache offline + injection COOP/COEP (crossOriginIsolated)
   COOP/COEP sont requis pour SharedArrayBuffer → pthreads → core pcsx_rearmed threadé
   (streaming WORKERFS + OffscreenCanvas). Pattern type "coi-serviceworker".            */
const CACHE='lecteur-psx-v1';

/* Ajoute les en-têtes d'isolation à une réponse same-origin "basic".
   Les réponses opaque (cross-origin) ne peuvent pas être réécrites — on les laisse. */
function withCOI(resp){
  if(!resp) return resp;
  if(resp.type==='opaque'||resp.type==='opaqueredirect') return resp;
  try{
    const h=new Headers(resp.headers);
    h.set('Cross-Origin-Embedder-Policy','require-corp');
    h.set('Cross-Origin-Opener-Policy','same-origin');
    h.set('Cross-Origin-Resource-Policy','same-origin');
    return new Response(resp.body,{status:resp.status,statusText:resp.statusText,headers:h});
  }catch(e){ return resp; }
}

self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  try{const ks=await caches.keys();await Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)));}catch(e){}
  await self.clients.claim();
})()));

self.addEventListener('fetch',event=>{
  const req=event.request; if(req.method!=='GET') return;
  let url; try{url=new URL(req.url);}catch(e){return;}
  if(url.origin!==self.location.origin) return;            // cross-origin : non intercepté (tout est inliné de toute façon)
  if(url.protocol!=='https:'&&url.protocol!=='http:') return;
  event.respondWith((async()=>{
    try{
      const cache=await caches.open(CACHE);
      if(req.mode==='navigate'){
        try{ const net=await fetch(req); if(net&&net.ok&&net.type==='basic') await cache.put(req,net.clone()); return withCOI(net); }
        catch(e){ const c=await cache.match(req); if(c) return withCOI(c); throw e; }
      }
      const hit=await cache.match(req);
      if(hit){ event.waitUntil((async()=>{try{const f=await fetch(req);if(f&&f.ok&&f.type==='basic')await cache.put(req,f.clone());}catch(e){}})()); return withCOI(hit); }
      const r=await fetch(req); try{if(r&&r.ok&&r.status===200&&r.type==='basic')await cache.put(req,r.clone());}catch(e){} return withCOI(r);
    }catch(e){ try{ return withCOI(await fetch(req)); }catch(e2){ return fetch(req); } }
  })());
});
