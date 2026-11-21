// 貼文廚房 service worker（放在網站根目錄，才能涵蓋整個網站；路徑一律相對，GitHub Pages 子路徑也能用）
// - 網頁殼：網路優先，離線時用快取
// - 分享目標：接住從相簿「分享」過來的照片，暫存後導回首頁
const VERSION = 'v3';
const SHELL_CACHE = `shell-${VERSION}`;
const SHARE_CACHE = 'share-inbox';
const BASE = new URL('./', self.location).href;
const SHELL = ['./', 'public/styles.css', 'public/app.css', 'public/app.js', 'public/kitchen.js', 'public/icons.svg', 'manifest.webmanifest', 'public/icons/icon-192.png', 'public/icons/icon-512.png']
    .map(p => new URL(p, BASE).href);

self.addEventListener('install', event => {
    event.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('shell-') && k !== SHELL_CACHE).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (!url.href.startsWith(BASE)) return; // 只處理本站（Claude API、CDN 都不經過這裡）

    if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
        event.respondWith(handleShare(event.request));
        return;
    }
    if (event.request.method !== 'GET') return;

    const isPage = event.request.mode === 'navigate';
    const key = isPage ? BASE : url.href.split('?')[0];
    event.respondWith((async () => {
        try {
            const res = await fetch(event.request);
            if (res.ok && SHELL.includes(key)) {
                const cache = await caches.open(SHELL_CACHE);
                cache.put(key, res.clone());
            }
            return res;
        } catch (e) {
            const cached = await caches.match(key);
            if (cached) return cached;
            throw e;
        }
    })());
});

async function handleShare(request) {
    try {
        const form = await request.formData();
        const files = form.getAll('images').filter(f => f && typeof f === 'object' && f.type && f.type.startsWith('image/'));
        const cache = await caches.open(SHARE_CACHE);
        for (const k of await cache.keys()) await cache.delete(k);
        await Promise.all(files.slice(0, 5).map((f, i) => cache.put(new URL(`shared/${i}`, BASE).href, new Response(f, {
            headers: { 'Content-Type': f.type, 'X-File-Name': encodeURIComponent(f.name || `shared-${i}`) }
        }))));
        const text = [form.get('title'), form.get('text')].filter(Boolean).join(' ').trim();
        if (text) await cache.put(new URL('shared/text', BASE).href, new Response(text));
        return Response.redirect(`${BASE}?shared=${files.length}`, 303);
    } catch (e) {
        return Response.redirect(`${BASE}?shared=0`, 303);
    }
}
