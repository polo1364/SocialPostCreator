// 貼文廚房前端（純前端版，可直接放在 GitHub Pages）。
// 瀏覽器直接拿使用者自己的 Key 呼叫 Claude；提示詞與流程在 kitchen.js。
// 事件一律用 data-action 委派（不寫 inline onclick），以便啟用嚴格的 CSP。
import * as K from './kitchen.js';

// 官方 Anthropic SDK（瀏覽器版），第一次用到時才載入
const SDK_URL = 'https://esm.sh/@anthropic-ai/sdk@1.11.0';
let sdkPromise = null;
function loadSdk() {
    if (!sdkPromise) {
        sdkPromise = import(SDK_URL).then(m => m.default || m.Anthropic).catch(() => {
            sdkPromise = null;
            throw new Error('無法載入 Claude 工具，請檢查網路後再試');
        });
    }
    return sdkPromise;
}

// 呼叫 Claude 的共用包裝：錯誤一律轉成中文訊息，並把已花的費用記上
async function withClaude(fn) {
    const Anthropic = await loadSdk();
    const client = K.createClient(Anthropic, state.apiKey);
    try {
        return await fn(client);
    } catch (e) {
        if (e && e.cost) addSpend(e.cost);
        throw new Error(K.toUserError(e, Anthropic));
    }
}

async function toBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

function imagePayload(blobs) {
    return Promise.all(blobs.map(async b => ({ mediaType: ALLOWED_TYPES.includes(b.type) ? b.type : 'image/jpeg', data: await toBase64(b) })));
}

// ===== 常數 =====
const MODELS = [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', desc: '速度與品質平衡，推薦' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', desc: '文筆最好，費用較高' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', desc: '最快、最便宜' }
];
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const CHEAP_MODEL = 'claude-haiku-5-5';

const STYLES = {
    humorous: { name: '幽默搞笑', emoji: '😂', tag: '招牌' },
    warm: { name: '溫馨感性', emoji: '🥰', tag: '人氣' },
    foodie: { name: '美食專家', emoji: '😋', tag: '主廚推薦' },
    literary: { name: '文青詩意', emoji: '📖', tag: '季節限定' },
    energetic: { name: '活力熱情', emoji: '🎉', tag: '加辣' },
    minimalist: { name: '簡約俐落', emoji: '✓', tag: '小份' },
    storytelling: { name: '故事敘述', emoji: '📝', tag: '慢燉' },
    trendy: { name: '潮流網紅', emoji: '💅', tag: '新品' },
    roast: { name: '毒舌吐槽', emoji: '😏', tag: '重口味' },
    review: { name: '開箱評測', emoji: '🔍', tag: '評分' },
    travel: { name: '旅遊日記', emoji: '✈️', tag: '外帶' },
    retro: { name: '懷舊復古', emoji: '📻', tag: '古早味' },
    oneliner: { name: '一句話', emoji: '💬', tag: '一口' },
    elder: { name: '長輩圖風', emoji: '🌸', tag: '早安' }
};
const MAX_STYLES = 6;
const MAX_COPIES = 3;

// 內建＋自訂品項
function allStyles() {
    const custom = Object.fromEntries(Object.entries(state.customStyles || {}).map(([k, v]) => [k, { name: v.name, emoji: v.emoji || '✍️', tag: '自訂', custom: true }]));
    return { ...STYLES, ...custom };
}
function styleKeyByName(name) {
    return Object.entries(allStyles()).find(([, v]) => v.name === name)?.[0] || null;
}

const PLATFORMS = {
    facebook: { name: '臉書', icon: 'facebook', hint: '完整有故事性，像跟朋友分享；Hashtag 0–3 個' },
    instagram: { name: 'IG', icon: 'instagram', hint: '首行抓眼球、段落空行、文末 5–10 個 Hashtag', limit: 2200 },
    threads: { name: 'Threads', icon: 'threads', hint: '口語短句，上限 500 字', limit: 500 },
    xiaohongshu: { name: '小紅書', icon: 'book', hint: '吸睛標題＋分段 Emoji＋文末 Hashtag', limit: 1000 },
    general: { name: '不指定', icon: 'comment', hint: '一般社群寫法，每則約 50–200 字' }
};
const DEFAULT_PLATFORM = 'facebook';

const LANGUAGES = { '': '不用', en: '英文', ja: '日文', ko: '韓文' };

// 臉書常用比例
const RATIOS = [
    { id: 'original', name: '原圖', value: null },
    { id: '1:1', name: '方形 1:1', value: 1 },
    { id: '4:5', name: '直式 4:5', value: 4 / 5 },
    { id: '1.91:1', name: '橫式 1.91:1', value: 1.91 },
    { id: '9:16', name: '限動 9:16', value: 9 / 16 }
];

const QUICK_REFINES = ['再好笑一點', '短一點', '長一點', '更口語', '多點 Emoji', '少點 Emoji', '加 Hashtag', '更有質感', '加個問句結尾'];
const RATING_TEXTS = { 1: '😞 失望', 2: '😕 普通偏下', 3: '😐 中規中矩', 4: '😊 不錯', 5: '🤩 超讚大推' };

const STORAGE_KEYS = {
    apiKey: 'claude_api_key',
    model: 'claude_model',
    cheapRefine: 'post_creator_cheap_refine',
    rate: 'post_creator_rate',
    description: 'post_creator_description',
    styles: 'post_creator_styles',
    styleMode: 'post_creator_style_mode',
    copies: 'post_creator_copies',
    customStyles: 'post_creator_custom_styles',
    rating: 'post_creator_rating',
    platform: 'post_creator_platform_v2',
    voice: 'post_creator_voice',
    voiceOn: 'post_creator_voice_on',
    hashtags: 'post_creator_hashtags',
    language: 'post_creator_language',
    placeInfo: 'post_creator_place_info',
    placeType: 'post_creator_place_type',
    placeName: 'post_creator_place_name',
    placeLocation: 'post_creator_place_location',
    history: 'post_creator_history',
    orderNo: 'post_creator_order_no',
    spend: 'post_creator_spend',
    current: 'post_creator_current',
    chatDrafts: 'post_creator_chat_drafts',
    voiceDraft: 'post_creator_voice_draft'
};
const DRAFT_PHOTOS = 'draft-photos';

const HISTORY_LIMIT = 20;
const MAX_PHOTOS = 5;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_EDGE = 2576;
const MAX_BYTES = 3.5 * 1024 * 1024;
const STORE_EDGE = 1600;

// ===== 狀態 =====
const state = {
    apiKey: null,
    model: DEFAULT_MODEL,
    pendingModel: DEFAULT_MODEL,
    cheapRefine: false,
    rate: 32,
    files: [], // [{ file, url }]
    placeInfo: null,
    placeType: 'store',
    styles: ['humorous', 'warm', 'foodie'],
    styleMode: 'multi', // single：單選一道、可出多份；multi：複選 1–6 道
    copies: 1,
    customStyles: {},
    rating: 0,
    platform: DEFAULT_PLATFORM,
    voice: '',
    voiceOn: false,
    hashtags: '',
    language: '',
    history: [],
    generating: false,
    installPrompt: null,
    // 出餐區的訂單
    order: null,
    // 準備發文
    publish: null // { i, ratio, pos, bitmaps }
};

const $ = id => document.getElementById(id);
const ic = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="public/icons.svg#${name}"/></svg>`;

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

function debounce(fn, wait) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

// ===== 儲存 =====
function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('儲存失敗', e); }
}
function load(key, fallback = null) {
    try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
}
function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* 忽略 */ }
}

// IndexedDB：每張訂單的照片
function idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('post-kitchen', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('photos');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function idbRun(mode, fn) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('photos', mode);
        const req = fn(tx.objectStore('photos'));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
    });
}
const idbPut = (key, value) => idbRun('readwrite', s => s.put(value, key)).catch(e => console.warn('照片存檔失敗', e));
const idbGet = key => idbRun('readonly', s => s.get(key)).catch(() => null);
const idbKeys = () => idbRun('readonly', s => s.getAllKeys()).catch(() => []);
const idbDelete = key => idbRun('readwrite', s => s.delete(key)).catch(() => {});

function saveInputs() {
    save(STORAGE_KEYS.description, $('user-desc').value);
    save(STORAGE_KEYS.styles, state.styles);
    save(STORAGE_KEYS.styleMode, state.styleMode);
    save(STORAGE_KEYS.copies, state.copies);
    save(STORAGE_KEYS.rating, state.rating);
    save(STORAGE_KEYS.platform, state.platform);
    save(STORAGE_KEYS.hashtags, $('hashtags-input').value);
    save(STORAGE_KEYS.language, state.language);
    save(STORAGE_KEYS.placeType, state.placeType);
    save(STORAGE_KEYS.placeName, $('place-name').value);
    save(STORAGE_KEYS.placeLocation, $('place-location').value);
    if (state.placeInfo) save(STORAGE_KEYS.placeInfo, state.placeInfo);
    else remove(STORAGE_KEYS.placeInfo);
}

function restoreInputs() {
    state.apiKey = load(STORAGE_KEYS.apiKey, null);
    const m = load(STORAGE_KEYS.model, DEFAULT_MODEL);
    state.model = MODELS.some(x => x.id === m) ? m : DEFAULT_MODEL;
    state.cheapRefine = !!load(STORAGE_KEYS.cheapRefine, false);
    const rate = Number(load(STORAGE_KEYS.rate, 32));
    state.rate = rate > 0 && rate < 1000 ? rate : 32;
    ['gemini_api_key', 'post_creator_access', 'post_creator_cred_mode', 'post_creator_platform'].forEach(remove);

    $('user-desc').value = load(STORAGE_KEYS.description, '') || '';
    const custom = load(STORAGE_KEYS.customStyles, {});
    state.customStyles = custom && typeof custom === 'object' ? custom : {};
    state.styleMode = load(STORAGE_KEYS.styleMode, 'multi') === 'single' ? 'single' : 'multi';
    state.copies = Math.min(Math.max(Number(load(STORAGE_KEYS.copies, 1)) || 1, 1), MAX_COPIES);
    const styles = load(STORAGE_KEYS.styles);
    if (Array.isArray(styles)) {
        const valid = styles.filter(s => allStyles()[s]).slice(0, MAX_STYLES);
        if (valid.length >= 1) state.styles = valid;
    }
    const r = Number(load(STORAGE_KEYS.rating, 0));
    state.rating = r >= 0 && r <= 5 ? r : 0;
    const p = load(STORAGE_KEYS.platform, DEFAULT_PLATFORM);
    state.platform = PLATFORMS[p] ? p : DEFAULT_PLATFORM;
    state.voice = load(STORAGE_KEYS.voice, '') || '';
    state.voiceOn = !!load(STORAGE_KEYS.voiceOn, false) && !!state.voice.trim();
    state.hashtags = load(STORAGE_KEYS.hashtags, '') || '';
    $('hashtags-input').value = state.hashtags;
    const lang = load(STORAGE_KEYS.language, '');
    state.language = LANGUAGES[lang] !== undefined ? lang : '';

    setPlaceType(load(STORAGE_KEYS.placeType, 'store') === 'attraction' ? 'attraction' : 'store', false);
    $('place-name').value = load(STORAGE_KEYS.placeName, '') || '';
    $('place-location').value = load(STORAGE_KEYS.placeLocation, '') || '';
    const info = load(STORAGE_KEYS.placeInfo);
    if (info && info.found) {
        state.placeInfo = info;
        displayPlaceInfo(info);
    }
    const h = load(STORAGE_KEYS.history, []);
    state.history = Array.isArray(h) ? h : [];
}

// ===== 事件委派 =====
const actions = {};

document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (el && !el.disabled) {
        const fn = actions[el.dataset.action];
        if (fn) { e.preventDefault(); fn(el, e); }
        return;
    }
    const backdrop = e.target.dataset && e.target.dataset.backdrop;
    if (backdrop && actions[backdrop]) actions[backdrop]();
});

document.addEventListener('submit', e => {
    const form = e.target.closest('[data-submit]');
    if (!form) return;
    e.preventDefault();
    const fn = actions[form.dataset.submit];
    if (fn) fn(form, e);
});

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    restoreInputs();
    renderStars();
    renderStyles();
    renderPlatforms();
    renderLanguages();
    renderVoiceStatus();
    renderPhotos();
    updateHistoryButton();
    updateDescCount();
    updateKeyStatus();
    checkBtnState();
    if (!state.apiKey) setTimeout(showKeyModal, 300);

    const autosave = debounce(saveInputs, 400);
    $('user-desc').addEventListener('input', () => { updateDescCount(); checkBtnState(); autosave(); });
    ['place-name', 'place-location', 'hashtags-input'].forEach(id => $(id).addEventListener('input', autosave));
    ['place-name', 'place-location'].forEach(id => $(id).addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); searchPlace(); }
    }));
    $('api-key-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveKey(); });
    $('custom-style-name').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) actions.saveCustomStyle(); });
    $('voice-input').addEventListener('input', () => {
        $('voice-count').textContent = `${$('voice-input').value.length}/3000`;
        save(STORAGE_KEYS.voiceDraft, $('voice-input').value);
    });
    // 小編聊天框打到一半的字也存起來
    document.addEventListener('input', debounce(e => {
        const input = e.target.closest && e.target.closest('.chat-input');
        const form = input && input.closest('[data-submit="sendRefine"]');
        if (form) setChatDraft(Number(form.dataset.i), input.value);
    }, 300));
    // 離開或切到背景前把輸入立刻存檔（不等自動存檔的延遲）
    const flush = () => saveInputs();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    $('file-upload').addEventListener('change', e => { addImages(e.target.files); e.target.value = ''; });
    $('import-file').addEventListener('change', e => { importHistoryFile(e.target.files[0]); e.target.value = ''; });
    $('fav-only').addEventListener('change', renderHistoryList);
    $('crop-pos').addEventListener('input', () => { if (state.publish) { state.publish.pos = Number($('crop-pos').value); drawCropPreview(); } });
    $('include-translation').addEventListener('change', renderPublishCaption);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeKeyModal(); closeHistoryModal(); closeVoiceModal(); closePublish(); closeInstall(); closeCustomStyle(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !$('generate-btn').disabled) generateCaption();
    });
    document.addEventListener('paste', e => {
        const images = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile());
        if (images.length) { e.preventDefault(); addImages(images); }
    });
    setupDragDrop();
    setupPwa();
    restoreDraftPhotos().then(receiveSharedFiles);
    restoreCurrentOrder();
});

function updateDescCount() { $('desc-count').textContent = `${$('user-desc').value.length}/1000`; }

// ===== PWA =====
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const inAppBrowser = () => /fban|fbav|instagram|line\//i.test(navigator.userAgent);

function setupPwa() {
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

function showInstallGuide() {
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

function closeInstall() { $('install-modal').classList.add('hidden'); }
actions.closeInstall = closeInstall;

async function receiveSharedFiles() {
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

// ===== 金鑰與設定 =====
function maskKey(k) { return k.length > 16 ? `${k.slice(0, 10)}…${k.slice(-4)}` : '••••'; }

function updateKeyStatus() {
    const model = MODELS.find(m => m.id === state.model);
    $('key-dot').className = `dot ${state.apiKey ? 'bg-emerald-400' : 'bg-red-400'}`;
    $('key-status').textContent = state.apiKey ? (model ? model.label.replace('Claude ', '') : '已設定') : '未設定 API Key';
}

function renderModelOptions() {
    $('model-options').innerHTML = MODELS.map(m => `
        <div class="model-row" data-action="selectModel" data-v="${m.id}" role="radio" aria-checked="${m.id === state.pendingModel}" tabindex="0">
            <span class="menu-item ${m.id === state.pendingModel ? 'selected' : ''} !p-0 !w-auto"><span class="box">${ic('check')}</span></span>
            <span class="font-bold text-sm">${m.label}</span>
            <span class="flex-1 border-b-2 border-dotted border-[color:var(--rule)] -translate-y-1"></span>
            <span class="text-xs text-[color:var(--ink-3)]">${m.desc}</span>
        </div>`).join('');
}
actions.selectModel = el => { state.pendingModel = el.dataset.v; renderModelOptions(); };

function setKeyEye(show) { $('key-eye').innerHTML = ic(show ? 'eye-off' : 'eye'); }

function showKeyModal() {
    state.pendingModel = state.model;
    renderModelOptions();
    const input = $('api-key-input');
    input.value = '';
    input.type = 'password';
    setKeyEye(false);
    if (state.apiKey) {
        input.placeholder = '留空則沿用目前的 Key';
        $('key-current').textContent = `目前使用：${maskKey(state.apiKey)}`;
        $('key-current').classList.remove('hidden');
        $('clear-key-btn').classList.remove('hidden');
    } else {
        input.placeholder = 'sk-ant-api03-...';
        $('key-current').classList.add('hidden');
        $('clear-key-btn').classList.add('hidden');
    }
    $('cheap-refine').checked = state.cheapRefine;
    $('rate-input').value = state.rate;
    renderSpend();
    $('key-modal').classList.remove('hidden');
    setTimeout(() => input.focus(), 50);
}
actions.showKeyModal = showKeyModal;

function closeKeyModal() {
    $('key-modal').classList.add('hidden');
    $('api-key-input').value = '';
}
actions.closeKeyModal = closeKeyModal;

actions.toggleKeyVisibility = () => {
    const input = $('api-key-input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    setKeyEye(show);
};

function saveKey() {
    const val = $('api-key-input').value.trim();
    if (!val && !state.apiKey) return toast('請輸入 API Key', 'error');
    if (val) {
        if (!val.startsWith('sk-ant-')) return toast('Claude API Key 通常以 sk-ant- 開頭，請確認', 'error');
        state.apiKey = val;
        save(STORAGE_KEYS.apiKey, val);
    }
    state.model = state.pendingModel;
    save(STORAGE_KEYS.model, state.model);
    state.cheapRefine = $('cheap-refine').checked;
    save(STORAGE_KEYS.cheapRefine, state.cheapRefine);
    const rate = Number($('rate-input').value);
    if (rate > 0 && rate < 1000) { state.rate = rate; save(STORAGE_KEYS.rate, rate); }
    closeKeyModal();
    updateKeyStatus();
    checkBtnState();
    renderOrderCost();
    toast('設定已儲存', 'success');
}
actions.saveKey = saveKey;

actions.clearKey = () => {
    if (!confirm('確定要從這台裝置刪除 API Key 嗎？')) return;
    state.apiKey = null;
    remove(STORAGE_KEYS.apiKey);
    closeKeyModal();
    updateKeyStatus();
    checkBtnState();
    toast('已刪除 API Key', 'info');
};

function requireKey() {
    if (state.apiKey) return true;
    toast('請先設定 Claude API Key', 'error');
    showKeyModal();
    return false;
}

// ===== 費用 =====
function fmtUsd(usd) {
    if (usd == null) return '—';
    return usd < 0.01 ? `US$${usd.toFixed(4)}` : `US$${usd.toFixed(3)}`;
}
function fmtCost(usd) { return `${fmtUsd(usd)}（約 NT$${(usd * state.rate).toFixed(2)}）`; }

function addSpend(cost) {
    if (!cost || typeof cost.usd !== 'number') return;
    const total = (Number(load(STORAGE_KEYS.spend, 0)) || 0) + cost.usd;
    save(STORAGE_KEYS.spend, Math.round(total * 1e6) / 1e6);
    const o = state.order;
    if (o && typeof o.cost === 'number') {
        o.cost = Math.round((o.cost + cost.usd) * 1e6) / 1e6;
        renderOrderCost();
    }
}
function renderSpend() { $('spend-total').textContent = fmtCost(Number(load(STORAGE_KEYS.spend, 0)) || 0); }
actions.resetSpend = () => { save(STORAGE_KEYS.spend, 0); renderSpend(); };
function renderOrderCost() {
    const o = state.order;
    $('result-cost').textContent = o && typeof o.cost === 'number' && o.cost > 0 ? `本單估算 ${fmtCost(o.cost)}` : '';
}

// ===== 點單選項 =====
function renderStars() {
    $('star-rating').innerHTML = [1, 2, 3, 4, 5].map(n => `
        <button type="button" class="star-btn ${n <= state.rating ? 'on' : ''}" data-action="setRating" data-v="${n}" role="radio" aria-checked="${n === state.rating}" aria-label="${n} 星">${ic('star')}</button>`).join('');
    $('rating-text').innerHTML = state.rating
        ? `${RATING_TEXTS[state.rating]} <button type="button" data-action="setRating" data-v="0" class="ml-1 text-xs text-[color:var(--ink-3)] hover:text-[color:var(--stamp)] underline">清除</button>`
        : '<span class="text-[color:var(--ink-3)]">未評分</span>';
}
actions.setRating = el => {
    const n = Number(el.dataset.v);
    state.rating = state.rating === n ? 0 : n;
    renderStars();
    saveInputs();
};

function renderPlatforms() {
    $('platform-chips').innerHTML = Object.entries(PLATFORMS).map(([key, p]) => `
        <button type="button" class="${key === state.platform ? 'active' : ''}" data-action="setPlatform" data-v="${key}" role="radio" aria-checked="${key === state.platform}">${ic(p.icon, 'mr-1')}${p.name}</button>`).join('');
    $('platform-hint').textContent = PLATFORMS[state.platform].hint;
}
actions.setPlatform = el => { state.platform = PLATFORMS[el.dataset.v] ? el.dataset.v : DEFAULT_PLATFORM; renderPlatforms(); saveInputs(); };

function renderLanguages() {
    $('language-chips').innerHTML = Object.entries(LANGUAGES).map(([key, name]) => `
        <button type="button" class="${key === state.language ? 'active' : ''}" data-action="setLanguage" data-v="${key}">${name}</button>`).join('');
}
actions.setLanguage = el => { state.language = el.dataset.v; renderLanguages(); saveInputs(); };

function renderStyles() {
    const single = state.styleMode === 'single';
    if (single && state.styles.length > 1) state.styles = state.styles.slice(0, 1);
    $('mode-single').classList.toggle('active', single);
    $('mode-multi').classList.toggle('active', !single);
    $('copies-wrap').classList.toggle('hidden', !single);
    $('copies-chips').innerHTML = [1, 2, 3].map(n => `<button type="button" class="${n === state.copies ? 'active' : ''}" data-action="setCopies" data-v="${n}">${n}</button>`).join('');
    $('style-chips').innerHTML = Object.entries(allStyles()).map(([key, st]) => {
        const on = state.styles.includes(key);
        const qty = single ? `×${state.copies}` : '×1';
        return `
        <div class="flex items-center">
            <button type="button" class="menu-item ${on ? 'selected' : ''}" data-action="toggleStyle" data-v="${key}" aria-pressed="${on}" role="${single ? 'radio' : 'checkbox'}">
                <span class="box ${single ? '!rounded-full' : ''}">${ic('check')}</span>
                <span class="name">${escapeHtml(st.name)}</span><span>${escapeHtml(st.emoji)}</span>
                <span class="leader"></span>
                <span class="tag">${on ? qty : escapeHtml(st.tag)}</span>
            </button>
            ${st.custom ? `<button type="button" data-action="deleteCustomStyle" data-v="${key}" class="w-7 h-7 shrink-0 text-[color:var(--ink-3)] hover:text-[color:var(--stamp)]" title="刪除這個自訂品項">${ic('x')}</button>` : ''}
        </div>`;
    }).join('');
    const count = single ? state.copies : state.styles.length;
    $('style-hint').textContent = single ? '選 1 道，可出 1–3 份不同寫法' : `選 1–${MAX_STYLES} 道 · ${state.styles.length}/${MAX_STYLES}`;
    $('order-summary').textContent = `${count} 張貼文`;
}

actions.setStyleMode = el => {
    state.styleMode = el.dataset.v === 'single' ? 'single' : 'multi';
    renderStyles();
    saveInputs();
};

actions.setCopies = el => {
    state.copies = Math.min(Math.max(Number(el.dataset.v) || 1, 1), MAX_COPIES);
    renderStyles();
    saveInputs();
};

actions.toggleStyle = el => {
    const key = el.dataset.v;
    if (state.styleMode === 'single') {
        state.styles = [key];
    } else {
        const i = state.styles.indexOf(key);
        if (i > -1) {
            if (state.styles.length <= 1) return toast('至少要點 1 道', 'error');
            state.styles.splice(i, 1);
        } else {
            if (state.styles.length >= MAX_STYLES) return toast(`最多點 ${MAX_STYLES} 道`, 'error');
            state.styles.push(key);
        }
    }
    renderStyles();
    checkBtnState();
    saveInputs();
};

// 自訂品項
function showCustomStyle() {
    $('custom-style-name').value = '';
    $('custom-style-emoji').value = '';
    $('custom-style-desc').value = '';
    $('custom-style-modal').classList.remove('hidden');
    setTimeout(() => $('custom-style-name').focus(), 50);
}
actions.showCustomStyle = showCustomStyle;
function closeCustomStyle() { $('custom-style-modal').classList.add('hidden'); }
actions.closeCustomStyle = closeCustomStyle;

actions.saveCustomStyle = () => {
    const name = $('custom-style-name').value.trim().slice(0, 12);
    if (!name) return toast('幫這個品項取個名字', 'error');
    if (Object.values(allStyles()).some(st => st.name === name)) return toast('菜單上已經有這個名字了', 'error');
    if (Object.keys(state.customStyles).length >= 20) return toast('自訂品項最多 20 個', 'error');
    const key = `custom-${Date.now()}`;
    state.customStyles[key] = {
        name,
        emoji: $('custom-style-emoji').value.trim().slice(0, 4) || '✍️',
        description: $('custom-style-desc').value.trim().slice(0, 120)
    };
    save(STORAGE_KEYS.customStyles, state.customStyles);
    if (state.styleMode === 'single') state.styles = [key];
    else if (state.styles.length < MAX_STYLES) state.styles.push(key);
    closeCustomStyle();
    renderStyles();
    saveInputs();
    toast(`已加入「${name}」`, 'success');
};

actions.deleteCustomStyle = el => {
    const key = el.dataset.v;
    const st = state.customStyles[key];
    if (!st || !confirm(`刪除自訂品項「${st.name}」？`)) return;
    delete state.customStyles[key];
    save(STORAGE_KEYS.customStyles, state.customStyles);
    state.styles = state.styles.filter(k => k !== key);
    if (!state.styles.length) state.styles = ['humorous'];
    renderStyles();
    saveInputs();
};

// 我的口吻
function renderVoiceStatus() {
    const has = !!state.voice.trim();
    $('voice-switch').classList.toggle('on', state.voiceOn && has);
    $('voice-status').textContent = !has ? '未設定範例' : state.voiceOn ? `模仿中（${state.voice.length} 字範例）` : '已關閉';
}
actions.toggleVoice = () => {
    if (!state.voice.trim()) return showVoiceModal();
    state.voiceOn = !state.voiceOn;
    save(STORAGE_KEYS.voiceOn, state.voiceOn);
    renderVoiceStatus();
};
function showVoiceModal() {
    const draft = load(STORAGE_KEYS.voiceDraft, null);
    $('voice-input').value = typeof draft === 'string' ? draft : state.voice;
    $('voice-count').textContent = `${$('voice-input').value.length}/3000`;
    $('voice-modal').classList.remove('hidden');
    setTimeout(() => $('voice-input').focus(), 50);
}
actions.showVoiceModal = showVoiceModal;
function closeVoiceModal() { $('voice-modal').classList.add('hidden'); remove(STORAGE_KEYS.voiceDraft); }
actions.closeVoiceModal = closeVoiceModal;
actions.saveVoice = () => {
    state.voice = $('voice-input').value.trim().slice(0, 3000);
    state.voiceOn = !!state.voice;
    save(STORAGE_KEYS.voice, state.voice);
    save(STORAGE_KEYS.voiceOn, state.voiceOn);
    renderVoiceStatus();
    closeVoiceModal();
    toast(state.voiceOn ? '之後的貼文會模仿你的口吻' : '已清空範例', 'success');
};
actions.clearVoice = () => { $('voice-input').value = ''; $('voice-count').textContent = '0/3000'; };
const activeVoice = () => (state.voiceOn && state.voice.trim() ? state.voice : '');
const activeHashtags = () => $('hashtags-input').value.trim();

// ===== 照片 =====
actions.openPicker = () => $('file-upload').click();

// 點單用的照片存在 IndexedDB，重新整理後還在
let draftTimer = null;
function saveDraftPhotos() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
        if (state.files.length) idbPut(DRAFT_PHOTOS, state.files.map(f => f.file));
        else idbDelete(DRAFT_PHOTOS);
    }, 150);
}

async function restoreDraftPhotos() {
    const files = await idbGet(DRAFT_PHOTOS);
    if (!Array.isArray(files) || !files.length || state.files.length) return;
    state.files = files.filter(f => f && f.size).slice(0, MAX_PHOTOS).map(f => ({ file: f, url: URL.createObjectURL(f) }));
    renderPhotos();
}

function addImages(fileList) {
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return;
    let badType = 0, tooBig = 0, overMax = 0;
    for (const file of files) {
        if (!ALLOWED_TYPES.includes(file.type)) { badType++; continue; }
        if (file.size > 10 * 1024 * 1024) { tooBig++; continue; }
        if (state.files.length >= MAX_PHOTOS) { overMax++; continue; }
        state.files.push({ file, url: URL.createObjectURL(file) });
    }
    const notes = [];
    if (badType) notes.push(`${badType} 張格式不支援`);
    if (tooBig) notes.push(`${tooBig} 張超過 10MB`);
    if (overMax) notes.push(`超過 ${MAX_PHOTOS} 張，略過 ${overMax} 張`);
    if (notes.length) toast(notes.join('；'), 'error');
    renderPhotos();
    saveDraftPhotos();
}

actions.removePhoto = el => {
    const [item] = state.files.splice(Number(el.dataset.i), 1);
    if (item) URL.revokeObjectURL(item.url);
    renderPhotos();
    saveDraftPhotos();
};
actions.movePhoto = el => {
    const i = Number(el.dataset.i);
    const j = i + Number(el.dataset.v);
    if (j < 0 || j >= state.files.length) return;
    [state.files[i], state.files[j]] = [state.files[j], state.files[i]];
    renderPhotos();
    saveDraftPhotos();
};

function renderPhotos() {
    const n = state.files.length;
    $('upload-placeholder').classList.toggle('hidden', n > 0);
    $('photo-grid').classList.toggle('hidden', n === 0);
    $('photo-count').textContent = n;
    $('photo-grid').innerHTML = state.files.map((p, i) => `
        <div class="polaroid">
            <img src="${p.url}" class="w-full aspect-square object-cover" alt="照片 ${i + 1}">
            <span class="cap">${i === 0 ? '主照片' : `No.${i + 1}`}</span>
            <button type="button" data-action="removePhoto" data-i="${i}" class="tiny-btn absolute -top-2 -right-2 bg-[color:var(--ink)] text-white" title="移除照片 ${i + 1}">${ic('x')}</button>
            ${n > 1 ? `
            <button type="button" data-action="movePhoto" data-i="${i}" data-v="-1" class="tiny-btn absolute left-1 top-1/2 -translate-y-1/2 bg-white/90 shadow ${i === 0 ? 'invisible' : ''}" title="往前移">${ic('left')}</button>
            <button type="button" data-action="movePhoto" data-i="${i}" data-v="1" class="tiny-btn absolute right-1 top-1/2 -translate-y-1/2 bg-white/90 shadow ${i === n - 1 ? 'invisible' : ''}" title="往後移">${ic('right')}</button>` : ''}
        </div>`).join('') + (n < MAX_PHOTOS ? `
        <button type="button" data-action="openPicker" class="aspect-square border-2 border-dashed border-[color:var(--rule)] rounded text-[color:var(--ink-3)] hover:border-[color:var(--ink)] hover:text-[color:var(--ink)] flex flex-col items-center justify-center gap-1 transition self-center">
            ${ic('plus')}<span class="text-xs font-bold">再加</span><span class="text-[10px] mono">${n}/${MAX_PHOTOS}</span>
        </button>` : '');
    checkBtnState();
}

function setupDragDrop() {
    const box = $('upload-box');
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => box.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
    ['dragenter', 'dragover'].forEach(ev => box.addEventListener(ev, () => box.classList.add('dragover')));
    ['dragleave', 'drop'].forEach(ev => box.addEventListener(ev, () => box.classList.remove('dragover')));
    box.addEventListener('drop', e => addImages(e.dataTransfer.files));
}

async function toBitmap(blob) {
    return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

async function canvasToJpeg(canvas, maxBytes) {
    let blob = null;
    for (const q of [0.92, 0.85, 0.75, 0.65]) {
        blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', q));
        if (blob && (!maxBytes || blob.size <= maxBytes)) break;
    }
    return blob;
}

// 縮圖：長邊超過 maxEdge 就縮小並校正方向；檔案太大就降品質；符合條件的原檔直接用
async function resizeImage(file, maxEdge, maxBytes) {
    let bitmap;
    try { bitmap = await toBitmap(file); } catch (e) { return file; }
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const needsResize = longEdge > maxEdge;
    if (!needsResize && file.size <= maxBytes && file.type !== 'image/gif') { bitmap.close?.(); return file; }
    const scale = needsResize ? maxEdge / longEdge : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return (await canvasToJpeg(canvas, maxBytes)) || file;
}
const prepareImage = file => resizeImage(file, MAX_EDGE, MAX_BYTES).catch(() => file);
const storeCopy = blob => resizeImage(blob, STORE_EDGE, 900 * 1024).catch(() => blob);

// ===== 店家 / 景點 =====
function setPlaceType(type, persist = true) {
    state.placeType = type;
    $('type-store-btn').classList.toggle('active', type === 'store');
    $('type-attraction-btn').classList.toggle('active', type === 'attraction');
    $('place-name').placeholder = type === 'store' ? '店家名稱' : '景點名稱';
    if (persist) saveInputs();
}
actions.setPlaceType = el => setPlaceType(el.dataset.v);

async function searchPlace() {
    const placeName = $('place-name').value.trim();
    const location = $('place-location').value.trim();
    const label = state.placeType === 'store' ? '店家' : '景點';
    if (!placeName) return toast(`請輸入${label}名稱`, 'error');
    if (!requireKey()) return;
    const btn = $('search-place-btn');
    btn.disabled = true;
    btn.innerHTML = `${ic('spinner', 'spin mr-1')}查詢中`;
    try {
        const data = await withClaude(client => K.searchPlace(client, { placeName, location, placeType: state.placeType, model: state.model }));
        addSpend(data.cost);
        if (data.placeInfo && data.placeInfo.found) {
            state.placeInfo = data.placeInfo;
            displayPlaceInfo(data.placeInfo);
            toast(`已找到${label}資訊${data.cost ? `（${fmtUsd(data.cost.usd)}）` : ''}`, 'success');
        } else {
            state.placeInfo = null;
            $('place-info-container').classList.add('hidden');
            toast(`查不到這個${label}，仍可直接出單`, 'info');
        }
        saveInputs();
    } catch (e) {
        console.error(e);
        toast(e.message || '查詢失敗，請稍後再試', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `${ic('search', 'mr-1')}查詢`;
    }
}
actions.searchPlace = searchPlace;

function displayPlaceInfo(info) {
    const isAttraction = info.category === 'attraction';
    $('place-display-name').textContent = info.name || '';
    $('place-display-type').textContent = info.type || '';
    $('place-icon').innerHTML = ic(isAttraction ? 'mountain' : 'store');
    const row = (label, value) => value ? `<p><span class="mono text-xs text-[color:var(--ink-3)] mr-1">${label}</span>${escapeHtml(value)}</p>` : '';
    const list = v => (Array.isArray(v) && v.length ? v.join('、') : '');
    let html = '';
    html += row(isAttraction ? '特色' : '招牌', info.signature);
    html += row('地點', info.location);
    html += row('時間', info.hours);
    html += row('價位', info.priceRange);
    html += row('門票', info.ticketInfo);
    html += row('最佳', info.bestTime);
    html += row('周邊', list(info.nearby));
    if (info.summary) html += `<p class="italic">「${escapeHtml(info.summary)}」</p>`;
    if (Array.isArray(info.reviews) && info.reviews.length) {
        html += `<div class="flex flex-wrap gap-1 pt-1">${info.reviews.map(r => `<span class="text-xs px-2 py-0.5 rounded bg-[color:var(--stamp-soft)] text-[#8f2a1b]">${escapeHtml(r)}</span>`).join('')}</div>`;
    }
    $('place-details').innerHTML = html;
    $('place-info-container').classList.remove('hidden');
}

actions.clearPlaceInfo = () => {
    state.placeInfo = null;
    $('place-info-container').classList.add('hidden');
    $('place-name').value = '';
    $('place-location').value = '';
    saveInputs();
};

// ===== 串流 =====
async function streamCaption(opts, onPartial) {
    return withClaude(client => K.streamCaptions(client, { ...opts, model: state.model }, onPartial));
}

// ===== 出單 =====
function checkBtnState() {
    const missing = [];
    if (!state.apiKey) missing.push('設定 API Key');
    if (!state.files.length) missing.push('照片');
    if (!$('user-desc').value.trim()) missing.push('備註');
    if (!navigator.onLine) missing.unshift('網路連線');
    $('generate-btn').disabled = state.generating || missing.length > 0;
    $('generate-label').textContent = state.generating ? '出單中…' : '送出點單';
    $('generate-hint').textContent = missing.length ? `還缺：${missing.join('、')}` : '';
    $('regen-btn').disabled = $('generate-btn').disabled;
}

function nextOrderNo() {
    const n = (Number(load(STORAGE_KEYS.orderNo, 0)) || 0) + 1;
    save(STORAGE_KEYS.orderNo, n);
    return String(n).padStart(4, '0');
}

function releaseOrder(o) { (o?.photoUrls || []).forEach(u => URL.revokeObjectURL(u)); }

function commonOpts(o) {
    return {
        platform: o.platform,
        language: o.language || '',
        voiceSamples: activeVoice(),
        hashtags: activeHashtags(),
        placeInfo: o.context.placeInfo || null,
        rating: o.context.rating || 0,
        customStyles: state.customStyles
    };
}

async function generateCaption() {
    if (state.generating) return;
    if (!requireKey()) return;
    if (!state.files.length) return toast('請先放照片', 'error');
    const desc = $('user-desc').value.trim();
    if (!desc) return toast('請寫一下備註', 'error');

    state.generating = true;
    checkBtnState();
    const model = MODELS.find(m => m.id === state.model);
    $('loading-title').textContent = '主廚正在看照片…';
    $('loading-sub').textContent = `主廚 ${model ? model.label : state.model}，看完就開始邊寫邊印`;
    $('loading').classList.remove('hidden');
    $('result-area').classList.add('hidden');
    $('loading').scrollIntoView({ behavior: 'smooth', block: 'center' });

    let order = null;
    try {
        const images = await Promise.all(state.files.map(({ file }) => prepareImage(file)));
        releaseOrder(state.order);
        order = {
            historyId: Date.now(),
            orderNo: nextOrderNo(),
            model: state.model,
            platform: state.platform,
            language: state.language,
            timestamp: new Date().toLocaleString('zh-TW', { hour12: false }),
            analysis: null,
            altTexts: [],
            context: { description: desc, placeInfo: state.placeInfo, rating: state.rating },
            cost: 0,
            images,
            photoUrls: images.map(b => URL.createObjectURL(b)),
            items: [],
            streaming: true
        };
        state.order = order;
        rememberOrder(order, true);
        persistPhotos(order);

        const opts = {
            images: await imagePayload(images),
            description: desc,
            styles: state.styles,
            copies: state.styleMode === 'single' ? state.copies : 1,
            ...commonOpts(order)
        };

        let shown = false;
        const final = await streamCaption(opts, partial => {
            if (state.order !== order) return;
            if (!shown && ((partial.captions || []).length || partial.analysis?.summary)) {
                shown = true;
                $('loading').classList.add('hidden');
                renderOrder(false);
            }
            applyPartial(order, partial);
        });

        order.model = final.model || order.model;
        order.analysis = final.imageAnalysis || order.analysis;
        order.altTexts = final.altTexts || [];
        order.items = final.captions.map(c => ({ style: c.style || '', versions: [{ caption: c.caption, translation: c.translation || '' }], idx: 0, busy: false, streaming: false, fav: false }));
        order.streaming = false;
        if (state.order === order) renderOrder(!shown, !shown);
        addSpend(final.cost);
        saveOrder(order, true);
        rememberOrder(order);
        toast(`出單 ${order.items.length} 則貼文${final.cost ? `（${fmtUsd(final.cost.usd)}）` : ''}`, 'success');
    } catch (e) {
        console.error(e);
        toast(e.message || '出單失敗，請稍後再試', 'error');
        if (order && state.order === order) {
            if (!order.items.some(it => it.versions[0].caption)) {
                $('result-area').classList.add('hidden');
                forgetOrder(order);
            } else {
                // 印到一半失敗：保留已印好的部分，存進訂單紀錄
                order.streaming = false;
                order.items.forEach(it => { it.streaming = false; });
                renderOrder(false, false);
                saveOrder(order, true);
                rememberOrder(order);
            }
        }
        if (/API Key/.test(e.message || '')) showKeyModal();
    } finally {
        state.generating = false;
        $('loading').classList.add('hidden');
        checkBtnState();
    }
}
actions.generateCaption = generateCaption;

function applyPartial(order, partial) {
    rememberOrderSoon(order);
    if (partial.analysis?.summary) {
        order.analysis = partial.analysis;
        renderAnalysis(order.analysis);
    }
    const caps = partial.captions || [];
    if (caps.length < order.items.length) {
        order.items = [];
        $('captions-container').innerHTML = '';
    }
    caps.forEach((c, i) => {
        let item = order.items[i];
        if (!item) {
            item = order.items[i] = { style: c.style || '', versions: [{ caption: c.caption || '', translation: c.translation || '' }], idx: 0, busy: false, streaming: true, fav: false };
            order.items.forEach((it, k) => { if (k < i && it.streaming) { it.streaming = false; renderTicket(k); } });
            const wrap = document.createElement('div');
            wrap.id = `ticket-${i}`;
            wrap.className = 'print-in';
            $('captions-container').appendChild(wrap);
            renderTicket(i);
        } else {
            item.style = c.style || item.style;
            item.versions[0].caption = c.caption || '';
            item.versions[0].translation = c.translation || '';
            updateTicketBody(i);
        }
    });
    $('result-title').textContent = caps.length ? `出單中…已印 ${caps.length} 張` : '主廚看完照片了，準備出單…';
}

function charCountHtml(text) {
    const len = [...text].length;
    const limit = PLATFORMS[state.order?.platform]?.limit;
    if (!limit) return `字數 ${len}`;
    return `<span class="${len > limit ? 'over-limit' : ''}">字數 ${len}/${limit}${len > limit ? ' 超過上限' : ''}</span>`;
}

function updateTicketBody(i) {
    const item = state.order?.items[i];
    const wrap = $(`ticket-${i}`);
    if (!item || !wrap) return;
    const v = item.versions[item.idx];
    const body = wrap.querySelector('.body');
    if (body) body.innerHTML = escapeHtml(v.caption) + (item.streaming ? '<span class="caret"></span>' : '');
    const tr = wrap.querySelector('.translation');
    if (tr) tr.textContent = v.translation || '';
    const count = wrap.querySelector('.char-count');
    if (count) count.innerHTML = charCountHtml(v.caption);
    const styleEl = wrap.querySelector('.style-name');
    if (styleEl) styleEl.textContent = item.style || '…';
}

// ===== 出餐區 =====
function renderOrder(animate = false, scroll = true) {
    const o = state.order;
    if (!o) return;
    const model = MODELS.find(m => m.id === o.model);
    const platform = PLATFORMS[o.platform];
    $('result-title').textContent = o.streaming ? '出單中…' : '你的貼文好了';
    $('result-meta').textContent = [`#${o.orderNo}`, model && model.label, platform && o.platform !== 'general' ? platform.name : null, o.language ? `附${LANGUAGES[o.language]}` : null, o.context?.placeInfo?.name, o.timestamp].filter(Boolean).join(' · ');
    renderOrderCost();
    renderAnalysis(o.analysis);
    $('captions-container').innerHTML = o.items.map((_, i) => `<div id="ticket-${i}" class="${animate ? 'print-in' : ''}"></div>`).join('');
    o.items.forEach((_, i) => {
        if (animate) $(`ticket-${i}`).style.animationDelay = `${i * 0.18}s`;
        renderTicket(i);
    });
    $('copyall-btn').disabled = !!o.streaming;
    $('result-area').classList.remove('hidden');
    if (scroll) setTimeout(() => $('result-area').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

function renderAnalysis(a) {
    const box = $('analysis-container');
    if (!a || !a.summary) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const chips = arr => (Array.isArray(arr) ? arr : []).filter(Boolean).map(t => `<span class="note-chip">${escapeHtml(t)}</span>`).join(' ');
    const row = (label, content) => (content ? `<div class="flex gap-2 items-start"><span class="mono text-xs font-bold w-10 shrink-0 pt-0.5">${label}</span><div class="flex flex-wrap gap-1.5">${content}</div></div>` : '');
    box.innerHTML = `
        <div class="note">
            <div class="flex items-center justify-between gap-2 mb-2">
                <p class="font-black">${ic('eye', 'mr-1')}主廚筆記：照片裡看到的</p>
                <span class="mono text-[10px] opacity-60">看錯了？補進備註後整單重做</span>
            </div>
            <p class="text-sm mb-2">${escapeHtml(a.summary)}</p>
            <div class="space-y-1.5 text-sm">
                ${row('主體', chips(a.subjects))}
                ${row('文字', chips(a.visible_text))}
                ${row('場景', a.setting ? chips([a.setting]) : '')}
                ${row('氛圍', a.mood ? chips([a.mood]) : '')}
                ${row('細節', chips(a.details))}
            </div>
        </div>`;
    box.classList.remove('hidden');
}

function chatDraftKey(i) { return `${state.order?.historyId}-${i}`; }
function getChatDraft(i) { return (load(STORAGE_KEYS.chatDrafts, {}) || {})[chatDraftKey(i)] || ''; }
function setChatDraft(i, text) {
    const all = load(STORAGE_KEYS.chatDrafts, {}) || {};
    if (text) all[chatDraftKey(i)] = text; else delete all[chatDraftKey(i)];
    const keys = Object.keys(all);
    if (keys.length > 50) keys.slice(0, keys.length - 50).forEach(k => delete all[k]);
    save(STORAGE_KEYS.chatDrafts, all);
}

function renderTicket(i) {
    const o = state.order;
    const item = o?.items[i];
    const wrap = $(`ticket-${i}`);
    if (!wrap || !item) return;
    const keepInput = wrap.querySelector('.chat-input')?.value || getChatDraft(i);
    const v = item.versions[item.idx];
    const total = item.versions.length;
    const styleEntry = Object.values(allStyles()).find(st => st.name === item.style);
    const locked = item.busy || item.streaming || o.streaming;
    const photo = o.photoUrls && o.photoUrls[0];
    const hasImages = !!(o.images && o.images.length);

    const thread = item.versions.slice(1).map((ver, k) => `
        <div class="bubble me">${escapeHtml(ver.instruction || '')}</div>
        <div class="bubble bot">${escapeHtml(ver.reply || '改好了！')} <button type="button" data-action="setVersion" data-i="${i}" data-v="${k + 1}">看 v${k + 2}</button></div>`).join('');

    wrap.innerHTML = `
        <div class="paper-wrap ticket-paper">
            <div class="paper receipt">
                <div class="hdr relative">
                    <p class="font-bold tracking-[.2em]">★ 貼文廚房 ★</p>
                    <p class="text-xs text-[color:var(--ink-3)]">POST KITCHEN · 內用</p>
                    <button type="button" class="fav-btn ${item.fav ? 'on' : ''} absolute right-0 top-0 text-xl" data-action="toggleFav" data-i="${i}" data-export-hide title="${item.fav ? '取消收藏' : '收藏'}" aria-pressed="${!!item.fav}">${ic(item.fav ? 'star' : 'star-o')}</button>
                </div>
                <hr class="rule">
                <div class="row"><span>單號 #${escapeHtml(o.orderNo)}-${i + 1}</span><span>${escapeHtml(o.timestamp || '')}</span></div>
                ${photo ? `<img src="${photo}" class="receipt-photo mt-3" alt="${escapeHtml(o.altTexts?.[0] || '主照片')}">` : ''}
                <hr class="rule">
                <div class="flex items-center justify-between gap-2">
                    <p class="font-black">${styleEntry ? styleEntry.emoji + ' ' : ''}<span class="style-name">${escapeHtml(item.style || '…')}</span> <span class="mono font-normal text-[color:var(--ink-3)]">×1</span></p>
                    <div class="flex items-center gap-1 mono text-xs text-[color:var(--ink-2)]" data-export-hide>
                        ${total > 1 ? `<button class="ver-btn" data-action="setVersion" data-i="${i}" data-v="${item.idx - 1}" ${item.idx === 0 || locked ? 'disabled' : ''} title="上一版">${ic('left')}</button>` : ''}
                        <span>v${item.idx + 1}${total > 1 ? `/${total}` : ''}</span>
                        ${total > 1 ? `<button class="ver-btn" data-action="setVersion" data-i="${i}" data-v="${item.idx + 1}" ${item.idx === total - 1 || locked ? 'disabled' : ''} title="下一版">${ic('right')}</button>` : ''}
                    </div>
                </div>
                <hr class="rule">
                <p class="body">${escapeHtml(v.caption)}${item.streaming ? '<span class="caret"></span>' : ''}</p>
                <div class="${o.language ? '' : 'hidden'}">
                    <p class="mono text-[10px] text-[color:var(--ink-3)] tracking-[.3em] text-center my-3">— ${escapeHtml(LANGUAGES[o.language] || '外語')} —</p>
                    <p class="translation">${escapeHtml(v.translation || '')}</p>
                </div>
                <hr class="rule">
                <div class="row">
                    <span class="char-count">${charCountHtml(v.caption)}</span>
                    ${item.idx > 0 ? '<span class="stamp">已改單</span>' : ''}
                    <button type="button" data-action="copyCaption" data-i="${i}" class="btn-line px-3 py-1.5 text-xs" data-export-hide ${item.streaming ? 'disabled' : ''}>${ic('copy', 'mr-1')}<span>複製</span></button>
                </div>
                <div class="barcode mt-4"></div>
                <p class="text-center mono text-[10px] text-[color:var(--ink-3)] mt-1 tracking-[.3em]">THANK YOU · 謝謝光臨</p>
            </div>
        </div>

        <div class="ticket-actions">
            <button type="button" data-action="openPublish" data-i="${i}" ${locked ? 'disabled' : ''}>${ic('facebook', 'mr-1')}準備發文</button>
            <button type="button" data-action="redoTicket" data-i="${i}" ${locked || !hasImages ? 'disabled' : ''} title="${hasImages ? '只重寫這一則' : '這張舊單沒有照片，無法重做'}">${ic('redo', 'mr-1')}重做這道</button>
            <button type="button" data-action="saveTicketImage" data-i="${i}" ${item.streaming ? 'disabled' : ''}>${ic('image', 'mr-1')}存成圖片</button>
        </div>

        <div class="chat ${item.streaming ? 'hidden' : ''}">
            <div class="chat-head"><span class="avatar">編</span><span class="font-bold">小編阿文</span><span class="text-white/40">· 想怎麼改直接說</span></div>
            <div class="thread ${thread || item.busy ? '' : 'hidden'}">
                ${thread}
                ${item.busy && item.pending ? `<div class="bubble me">${escapeHtml(item.pending)}</div>` : ''}
                ${item.busy ? '<div class="bubble bot typing"><span></span><span></span><span></span></div>' : ''}
            </div>
            <div class="quick mb-2">${QUICK_REFINES.map(q => `<button type="button" data-action="quickRefine" data-i="${i}" data-v="${q}" ${locked ? 'disabled' : ''}>${q}</button>`).join('')}</div>
            <form class="flex gap-2" data-submit="sendRefine" data-i="${i}">
                <input class="chat-input" placeholder="例如：把冰淇淋寫進去、語氣再嗆一點" maxlength="300" aria-label="跟小編說想怎麼改" ${locked ? 'disabled' : ''}>
                <button type="submit" class="chat-send" ${locked ? 'disabled' : ''} title="送出">${ic('send', 'text-sm')}</button>
            </form>
        </div>`;
    const input = wrap.querySelector('.chat-input');
    if (input && keepInput && !locked) input.value = keepInput;
}

actions.setVersion = el => {
    const i = Number(el.dataset.i);
    const idx = Number(el.dataset.v);
    const item = state.order?.items[i];
    if (!item || idx < 0 || idx >= item.versions.length) return;
    item.idx = idx;
    renderTicket(i);
    saveOrder(state.order);
};

actions.toggleFav = el => {
    const i = Number(el.dataset.i);
    const item = state.order?.items[i];
    if (!item) return;
    item.fav = !item.fav;
    renderTicket(i);
    saveOrder(state.order);
    toast(item.fav ? '已收藏' : '已取消收藏', 'success');
};

actions.quickRefine = el => refineCaption(Number(el.dataset.i), el.dataset.v);
actions.sendRefine = form => {
    const input = form.querySelector('.chat-input');
    const text = (input?.value || '').trim();
    if (!text) return toast('先跟小編說想怎麼改', 'error');
    input.value = '';
    setChatDraft(Number(form.dataset.i), '');
    refineCaption(Number(form.dataset.i), text);
};

async function refineCaption(i, instruction) {
    const o = state.order;
    const item = o?.items[i];
    if (!item || item.busy || item.streaming) return;
    if (!requireKey()) return;
    const base = item.versions[item.idx];
    const historySteps = item.versions.slice(1, item.idx + 1).filter(v => v.instruction && v.instruction !== '重做這道').map(v => ({ instruction: v.instruction }));
    item.busy = true;
    item.pending = instruction;
    renderTicket(i);
    try {
        const data = await withClaude(client => K.refineCaption(client, {
            model: state.cheapRefine ? CHEAP_MODEL : state.model,
            caption: base.caption,
            style: item.style,
            instruction,
            description: o.context?.description || '',
            imageAnalysis: o.analysis,
            placeInfo: o.context?.placeInfo || null,
            rating: o.context?.rating || 0,
            platform: o.platform,
            language: o.language || '',
            voiceSamples: activeVoice(),
            hashtags: activeHashtags(),
            history: historySteps
        }));
        addSpend(data.cost);
        item.versions.push({ caption: data.caption, translation: data.translation || '', instruction, reply: data.reply });
        item.idx = item.versions.length - 1;
        saveOrder(o);
    } catch (e) {
        console.error(e);
        toast(e.message || '修改失敗，請稍後再試', 'error');
        if (/API Key/.test(e.message || '')) showKeyModal();
    } finally {
        item.busy = false;
        item.pending = null;
        if (state.order === o) renderTicket(i);
    }
}

actions.redoTicket = async el => {
    const i = Number(el.dataset.i);
    const o = state.order;
    const item = o?.items[i];
    if (!item || item.busy || item.streaming || !o.images?.length) return;
    if (!requireKey()) return;
    const styleKey = styleKeyByName(item.style);
    if (!styleKey) return toast('這道的風格無法辨識，請用整單重做', 'error');

    const opts = {
        images: await imagePayload(o.images),
        description: o.context?.description || '',
        redoStyle: styleKey,
        avoidCaption: item.versions[item.idx].caption,
        ...commonOpts(o)
    };

    const prevIdx = item.idx;
    item.versions.push({ caption: '', translation: '', instruction: '重做這道', reply: '重新出了一張新的' });
    item.idx = item.versions.length - 1;
    item.streaming = true;
    renderTicket(i);
    try {
        const final = await streamCaption(opts, partial => {
            const c = (partial.captions || [])[0];
            item.versions[item.idx].caption = c?.caption || '';
            item.versions[item.idx].translation = c?.translation || '';
            if (state.order === o) updateTicketBody(i);
        });
        const c = final.captions[0];
        item.versions[item.idx].caption = c.caption;
        item.versions[item.idx].translation = c.translation || '';
        addSpend(final.cost);
        saveOrder(o);
        toast(`重做好了${final.cost ? `（${fmtUsd(final.cost.usd)}）` : ''}`, 'success');
    } catch (e) {
        console.error(e);
        item.versions.pop();
        item.idx = prevIdx;
        toast(e.message || '重做失敗，請稍後再試', 'error');
        if (/API Key/.test(e.message || '')) showKeyModal();
    } finally {
        item.streaming = false;
        if (state.order === o) renderTicket(i);
    }
};

// ===== 存成圖片 =====
function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

const isTouch = () => matchMedia('(pointer: coarse)').matches;

actions.saveTicketImage = async el => {
    const i = Number(el.dataset.i);
    const target = $(`ticket-${i}`)?.querySelector('.ticket-paper');
    if (!target) return;
    if (!window.htmlToImage) return toast('圖片工具還在載入，請稍後再試', 'error');
    const label = el.innerHTML;
    el.disabled = true;
    el.innerHTML = `${ic('spinner', 'spin mr-1')}處理中`;
    try {
        const opts = { pixelRatio: 2, filter: node => !(node.dataset && 'exportHide' in node.dataset), style: { padding: '16px' } };
        let blob;
        try { blob = await htmlToImage.toBlob(target, opts); } catch (e) { blob = await htmlToImage.toBlob(target, { ...opts, skipFonts: true }); }
        if (!blob) throw new Error('產生圖片失敗');
        const name = `貼文廚房-${state.order.orderNo}-${i + 1}.png`;
        const file = new File([blob], name, { type: 'image/png' });
        if (isTouch() && navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: '貼文廚房' }).catch(() => {});
        } else {
            downloadBlob(blob, name);
            toast('已存成圖片', 'success');
        }
    } catch (e) {
        console.error(e);
        toast('存圖失敗，請改用截圖', 'error');
    } finally {
        el.disabled = false;
        el.innerHTML = label;
    }
};

// ===== 準備發文（臉書） =====
async function openPublish(el) {
    const i = Number(el.dataset.i);
    const o = state.order;
    const item = o?.items[i];
    if (!item) return;
    const bitmaps = [];
    for (const b of o.images || []) {
        try { bitmaps.push(await toBitmap(b)); } catch (e) { /* 略過壞檔 */ }
    }
    state.publish = { i, ratio: 'original', pos: 50, bitmaps };
    $('crop-pos').value = 50;
    $('publish-photo-count').textContent = bitmaps.length ? `（${bitmaps.length} 張，套用同一比例）` : '（這張舊單沒有照片）';
    $('ratio-btns').innerHTML = RATIOS.map(r => `<button type="button" data-action="setRatio" data-v="${r.id}" class="${r.id === 'original' ? 'active' : ''}">${r.name}</button>`).join('');
    renderAltTexts();
    const hasTr = !!(o.language && item.versions[item.idx].translation);
    $('include-translation-wrap').classList.toggle('hidden', !hasTr);
    $('include-translation').checked = false;
    renderPublishCaption();
    const canShareFiles = isTouch() && !!navigator.canShare;
    $('share-fb-label').textContent = canShareFiles ? '分享到臉書（手機分享選單）' : '複製文案並開啟臉書';
    $('publish-hint').textContent = canShareFiles
        ? '會先把文案複製起來，再打開分享選單（選 Facebook）。臉書通常不會自動帶入文字，進到發文畫面後在輸入框長按「貼上」即可。'
        : '電腦版：會複製文案並開啟臉書；照片請按「下載照片」後拖進臉書的發文框。';
    $('publish-modal').classList.remove('hidden');
    drawCropPreview();
}
actions.openPublish = openPublish;

function closePublish() {
    $('publish-modal').classList.add('hidden');
    state.publish?.bitmaps.forEach(b => b.close?.());
    state.publish = null;
}
actions.closePublish = closePublish;

function renderAltTexts() {
    const alts = state.order?.altTexts || [];
    $('alt-list').innerHTML = alts.length
        ? alts.map((t, k) => `
            <div class="flex gap-2 items-start">
                <span class="mono text-xs text-[color:var(--ink-3)] pt-0.5 shrink-0">No.${k + 1}</span>
                <p class="flex-1">${escapeHtml(t)}</p>
                <button type="button" data-action="copyAlt" data-i="${k}" class="btn-line px-2 py-1 text-xs shrink-0">${ic('copy')}</button>
            </div>`).join('')
        : '<p class="text-[color:var(--ink-3)] text-xs">這張單沒有替代文字（舊版訂單或尚未產生）。</p>';
}

actions.copyAlt = async el => {
    const t = state.order?.altTexts?.[Number(el.dataset.i)];
    if (!t) return;
    toast((await copyText(t)) ? '已複製替代文字' : '複製失敗', 'success');
};

function publishText() {
    const o = state.order;
    const item = o?.items[state.publish?.i];
    if (!item) return '';
    const v = item.versions[item.idx];
    return $('include-translation').checked && v.translation ? `${v.caption}\n\n${v.translation}` : v.caption;
}
function renderPublishCaption() { $('publish-caption').textContent = publishText(); }

actions.setRatio = el => {
    if (!state.publish) return;
    state.publish.ratio = el.dataset.v;
    state.publish.pos = 50;
    $('crop-pos').value = 50;
    [...$('ratio-btns').children].forEach(b => b.classList.toggle('active', b.dataset.v === el.dataset.v));
    drawCropPreview();
};

// 依比例與位置算出裁切框（位置 0–100：沿著可移動的方向）
function cropRect(w, h, ratio, pos) {
    if (!ratio) return { sx: 0, sy: 0, sw: w, sh: h, axis: null };
    const t = pos / 100;
    if (w / h > ratio) {
        const sw = Math.round(h * ratio);
        return { sx: Math.round((w - sw) * t), sy: 0, sw, sh: h, axis: 'x' };
    }
    const sh = Math.round(w / ratio);
    return { sx: 0, sy: Math.round((h - sh) * t), sw: w, sh, axis: 'y' };
}

function drawCropPreview() {
    const p = state.publish;
    const canvas = $('crop-canvas');
    const bmp = p?.bitmaps[0];
    if (!bmp) { canvas.width = 1; canvas.height = 1; $('crop-pos-wrap').classList.add('hidden'); return; }
    const ratio = RATIOS.find(r => r.id === p.ratio)?.value || null;
    const r = cropRect(bmp.width, bmp.height, ratio, p.pos);
    const scale = Math.min(1, 640 / Math.max(r.sw, r.sh));
    canvas.width = Math.round(r.sw * scale);
    canvas.height = Math.round(r.sh * scale);
    canvas.getContext('2d').drawImage(bmp, r.sx, r.sy, r.sw, r.sh, 0, 0, canvas.width, canvas.height);
    $('crop-pos-wrap').classList.toggle('hidden', !r.axis);
    $('crop-pos-label').textContent = r.axis === 'x' ? '左右位置' : '上下位置';
}

async function croppedPhotos() {
    const p = state.publish;
    if (!p) return [];
    const ratio = RATIOS.find(r => r.id === p.ratio)?.value || null;
    const out = [];
    for (let k = 0; k < p.bitmaps.length; k++) {
        const bmp = p.bitmaps[k];
        const r = cropRect(bmp.width, bmp.height, ratio, p.pos);
        const scale = Math.min(1, 2048 / Math.max(r.sw, r.sh));
        const c = document.createElement('canvas');
        c.width = Math.round(r.sw * scale);
        c.height = Math.round(r.sh * scale);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp, r.sx, r.sy, r.sw, r.sh, 0, 0, c.width, c.height);
        const blob = await canvasToJpeg(c, 4 * 1024 * 1024);
        out.push(new File([blob], `貼文廚房-${state.order.orderNo}-照片${k + 1}.jpg`, { type: 'image/jpeg' }));
    }
    return out;
}

actions.copyPublishText = async () => {
    toast((await copyText(publishText())) ? '已複製文案' : '複製失敗，請手動選取', 'success');
};

actions.downloadPublishPhotos = async el => {
    const files = await croppedPhotos();
    if (!files.length) return toast('這張單沒有照片', 'error');
    files.forEach((f, k) => setTimeout(() => downloadBlob(f, f.name), k * 300));
    toast(`已下載 ${files.length} 張照片`, 'success');
};

actions.shareToFacebook = async el => {
    const text = publishText();
    const copied = await copyText(text);
    const files = await croppedPhotos();
    if (isTouch() && navigator.canShare && files.length && navigator.canShare({ files })) {
        try {
            await navigator.share({ files, text, title: '貼文廚房' });
            toast(copied ? '文案已複製；臉書沒帶入文字的話，長按輸入框貼上' : '已開啟分享', 'success');
        } catch (e) {
            if (e.name !== 'AbortError') toast('分享失敗，請改用下載照片', 'error');
        }
        return;
    }
    window.open('https://www.facebook.com/', '_blank', 'noopener');
    toast(copied ? '文案已複製，照片請先下載後拖進臉書發文框' : '複製失敗，請手動複製文案', copied ? 'success' : 'error');
};

// ===== 複製 =====
async function copyText(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) { /* 改用備用方法 */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
}

actions.copyCaption = async el => {
    const item = state.order?.items[Number(el.dataset.i)];
    if (!item) return;
    const v = item.versions[item.idx];
    const ok = await copyText(v.caption);
    if (!ok) return toast('複製失敗，請手動選取', 'error');
    const span = el.querySelector('span');
    span.textContent = '已複製';
    setTimeout(() => { span.textContent = '複製'; }, 1800);
    toast('已複製到剪貼簿', 'success');
};

actions.copyAll = async () => {
    const o = state.order;
    if (!o) return;
    const text = o.items.map(it => {
        const v = it.versions[it.idx];
        return (it.style ? `【${it.style}】\n` : '') + v.caption + (v.translation ? `\n\n${v.translation}` : '');
    }).join('\n\n———\n\n');
    const ok = await copyText(text);
    toast(ok ? `已複製全部 ${o.items.length} 則` : '複製失敗，請手動選取', ok ? 'success' : 'error');
};

// ===== 訂單紀錄 =====
function orderFromHistory(h) {
    const items = (h.captions || []).map(c => {
        if (typeof c === 'string') return { style: '', versions: [{ caption: c, translation: '' }], idx: 0, busy: false, fav: false };
        let versions = Array.isArray(c.versions) ? c.versions.filter(v => v && typeof v.caption === 'string' && v.caption) : [];
        if (!versions.length) versions = [{ caption: c.caption || '', translation: c.translation || '' }];
        const idx = Number.isInteger(c.idx) && c.idx >= 0 && c.idx < versions.length ? c.idx : versions.length - 1;
        return { style: c.style || '', versions, idx, busy: false, fav: !!c.fav };
    });
    return {
        historyId: h.id,
        orderNo: h.orderNo || String(h.id).slice(-4),
        model: h.model,
        platform: PLATFORMS[h.platform] ? h.platform : 'general',
        language: LANGUAGES[h.language] !== undefined ? h.language : '',
        timestamp: h.timestamp,
        analysis: h.imageAnalysis || null,
        altTexts: Array.isArray(h.altTexts) ? h.altTexts : [],
        context: { description: h.description || '', placeInfo: h.placeInfo || null, rating: h.rating || 0 },
        cost: typeof h.cost === 'number' ? h.cost : undefined,
        images: [],
        photoUrls: [],
        items
    };
}

function orderToHistory(o) {
    return {
        id: o.historyId,
        orderNo: o.orderNo,
        timestamp: o.timestamp,
        description: o.context?.description || '',
        placeInfo: o.context?.placeInfo || null,
        rating: o.context?.rating || 0,
        platform: o.platform,
        language: o.language || '',
        model: o.model,
        cost: o.cost,
        imageAnalysis: o.analysis,
        altTexts: o.altTexts || [],
        captions: o.items.filter(it => it.versions[0].caption).map(it => {
            const versions = it.versions.filter(v => v.caption);
            const idx = Math.min(it.idx, versions.length - 1);
            return { style: it.style, caption: versions[idx].caption, versions, idx, fav: !!it.fav };
        })
    };
}

function storeHistory() {
    state.history.sort((a, b) => (b.id || 0) - (a.id || 0));
    const dropped = state.history.slice(HISTORY_LIMIT);
    state.history = state.history.slice(0, HISTORY_LIMIT);
    save(STORAGE_KEYS.history, state.history);
    dropped.forEach(h => idbDelete(h.id));
    updateHistoryButton();
}

function saveOrder(o, isNew = false) {
    if (!o || o.streaming) return;
    const entry = orderToHistory(o);
    const at = state.history.findIndex(h => h.id === entry.id);
    if (at > -1) state.history[at] = entry;
    else if (isNew) state.history.unshift(entry);
    else return;
    storeHistory();
}

async function persistPhotos(o) {
    if (!('indexedDB' in window) || !o.images?.length) return;
    const copies = await Promise.all(o.images.map(storeCopy));
    await idbPut(o.historyId, copies);
    const keep = new Set([...state.history.map(h => h.id), o.historyId, DRAFT_PHOTOS]);
    for (const k of await idbKeys()) if (!keep.has(k)) idbDelete(k);
}

// 記住出餐區目前顯示的是哪張單；出單中則把印到一半的內容也存起來
function rememberOrder(o, inFlight = false) {
    if (!o) return;
    save(STORAGE_KEYS.current, inFlight ? { id: o.historyId, partial: orderToHistory(o) } : { id: o.historyId });
}
let rememberTimer = null;
function rememberOrderSoon(o) {
    if (rememberTimer) return;
    rememberTimer = setTimeout(() => { rememberTimer = null; if (o.streaming) rememberOrder(o, true); }, 500);
}
function forgetOrder(o) {
    const cur = load(STORAGE_KEYS.current);
    if (cur && (!o || cur.id === o.historyId)) remove(STORAGE_KEYS.current);
}

async function restoreCurrentOrder() {
    const cur = load(STORAGE_KEYS.current);
    if (!cur || !cur.id) return;
    let entry = state.history.find(h => h.id === cur.id);
    const interrupted = !entry && cur.partial;
    if (interrupted) {
        entry = cur.partial;
        if (!entry.captions?.length) { remove(STORAGE_KEYS.current); return; }
        // 被打斷的單也放進訂單紀錄，之後可以照常微調、重做
        state.history.unshift(entry);
        storeHistory();
        save(STORAGE_KEYS.current, { id: entry.id });
    }
    if (!entry) { remove(STORAGE_KEYS.current); return; }
    const o = orderFromHistory(entry);
    const blobs = await idbGet(entry.id);
    if (Array.isArray(blobs) && blobs.length) {
        o.images = blobs;
        o.photoUrls = blobs.map(b => URL.createObjectURL(b));
    }
    state.order = o;
    renderOrder(false, false);
    if (interrupted) toast('上次出單被重新整理打斷，已保留印好的部分；可以按「整單重做」或「重做這道」', 'info');
}

function updateHistoryButton() {
    $('history-btn').classList.toggle('hidden', state.history.length === 0);
    $('history-count').textContent = state.history.length;
}

function renderHistoryList() {
    const box = $('history-container');
    const favOnly = $('fav-only').checked;
    const rows = state.history.map((h, hi) => ({ h, hi, o: orderFromHistory(h) }))
        .filter(r => !favOnly || r.o.items.some(it => it.fav));
    if (!rows.length) {
        box.innerHTML = `<p class="text-center text-[color:var(--ink-3)] py-8 mono">— ${favOnly ? '還沒有收藏' : '目前沒有訂單'} —</p>`;
        return;
    }
    box.innerHTML = rows.map(({ h, hi, o }, n) => {
        const p = PLATFORMS[o.platform];
        const favs = o.items.filter(it => it.fav);
        return `
        <div class="py-3 flex gap-3 ${n ? 'border-t-[1.5px] border-dashed border-[color:var(--rule)]' : ''}">
            <div class="w-14 h-14 shrink-0 bg-[color:var(--paper-2)] rounded overflow-hidden flex items-center justify-center text-[color:var(--ink-3)]" data-thumb="${h.id}">${ic('image')}</div>
            <div class="min-w-0 flex-1">
                <div class="flex justify-between gap-2 mono text-xs text-[color:var(--ink-3)]">
                    <span class="truncate">#${escapeHtml(o.orderNo)}${o.context.placeInfo?.name ? ' · ' + escapeHtml(o.context.placeInfo.name) : ''}${p && o.platform !== 'general' ? ' · ' + p.name : ''}</span>
                    <span class="shrink-0">${escapeHtml(h.timestamp || '')}</span>
                </div>
                <p class="text-sm mt-1 line-clamp-2">${escapeHtml(o.context.description)}</p>
                <p class="mono text-xs mt-1 text-[color:var(--ink-2)]">${o.items.map(it => (it.fav ? '★' : '') + escapeHtml(it.style || '貼文')).join(' · ')}</p>
                ${favs.length ? `<p class="text-xs mt-1 line-clamp-2 text-[color:var(--ink-2)]">★ ${escapeHtml(favs[0].versions[favs[0].idx].caption)}</p>` : ''}
                <button data-action="loadHistoryItem" data-i="${hi}" class="btn-line text-xs px-3 py-1.5 mt-2">重新打開這張單</button>
            </div>
        </div>`;
    }).join('');
    for (const { h } of rows) {
        idbGet(h.id).then(blobs => {
            const el = box.querySelector(`[data-thumb="${h.id}"]`);
            if (el && Array.isArray(blobs) && blobs[0]) {
                const url = URL.createObjectURL(blobs[0]);
                el.innerHTML = `<img src="${url}" class="w-full h-full object-cover" alt="">`;
            }
        });
    }
}

actions.showHistory = () => { renderHistoryList(); $('history-modal').classList.remove('hidden'); };
function closeHistoryModal() { $('history-modal').classList.add('hidden'); }
actions.closeHistoryModal = closeHistoryModal;

actions.loadHistoryItem = async el => {
    const h = state.history[Number(el.dataset.i)];
    if (!h) return;
    closeHistoryModal();
    releaseOrder(state.order);
    const o = orderFromHistory(h);
    const blobs = await idbGet(h.id);
    if (Array.isArray(blobs) && blobs.length) {
        o.images = blobs;
        o.photoUrls = blobs.map(b => URL.createObjectURL(b));
    }
    state.order = o;
    rememberOrder(o);
    renderOrder(true);
};

actions.clearHistory = async () => {
    if (!confirm('確定要清除所有訂單紀錄（含照片）嗎？')) return;
    state.history = [];
    save(STORAGE_KEYS.history, []);
    for (const k of await idbKeys()) if (k !== DRAFT_PHOTOS) idbDelete(k);
    remove(STORAGE_KEYS.current);
    remove(STORAGE_KEYS.chatDrafts);
    closeHistoryModal();
    updateHistoryButton();
    toast('已清除訂單紀錄', 'success');
};

// 匯出／匯入（JSON 備份；不含照片）
actions.exportHistory = () => {
    const data = {
        app: 'post-kitchen',
        version: 1,
        exportedAt: new Date().toISOString(),
        history: state.history,
        voice: state.voice,
        hashtags: $('hashtags-input').value
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `貼文廚房備份-${new Date().toISOString().slice(0, 10)}.json`);
    toast('已匯出（不含照片）', 'success');
};
actions.importHistory = () => $('import-file').click();

async function importHistoryFile(file) {
    if (!file) return;
    try {
        const data = JSON.parse(await file.text());
        if (!data || data.app !== 'post-kitchen' || !Array.isArray(data.history)) throw new Error('不是貼文廚房的備份檔');
        const valid = data.history.filter(h => h && typeof h.id === 'number' && Array.isArray(h.captions));
        let added = 0;
        for (const h of valid) {
            if (state.history.some(x => x.id === h.id)) continue;
            state.history.push(h);
            added++;
        }
        storeHistory();
        if (typeof data.voice === 'string' && data.voice && !state.voice) {
            state.voice = data.voice.slice(0, 3000);
            save(STORAGE_KEYS.voice, state.voice);
            renderVoiceStatus();
        }
        if (typeof data.hashtags === 'string' && data.hashtags && !$('hashtags-input').value) {
            $('hashtags-input').value = data.hashtags.slice(0, 200);
            saveInputs();
        }
        renderHistoryList();
        toast(`匯入 ${added} 張單${valid.length - added ? `（${valid.length - added} 張已存在）` : ''}`, 'success');
    } catch (e) {
        toast(e.message || '匯入失敗', 'error');
    }
}

// ===== Toast =====
let toastTimer = null;
function toast(message, type = 'success') {
    const icons = {
        error: ic('warn', 'text-[color:var(--stamp)]'),
        info: ic('info', 'text-sky-600'),
        success: ic('ok', 'text-emerald-600')
    };
    $('toast-icon').innerHTML = icons[type] || icons.success;
    $('toast-message').textContent = message;
    $('toast').classList.remove('hide');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.add('hide'), type === 'error' ? 4500 : 2600);
}
