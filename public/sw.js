// 貼文廚房 service worker
// - 網頁殼：網路優先，離線時用快取（API 一律不快取）
// - 分享目標：接住從相簿「分享」過來的照片，暫存後導回首頁
const VERSION = 'v2';
const SHELL_CACHE = `shell-${VERSION}`;
const SHARE_CACHE = 'share-inbox';
const SHELL = ['/', '/styles.css', '/app.css', '/app.js', '/icons.svg', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

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

    if (event.request.method === 'POST' && url.origin === location.origin && url.pathname === '/share-target') {
        event.respondWith(handleShare(event.request));
        return;
    }
    if (event.request.method !== 'GET' || url.origin !== location.origin) return;
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;

    event.respondWith((async () => {
        try {
            const res = await fetch(event.request);
            if (res.ok && (url.pathname === '/' || SHELL.includes(url.pathname))) {
                const cache = await caches.open(SHELL_CACHE);
                cache.put(url.pathname === '/' ? '/' : event.request, res.clone());
            }
            return res;
        } catch (e) {
            const cached = await caches.match(url.pathname === '/' || event.request.mode === 'navigate' ? '/' : event.request);
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
        for (const key of await cache.keys()) await cache.delete(key);
        await Promise.all(files.slice(0, 5).map((f, i) => cache.put(`/shared/${i}`, new Response(f, {
            headers: { 'Content-Type': f.type, 'X-File-Name': encodeURIComponent(f.name || `shared-${i}`) }
        }))));
        const text = [form.get('title'), form.get('text')].filter(Boolean).join(' ').trim();
        if (text) await cache.put('/shared/text', new Response(text));
        return Response.redirect(`/?shared=${files.length}`, 303);
    } catch (e) {
        return Response.redirect('/?shared=0', 303);
    }
}
