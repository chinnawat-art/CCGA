// Service Worker — ทำให้ติดตั้งลงหน้าจอมือถือได้ และเปิดหน้าที่เคยเข้าได้ตอนเน็ตหลุด
//
// นโยบาย: "เอาของใหม่จากเน็ตก่อนเสมอ" (network-first)
// เหตุผล: ระบบนี้ข้อมูลเปลี่ยนตลอด ถ้าให้อ่านจากแคชก่อนจะเห็นของเก่า
// แคชเป็นแค่ตาข่ายรองตอนเน็ตหลุด ไม่ใช่แหล่งข้อมูลหลัก

const VERSION = 'v1-20260918';
const CACHE = 'ccga-' + VERSION;

self.addEventListener('install', e => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;

  // แตะเฉพาะการดึงไฟล์ของเว็บนี้เท่านั้น
  // ห้ามยุ่งกับ Supabase / CDN / ฟอนต์ เด็ดขาด ไม่งั้นข้อมูลจะเพี้ยน
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const hit = await caches.match(req);
      if (hit) return hit;
      if (req.mode === 'navigate') {
        return new Response(
          `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
           <meta name="viewport" content="width=device-width,initial-scale=1">
           <title>ไม่มีสัญญาณ</title>
           <style>body{font-family:sans-serif;background:#0f172a;color:#e2e8f0;display:flex;
           align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px}
           h1{font-size:1.3rem}p{color:#94a3b8;line-height:1.7}
           button{margin-top:20px;padding:12px 24px;border:0;border-radius:12px;
           background:#6366f1;color:#fff;font-size:1rem;font-family:inherit}</style></head>
           <body><div><h1>📡 ไม่มีสัญญาณอินเทอร์เน็ต</h1>
           <p>หน้านี้ยังไม่เคยเปิดมาก่อน เลยไม่มีข้อมูลเก็บไว้<br>
           กรุณาเชื่อมต่อ WiFi แล้วลองใหม่<br><br>
           ถ้าต้องเบิกวัสดุตอนนี้ ให้ใช้ใบเบิกที่พิมพ์ไว้</p>
           <button onclick="location.reload()">ลองใหม่</button></div></body></html>`,
          { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
        );
      }
      throw err;
    }
  })());
});
