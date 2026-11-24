// 貼文廚房 · PWA：安裝、更新、離線、分享照片進來
import { $, actions, saveInputs, state, toast } from './core.js';
import { updateDescCount } from './form.js';
import { addImages } from './form.js';
import { checkBtnState } from './order.js';

// ===== PWA =====
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const inAppBrowser = () => /fban|fbav|instagram|line\//i.test(navigator.userAgent);

export function setupPwa() {
    // 已經是安裝後的 App 就不顯示「安裝」，其他情況都顯示（點了會安裝或給步驟說明）
    $('install-btn').classList.toggle('hidden', isStandalone());

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            // 有新版本時提示使用者重新整理（不自動重整，避免打斷正在出單）
            const notify = w => {
                if (!w || !navigator.serviceWorker.controller) return;
                state.waitingWorker = w;
                $('update-bar').classList.remove('hidden');
            };
            if (reg.waiting) notify(reg.waiting);
            reg.addEventListener('updatefound', () => {
                const w = reg.installing;
                if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') notify(w); });
            });
            // App 長時間開著時，每小時檢查一次新版本
            setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
        }).catch(e => console.warn('service worker 註冊失敗', e));

        let reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (reloading || !state.updateRequested) return;
            reloading = true;
            location.reload();
        });
    }

    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        state.installPrompt = e;
        $('install-btn').classList.remove('hidden');
    });
    window.addEventListener('appinstalled', () => {
        state.installPrompt = null;
        $('install-btn').classList.add('hidden');
        closeInstall();
        toast('已安裝，可以從主畫面開啟', 'success');
    });

    const updateOnline = () => {
        $('offline-bar').classList.toggle('hidden', navigator.onLine);
        checkBtnState();
    };
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    updateOnline();
}

actions.applyUpdate = () => {
    if (state.generating) return toast('出單中，等這張單印完再更新', 'info');
    state.updateRequested = true;
    $('update-bar').classList.add('hidden');
    if (state.waitingWorker) state.waitingWorker.postMessage('SKIP_WAITING');
    else location.reload();
};

actions.installApp = async () => {
    if (state.installPrompt) {
        state.installPrompt.prompt();
        const choice = await state.installPrompt.userChoice.catch(() => null);
        state.installPrompt = null;
        if (choice && choice.outcome === 'accepted') $('install-btn').classList.add('hidden');
        return;
    }
    showInstallGuide();
};

export function showInstallGuide() {
    const step = (n, text) => `<div class="flex gap-3"><span class="sec-no shrink-0">${n}</span><p>${text}</p></div>`;
    const warn = text => `<p class="text-[color:var(--stamp)] font-bold">${text}</p>`;
    const ua = navigator.userAgent;
    let html;
    if (isIOS()) {
        const safari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua) && !inAppBrowser();
        html = (safari ? '' : warn('iPhone／iPad 請先用 Safari 打開這個網址（臉書、LINE 的內建瀏覽器無法安裝）。'))
            + step('01', '點下方工具列的「分享」按鈕（方框加向上箭頭）')
            + step('02', '往下滑，選「加入主畫面」')
            + step('03', '按右上角「新增」，主畫面就會出現貼文廚房');
    } else if (/android/i.test(ua)) {
        html = (inAppBrowser() ? warn('請先點右上角選單，改用 Chrome 開啟這個網址。') : '')
            + step('01', '點 Chrome 右上角的「⋮」選單')
            + step('02', '選「安裝應用程式」或「加到主畫面」')
            + step('03', '按「安裝」，之後就能從主畫面開啟，也能從相簿分享照片進來');
    } else {
        html = step('01', '用 Chrome 或 Edge 開啟這個網址')
            + step('02', '點網址列右側的「安裝」圖示（螢幕加向下箭頭），或從右上角選單選「安裝貼文廚房」')
            + step('03', '安裝後會變成獨立視窗的 App，也會出現在開始選單');
    }
    $('install-steps').innerHTML = html;
    $('install-modal').classList.remove('hidden');
}

export function closeInstall() { $('install-modal').classList.add('hidden'); }
actions.closeInstall = closeInstall;

export async function receiveSharedFiles() {
    const params = new URLSearchParams(location.search);
    if (!params.has('shared')) return;
    history.replaceState(null, '', location.pathname);
    if (!('caches' in window)) return;
    try {
        const cache = await caches.open('share-inbox');
        const files = [];
        for (const req of await cache.keys()) {
            const res = await cache.match(req);
            if (!res) continue;
            if (req.url.endsWith('/shared/text')) {
                const text = await res.text();
                if (text && !$('user-desc').value.trim()) { $('user-desc').value = text.slice(0, 1000); updateDescCount(); saveInputs(); }
                continue;
            }
            const blob = await res.blob();
            const name = decodeURIComponent(res.headers.get('X-File-Name') || 'shared.jpg');
            files.push(new File([blob], name, { type: blob.type || res.headers.get('Content-Type') || 'image/jpeg' }));
        }
        await caches.delete('share-inbox');
        if (files.length) {
            addImages(files);
            toast(`收到 ${files.length} 張分享的照片`, 'success');
        }
    } catch (e) {
        console.warn('讀取分享照片失敗', e);
    }
}
