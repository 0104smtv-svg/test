const CACHE_NAME = 'fotozvit-v2';

// Файли оболонки. '/' та index.html — критичні для офлайн-запуску,
// решта (манифест, іконки) — бажані, але їх відсутність не повинна
// ламати встановлення Service Worker.
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// ── Встановлення ──
// Кешуємо по одному через allSettled: якщо якийсь файл (напр. іконка)
// недоступний — встановлення НЕ падає, на відміну від cache.addAll().
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await Promise.allSettled(PRECACHE.map(url => cache.add(url)));
      await self.skipWaiting();
    })
  );
});

// ── Активація — видаляємо старі версії кешу ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Запити ──
self.addEventListener('fetch', e => {
  const req = e.request;

  // Кешувати можна лише GET (cache.put на POST кидає помилку).
  if (req.method !== 'GET') return;

  // Бэкенд Apps Script — тільки мережа, з зрозумілою заглушкою при офлайні.
  // Умова звужена до script.google.com, щоб ВИПАДКОВО не ловити
  // fonts.googleapis.com (раніше шрифт офлайн отримував JSON-помилку).
  if (req.url.includes('script.google.com')) {
    e.respondWith(
      fetch(req).catch(() => new Response(
        JSON.stringify({ status: 'error', message: 'Немає з\'єднання' }),
        { headers: { 'Content-Type': 'application/json' } }
      ))
    );
    return;
  }

  // Решта (оболонка, статика, шрифти) — stale-while-revalidate:
  // миттєво віддаємо з кешу, у фоні оновлюємо.
  e.respondWith(staleWhileRevalidate(req));
});

async function staleWhileRevalidate(req) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  // Фонове оновлення кешу. Кешуємо лише успішні відповіді свого
  // походження або CORS — щоб не зберігати помилки чи opaque-відповіді.
  const network = fetch(req)
    .then(res => {
      if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
        cache.put(req, res.clone());
      }
      return res;
    })
    .catch(() => null);

  // 1) є кеш — віддаємо одразу (мережа оновить його у фоні)
  if (cached) return cached;

  // 2) кешу немає — чекаємо мережу
  const fresh = await network;
  if (fresh) return fresh;

  // 3) ні кешу, ні мережі: для навігації віддаємо оболонку
  if (req.mode === 'navigate') {
    const shell = await cache.match('./index.html');
    if (shell) return shell;
  }

  return new Response('Офлайн', { status: 503, statusText: 'Offline' });
}
