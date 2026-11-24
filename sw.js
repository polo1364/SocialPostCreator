// 貼文廚房 service worker（放在網站根目錄才能涵蓋整個網站；路徑一律相對，GitHub Pages 子路徑也能用）
// - 本站檔案：網路優先，離線時用快取 → 沒網路也打得開
// - 外部工具（Claude SDK、存圖工具、字型）：先用快取、背景更新
// - Claude API 一律不經過快取
// - 分享目標：接住從相簿「分享」過來的照片，暫存後導回首頁
// - 新版本：安裝好後先等待，使用者按「重新整理」才切換（避免出單到一半被換掉）
const VERSION = 'v13';
const SHELL_CACHE = `shell-${VERSION}`;
const CDN_CACHE = 'cdn-v1';
const SHARE_CACHE = 'share-inbox';
const BASE = new URL('./', self.location).href;
const SHELL = ['./', 'public/styles.css', 'public/app.css', 'public/app.js', 'public/kitchen.js', 'public/js/base.js', 'public/js/core.js', 'public/js/pwa.js', 'public/js/settings.js', 'public/js/form.js', 'public/js/order.js', 'public/js/publish.js', 'public/js/history.js', 'public/js/profiles.js', 'public/js/overlay.js', 'public/js/compare.js', 'public/js/check.js', 'public/js/a11y.js', 'public/icons.svg', 'manifest.webmanifest', 'public/icons/icon-192.png', 'public/icons/icon-512.png']
    .map(p => new URL(p, BASE).href);
const CDN_HOSTS = ['esm.sh', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
    // cache: 'reload' → 直接向伺服器拿最新檔，不吃瀏覽器的 HTTP 快取
    event.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).catch(() => {}));
});

self.addEventListener('message', event => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('shell-') && k !== SHELL_CACHE).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const req = event.request;
    const url = new URL(req.url);

    if (req.method === 'POST' && url.href.startsWith(BASE) && url.pathname.endsWith('/share-target')) {
        event.respondWith(handleShare(req));
        return;
    }
    if (req.method !== 'GET') return;

    if (CDN_HOSTS.includes(url.hostname)) {
        event.respondWith(staleWhileRevalidate(req));
        return;
    }
    if (!url.href.startsWith(BASE)) return; // 其他網域（例如 Claude API）不處理

    const key = req.mode === 'navigate' ? BASE : url.href.split('?')[0];
    event.respondWith((async () => {
        try {
            // GitHub Pages 讓瀏覽器快取 10 分鐘；改成每次向伺服器確認（沒變就回 304，很快），避免新舊檔案混用
            let fresh;
            try { fresh = new Request(req, { cache: 'no-cache' }); } catch (e) { fresh = req; }
            const res = await fetch(fresh);
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

async function staleWhileRevalidate(req) {
    const cache = await caches.open(CDN_CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
    }).catch(() => null);
    if (cached) return cached;
    const res = await network;
    return res || new Response('', { status: 504, statusText: 'offline' });
}

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
