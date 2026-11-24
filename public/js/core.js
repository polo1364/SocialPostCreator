// 貼文廚房 · 共用：常數、狀態、儲存、事件委派、費用、複製、提示訊息
import { actions } from './base.js';
export { actions };
import { addMonthSpend } from './profiles.js';
import * as K from '../kitchen.js';
import { displayPlaceInfo, setPlaceType } from './form.js';

// 官方 Anthropic SDK（瀏覽器版），第一次用到時才載入
export const SDK_URL = 'https://esm.sh/@anthropic-ai/sdk@1.11.0';
export let sdkPromise = null;
export function loadSdk() {
    if (!sdkPromise) {
        sdkPromise = import(SDK_URL).then(m => m.default || m.Anthropic).catch(() => {
            sdkPromise = null;
            throw new Error('無法載入 Claude 工具，請檢查網路後再試');
        });
    }
    return sdkPromise;
}

// 呼叫 Claude 的共用包裝：錯誤一律轉成中文訊息，並把已花的費用記上
export async function withClaude(fn) {
    const Anthropic = await loadSdk();
    const client = K.createClient(Anthropic, state.apiKey);
    try {
        return await fn(client);
    } catch (e) {
        if (e && e.cost) addSpend(e.cost);
        throw new Error(K.toUserError(e, Anthropic));
    }
}

export async function toBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

export function imagePayload(blobs) {
    return Promise.all(blobs.map(async b => ({ mediaType: ALLOWED_TYPES.includes(b.type) ? b.type : 'image/jpeg', data: await toBase64(b) })));
}

// ===== 常數 =====
export const MODELS = [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', desc: '速度與品質平衡，推薦' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', desc: '文筆最好，費用較高' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', desc: '最快、最便宜' }
];
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const CHEAP_MODEL = 'claude-haiku-5-5';

export const STYLES = {
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
export const MAX_STYLES = 6;

// 內建＋自訂品項
export function allStyles() {
    const custom = Object.fromEntries(Object.entries(state.customStyles || {}).map(([k, v]) => [k, { name: v.name, emoji: v.emoji || '✍️', tag: '自訂', custom: true }]));
    return { ...STYLES, ...custom };
}
export function styleKeyByName(name) {
    return Object.entries(allStyles()).find(([, v]) => v.name === name)?.[0] || null;
}

export const PLATFORMS = {
    facebook: { name: '臉書', icon: 'facebook', hint: '完整有故事性，像跟朋友分享；Hashtag 0–3 個' },
    instagram: { name: 'IG', icon: 'instagram', hint: '首行抓眼球、段落空行、文末 5–10 個 Hashtag', limit: 2200 },
    threads: { name: 'Threads', icon: 'threads', hint: '口語短句，上限 500 字', limit: 500 },
    xiaohongshu: { name: '小紅書', icon: 'book', hint: '吸睛標題＋分段 Emoji＋文末 Hashtag', limit: 1000 },
    general: { name: '不指定', icon: 'comment', hint: '一般社群寫法，每則約 50–200 字' }
};
export const DEFAULT_PLATFORM = 'facebook';

export const LANGUAGES = { '': '不用', en: '英文', ja: '日文', ko: '韓文' };

// 臉書常用比例
export const RATIOS = [
    { id: 'original', name: '原圖', value: null },
    { id: '1:1', name: '方形 1:1', value: 1 },
    { id: '4:5', name: '直式 4:5', value: 4 / 5 },
    { id: '1.91:1', name: '橫式 1.91:1', value: 1.91 },
    { id: '9:16', name: '限動 9:16', value: 9 / 16 }
];

export const QUICK_REFINES = ['再好笑一點', '短一點', '長一點', '更口語', '多點 Emoji', '少點 Emoji', '加 Hashtag', '更有質感', '加個問句結尾'];
export const RATING_TEXTS = { 1: '😞 失望', 2: '😕 普通偏下', 3: '😐 中規中矩', 4: '😊 不錯', 5: '🤩 超讚大推' };

export const STORAGE_KEYS = {
    apiKey: 'claude_api_key',
    model: 'claude_model',
    cheapRefine: 'post_creator_cheap_refine',
    rate: 'post_creator_rate',
    description: 'post_creator_description',
    styles: 'post_creator_styles',
    styleMode: 'post_creator_style_mode',
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
    voiceDraft: 'post_creator_voice_draft',
    voices: 'post_creator_voices',
    voiceId: 'post_creator_voice_id',
    presets: 'post_creator_presets',
    monthSpend: 'post_creator_month_spend',
    budget: 'post_creator_budget',
    extrasOpen: 'post_creator_extras_open'
};
export const DRAFT_PHOTOS = 'draft-photos';

export const HISTORY_LIMIT = 20;
export const MAX_PHOTOS = 5;
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
export const MAX_EDGE = 2576;
export const MAX_BYTES = 3.5 * 1024 * 1024;
export const STORE_EDGE = 1600;

// ===== 狀態 =====
export const state = {
    apiKey: null,
    model: DEFAULT_MODEL,
    pendingModel: DEFAULT_MODEL,
    cheapRefine: false,
    rate: 32,
    files: [], // [{ file, url }]
    placeInfo: null,
    placeType: 'store',
    styles: ['humorous', 'warm', 'foodie'],
    styleMode: 'multi', // single：單選一種；multi：複選 1–6 種，融合成一則
    customStyles: {},
    rating: 0,
    platform: DEFAULT_PLATFORM,
    voices: [], // [{ id, name, text }]
    voiceId: '',
    editingVoiceId: null,
    presets: [],
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

export const $ = id => document.getElementById(id);
export const ic = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="public/icons.svg#${name}"/></svg>`;

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

export function debounce(fn, wait) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

// ===== 儲存 =====
export function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('儲存失敗', e); }
}
export function load(key, fallback = null) {
    try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
}
export function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* 忽略 */ }
}

// IndexedDB：每張訂單的照片
export function idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('post-kitchen', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('photos');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
export async function idbRun(mode, fn) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('photos', mode);
        const req = fn(tx.objectStore('photos'));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
    });
}
export const idbPut = (key, value) => idbRun('readwrite', s => s.put(value, key)).catch(e => console.warn('照片存檔失敗', e));
export const idbGet = key => idbRun('readonly', s => s.get(key)).catch(() => null);
export const idbKeys = () => idbRun('readonly', s => s.getAllKeys()).catch(() => []);
export const idbDelete = key => idbRun('readwrite', s => s.delete(key)).catch(() => {});

export function saveInputs() {
    save(STORAGE_KEYS.description, $('user-desc').value);
    save(STORAGE_KEYS.styles, state.styles);
    save(STORAGE_KEYS.styleMode, state.styleMode);
    save(STORAGE_KEYS.rating, state.rating);
    save(STORAGE_KEYS.platform, state.platform);
    save(STORAGE_KEYS.hashtags, $('hashtags-input').value);
    save(STORAGE_KEYS.language, state.language);
    save(STORAGE_KEYS.placeType, state.placeType);
    save(STORAGE_KEYS.placeName, $('place-name').value);
    save(STORAGE_KEYS.placeLocation, $('place-location').value);
    if (state.placeInfo) save(STORAGE_KEYS.placeInfo, state.placeInfo);
    else remove(STORAGE_KEYS.placeInfo);
    updateExtrasSummary();
}

// 「加點（選填）」收合時，標題列直接顯示已經設定了哪些
export function updateExtrasSummary() {
    const el = $("extras-summary");
    if (!el) return;
    const place = state.placeInfo?.name || $("place-name").value.trim();
    const voice = state.voices.find(v => v.id === state.voiceId);
    const tags = $("hashtags-input").value.trim();
    const parts = [
        place && place.slice(0, 10),
        state.rating && "★".repeat(state.rating),
        voice && `口吻：${voice.name}`,
        tags && "Hashtag",
        state.language && `附${LANGUAGES[state.language]}`
    ].filter(Boolean);
    el.textContent = parts.length ? parts.join("・") : "店家、評分、口吻、Hashtag、外語";
    el.classList.toggle("set", parts.length > 0);
}

// 展開狀態記在瀏覽器；第一次用時，大螢幕預設展開、手機預設收合
export function setupExtras() {
    const d = $("extras");
    const saved = load(STORAGE_KEYS.extrasOpen, null);
    d.open = saved === null ? window.matchMedia("(min-width: 640px)").matches : !!saved;
    d.addEventListener("toggle", () => save(STORAGE_KEYS.extrasOpen, d.open));
    updateExtrasSummary();
}

export function restoreInputs() {
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
    remove('post_creator_copies');
    const styles = load(STORAGE_KEYS.styles);
    if (Array.isArray(styles)) {
        const valid = styles.filter(s => allStyles()[s]).slice(0, MAX_STYLES);
        if (valid.length >= 1) state.styles = valid;
    }
    const r = Number(load(STORAGE_KEYS.rating, 0));
    state.rating = r >= 0 && r <= 5 ? r : 0;
    const p = load(STORAGE_KEYS.platform, DEFAULT_PLATFORM);
    state.platform = PLATFORMS[p] ? p : DEFAULT_PLATFORM;
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

// ===== 費用 =====
export function fmtUsd(usd) {
    if (usd == null) return '—';
    return usd < 0.01 ? `US$${usd.toFixed(4)}` : `US$${usd.toFixed(3)}`;
}
export function fmtCost(usd) { return `${fmtUsd(usd)}（約 NT$${(usd * state.rate).toFixed(2)}）`; }

export function addSpend(cost) {
    if (!cost || typeof cost.usd !== 'number') return;
    const total = (Number(load(STORAGE_KEYS.spend, 0)) || 0) + cost.usd;
    save(STORAGE_KEYS.spend, Math.round(total * 1e6) / 1e6);
    addMonthSpend(cost.usd);
    const o = state.order;
    if (o && typeof o.cost === 'number') {
        o.cost = Math.round((o.cost + cost.usd) * 1e6) / 1e6;
        renderOrderCost();
    }
}
export function renderSpend() { $('spend-total').textContent = fmtCost(Number(load(STORAGE_KEYS.spend, 0)) || 0); }
actions.resetSpend = () => { save(STORAGE_KEYS.spend, 0); renderSpend(); };
export function renderOrderCost() {
    const o = state.order;
    $('result-cost').textContent = o && typeof o.cost === 'number' && o.cost > 0 ? `本單估算 ${fmtCost(o.cost)}` : '';
}

// ===== 複製 =====
export async function copyText(text) {
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

// ===== Toast =====
export let toastTimer = null;
export function toast(message, type = 'success') {
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
