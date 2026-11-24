// 貼文廚房 · 點單表：照片、品項、平台、口吻、店家
import * as K from '../kitchen.js';
import { $, ALLOWED_TYPES, DEFAULT_PLATFORM, DRAFT_PHOTOS, LANGUAGES, MAX_BYTES, MAX_EDGE, MAX_PHOTOS, MAX_STYLES, PLATFORMS, RATING_TEXTS, STORAGE_KEYS, STORE_EDGE, actions, addSpend, allStyles, escapeHtml, fmtUsd, ic, idbDelete, idbGet, idbPut, load, remove, save, saveInputs, state, toast, withClaude } from './core.js';
import { requireKey } from './settings.js';
import { checkBtnState } from './order.js';
import { renderVoiceStatus, saveVoices } from './profiles.js';

// ===== 點單選項 =====
export function updateDescCount() { $('desc-count').textContent = `${$('user-desc').value.length}/1000`; }

export function renderStars() {
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

export function renderPlatforms() {
    $('platform-chips').innerHTML = Object.entries(PLATFORMS).map(([key, p]) => `
        <button type="button" class="${key === state.platform ? 'active' : ''}" data-action="setPlatform" data-v="${key}" role="radio" aria-checked="${key === state.platform}">${ic(p.icon, 'mr-1')}${p.name}</button>`).join('');
    $('platform-hint').textContent = PLATFORMS[state.platform].hint;
}
actions.setPlatform = el => { state.platform = PLATFORMS[el.dataset.v] ? el.dataset.v : DEFAULT_PLATFORM; renderPlatforms(); saveInputs(); };

export function renderLanguages() {
    $('language-chips').innerHTML = Object.entries(LANGUAGES).map(([key, name]) => `
        <button type="button" class="${key === state.language ? 'active' : ''}" data-action="setLanguage" data-v="${key}">${name}</button>`).join('');
}
actions.setLanguage = el => { state.language = el.dataset.v; renderLanguages(); saveInputs(); };

export function renderStyles() {
    const single = state.styleMode === 'single';
    if (single && state.styles.length > 1) state.styles = state.styles.slice(0, 1);
    $('mode-single').classList.toggle('active', single);
    $('mode-multi').classList.toggle('active', !single);
    $('style-chips').innerHTML = Object.entries(allStyles()).map(([key, st]) => {
        const on = state.styles.includes(key);
        return `
        <div class="flex items-center">
            <button type="button" class="menu-item ${on ? 'selected' : ''}" data-action="toggleStyle" data-v="${key}" aria-checked="${on}" role="${single ? 'radio' : 'checkbox'}">
                <span class="box ${single ? '!rounded-full' : ''}">${ic('check')}</span>
                <span class="name">${escapeHtml(st.name)}</span><span>${escapeHtml(st.emoji)}</span>
                <span class="leader"></span>
                <span class="tag">${escapeHtml(st.tag)}</span>
            </button>
            ${st.custom ? `<button type="button" data-action="deleteCustomStyle" data-v="${key}" class="w-7 h-7 shrink-0 text-[color:var(--ink-3)] hover:text-[color:var(--stamp)]" title="刪除這個自訂品項">${ic('x')}</button>` : ''}
        </div>`;
    }).join('');
    const names = state.styles.map(k => allStyles()[k]?.name).filter(Boolean);
    $('style-hint').textContent = single ? '選 1 種風格' : `可勾 1–${MAX_STYLES} 種 · ${state.styles.length}/${MAX_STYLES}`;
    $('blend-note').textContent = !single && names.length > 1 ? '勾選的風格會融合成一則' : '';
    $('order-summary').textContent = names.length > 1 ? `1 則（${names.join('＋')}）` : `1 則${names[0] ? `（${names[0]}）` : ''}`;
}

actions.setStyleMode = el => {
    state.styleMode = el.dataset.v === 'single' ? 'single' : 'multi';
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
            if (state.styles.length <= 1) return toast('至少要選 1 種風格', 'error');
            state.styles.splice(i, 1);
        } else {
            if (state.styles.length >= MAX_STYLES) return toast(`最多融合 ${MAX_STYLES} 種風格`, 'error');
            state.styles.push(key);
        }
    }
    renderStyles();
    checkBtnState();
    saveInputs();
};

// 自訂品項
export function showCustomStyle() {
    $('custom-style-name').value = '';
    $('custom-style-emoji').value = '';
    $('custom-style-desc').value = '';
    $('custom-style-modal').classList.remove('hidden');
    setTimeout(() => $('custom-style-name').focus(), 50);
}
actions.showCustomStyle = showCustomStyle;
export function closeCustomStyle() { $('custom-style-modal').classList.add('hidden'); }
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

export const activeHashtags = () => $('hashtags-input').value.trim();

// ===== 照片 =====
actions.openPicker = () => $('file-upload').click();

// 點單用的照片存在 IndexedDB，重新整理後還在
export let draftTimer = null;
export function saveDraftPhotos() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
        if (state.files.length) idbPut(DRAFT_PHOTOS, state.files.map(f => f.file));
        else idbDelete(DRAFT_PHOTOS);
    }, 150);
}

export async function restoreDraftPhotos() {
    const files = await idbGet(DRAFT_PHOTOS);
    if (!Array.isArray(files) || !files.length || state.files.length) return;
    state.files = files.filter(f => f && f.size).slice(0, MAX_PHOTOS).map(f => ({ file: f, url: URL.createObjectURL(f) }));
    renderPhotos();
}

export function addImages(fileList) {
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

export function renderPhotos() {
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

export function setupDragDrop() {
    const box = $('upload-box');
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => box.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
    ['dragenter', 'dragover'].forEach(ev => box.addEventListener(ev, () => box.classList.add('dragover')));
    ['dragleave', 'drop'].forEach(ev => box.addEventListener(ev, () => box.classList.remove('dragover')));
    box.addEventListener('drop', e => addImages(e.dataTransfer.files));
}

export async function toBitmap(blob) {
    return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

export async function canvasToJpeg(canvas, maxBytes) {
    let blob = null;
    for (const q of [0.92, 0.85, 0.75, 0.65]) {
        blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', q));
        if (blob && (!maxBytes || blob.size <= maxBytes)) break;
    }
    return blob;
}

// 縮圖：長邊超過 maxEdge 就縮小並校正方向；檔案太大就降品質；符合條件的原檔直接用
export async function resizeImage(file, maxEdge, maxBytes) {
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
export const prepareImage = file => resizeImage(file, MAX_EDGE, MAX_BYTES).catch(() => file);
export const storeCopy = blob => resizeImage(blob, STORE_EDGE, 900 * 1024).catch(() => blob);

// ===== 店家 / 景點 =====
export function setPlaceType(type, persist = true) {
    state.placeType = type;
    $('type-store-btn').classList.toggle('active', type === 'store');
    $('type-attraction-btn').classList.toggle('active', type === 'attraction');
    $('place-name').placeholder = type === 'store' ? '店家名稱' : '景點名稱';
    if (persist) saveInputs();
}
actions.setPlaceType = el => setPlaceType(el.dataset.v);

export async function searchPlace() {
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

export function displayPlaceInfo(info) {
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

// ===== 清除點單：自己填的全部清掉、選項回到預設（自訂品項、口吻、套餐本身保留） =====
const DEFAULT_STYLES = ['humorous', 'warm', 'foodie'];
actions.clearOrderForm = () => {
    if (!confirm("要清除全部填寫的內容嗎？\n照片、備註、店家、評分、平台、品項、口吻、Hashtag、外語都會回到預設。")) return;
    state.files.forEach(f => URL.revokeObjectURL(f.url));
    state.files = [];
    renderPhotos();
    saveDraftPhotos();
    $("user-desc").value = "";
    updateDescCount();
    state.rating = 0;
    renderStars();
    state.platform = DEFAULT_PLATFORM;
    renderPlatforms();
    state.styleMode = "multi";
    state.styles = [...DEFAULT_STYLES];
    renderStyles();
    $("hashtags-input").value = "";
    state.hashtags = "";
    state.language = "";
    renderLanguages();
    state.voiceId = "";
    saveVoices();
    renderVoiceStatus();
    setPlaceType("store", false);
    actions.clearPlaceInfo();
    checkBtnState();
    toast("已全部清除", "success");
    $("order-form").scrollIntoView({ behavior: "smooth", block: "start" });
};

actions.clearPlaceInfo = () => {
    state.placeInfo = null;
    $('place-info-container').classList.add('hidden');
    $('place-name').value = '';
    $('place-location').value = '';
    saveInputs();
};
