const C='szcn-beta-3';
const AUDIO_CACHE='szcn-audio';
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(C).then(c=>c.addAll(['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png','./apple-touch-icon.png']).catch(()=>{})));
  self.skipWaiting();
});
self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys().then(ks=>Promise.all(
      ks.filter(k=>k!==C&&k!==AUDIO_CACHE).map(k=>caches.delete(k))
    )).then(()=>self.clients.claim())
  );
});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin!==location.origin)return;
  // 음성 파일: 캐시 우선 (한 번 받으면 네트워크가 끊겨도 재생)
  if(u.pathname.indexOf('/audio/')>=0 && u.pathname.endsWith('.mp3')){
    e.respondWith(
      caches.open(AUDIO_CACHE).then(c=>
        c.match(e.request).then(hit=>{
          if(hit)return hit;
          return fetch(e.request).then(res=>{
            if(res&&res.ok)c.put(e.request,res.clone());
            return res;
          });
        })
      )
    );
    return;
  }
  // 그 외: 네트워크 우선, 실패 시 캐시
  e.respondWith(
    fetch(e.request).then(r=>{
      const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r;
    }).catch(()=>caches.match(e.request))
  );
});
