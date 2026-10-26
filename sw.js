// 버전을 올리면 다음 방문에서 새 캐시를 설치합니다.
const CACHE_PREFIX = `jump-runner-${self.registration.scope}-`;
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const ASSETS = [
  './', './index.html', './manifest.json',
  './icon/icon-192.png', './icon/icon-512.png',
  './images/character_rectangle_red.png', './images/cactus.png',
  './images/castle.png', './images/column.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // 오디오는 브라우저의 Range 요청 및 기본 HTTP 캐시를 사용합니다.
  if (event.request.method !== 'GET' || event.request.headers.has('range') ||
      !url.href.startsWith(self.registration.scope) || url.pathname.endsWith('.mp3')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE_NAME)
      .then(cache => cache.match('./index.html'))));
    return;
  }
  event.respondWith(caches.open(CACHE_NAME).then(async cache =>
    (await cache.match(event.request)) || fetch(event.request)));
});
