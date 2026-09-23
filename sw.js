/* Service Worker — ระบบรายงานการปฏิบัติต่อสัตว์ทดลองของนักวิจัย PSU:LASC
   - HTML ดึงจากเครือข่ายเสมอ (bypass HTTP cache) เพื่อให้ได้เวอร์ชันล่าสุดทันทีที่อัปโหลดไฟล์ใหม่
   - ไฟล์อื่นใช้ network-first แล้ว fallback เป็น cache เมื่อออฟไลน์ */
const CACHE = 'psu-lasc-animal-report-v7';
const ASSETS = [
  './',
  './index.html',
  './firebase-config.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './วิธีใช้งาน.html',
  './screenshot-wide.png',
  './screenshot-narrow.png',
  './วิธีติดตั้งแอป.html'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const isHTML = e.request.mode === 'navigate' ||
    (e.request.headers.get('accept') || '').includes('text/html');

  e.respondWith(
    fetch(isHTML ? new Request(e.request.url, { cache: 'reload' }) : e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((res) => {
          if (res) return res;
          if (isHTML) return caches.match('./index.html');
          return Response.error();
        })
      )
  );
});
