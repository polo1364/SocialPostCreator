// 貼文廚房 · 訂單紀錄、重整還原、匯出匯入
import { $, DRAFT_PHOTOS, HISTORY_LIMIT, LANGUAGES, PLATFORMS, STORAGE_KEYS, actions, escapeHtml, ic, idbDelete, idbGet, idbKeys, idbPut, load, remove, save, saveInputs, state, toast } from './core.js';
import { scheduleAutoBackup } from './sync.js';
import { mergePresets, mergeVoices } from './profiles.js';
import { renderStyles } from './form.js';
import { storeCopy } from './form.js';
import { renderVoiceStatus } from './profiles.js';
import { releaseOrder, renderOrder } from './order.js';
import { downloadBlob } from './publish.js';

// ===== 訂單紀錄 =====
export function orderFromHistory(h) {
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

export function orderToHistory(o) {
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

export function storeHistory() {
    state.history.sort((a, b) => (b.id || 0) - (a.id || 0));
    const dropped = state.history.slice(HISTORY_LIMIT);
    state.history = state.history.slice(0, HISTORY_LIMIT);
    save(STORAGE_KEYS.history, state.history);
    dropped.forEach(h => idbDelete(h.id));
    updateHistoryButton();
    scheduleAutoBackup();
}

export function saveOrder(o, isNew = false) {
    if (!o || o.streaming) return;
    const entry = orderToHistory(o);
    const at = state.history.findIndex(h => h.id === entry.id);
    if (at > -1) state.history[at] = entry;
    else if (isNew) state.history.unshift(entry);
    else return;
    storeHistory();
}

export async function persistPhotos(o) {
    if (!('indexedDB' in window) || !o.images?.length) return;
    const copies = await Promise.all(o.images.map(storeCopy));
    await idbPut(o.historyId, copies);
    const keep = new Set([...state.history.map(h => h.id), o.historyId, DRAFT_PHOTOS]);
    for (const k of await idbKeys()) if (!keep.has(k)) idbDelete(k);
}

// 記住出餐區目前顯示的是哪張單；出單中則把印到一半的內容也存起來
export function rememberOrder(o, inFlight = false) {
    if (!o) return;
    save(STORAGE_KEYS.current, inFlight ? { id: o.historyId, partial: orderToHistory(o) } : { id: o.historyId });
}
export let rememberTimer = null;
export function rememberOrderSoon(o) {
    if (rememberTimer) return;
    rememberTimer = setTimeout(() => { rememberTimer = null; if (o.streaming) rememberOrder(o, true); }, 500);
}
export function forgetOrder(o) {
    const cur = load(STORAGE_KEYS.current);
    if (cur && (!o || cur.id === o.historyId)) remove(STORAGE_KEYS.current);
}

export async function restoreCurrentOrder() {
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

export function updateHistoryButton() {
    $('history-btn').classList.toggle('hidden', state.history.length === 0);
    $('history-count').textContent = state.history.length;
}

export function renderHistoryList() {
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
export function closeHistoryModal() { $('history-modal').classList.add('hidden'); }
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
// 備份內容（匯出檔與 Google 雲端備份共用；不含照片）
export function buildBackup() {
    return {
        app: 'post-kitchen',
        version: 1,
        exportedAt: new Date().toISOString(),
        history: state.history,
        voices: state.voices,
        presets: state.presets,
        customStyles: state.customStyles,
        hashtags: $('hashtags-input').value
    };
}

// 合併備份：已存在的訂單、口吻、套餐、自訂品項保留本機版本，只加入新的
export function applyBackup(data) {
    if (!data || data.app !== 'post-kitchen' || !Array.isArray(data.history)) throw new Error('不是貼文廚房的備份檔');
    const valid = data.history.filter(h => h && typeof h.id === 'number' && Array.isArray(h.captions));
    let added = 0;
    for (const h of valid) {
        if (state.history.some(x => x.id === h.id)) continue;
        state.history.push(h);
        added++;
    }
    storeHistory();
    // 口吻（新版是多組；舊版只有一段文字）
    const voices = Array.isArray(data.voices) ? data.voices : (typeof data.voice === 'string' && data.voice ? [{ id: 'v-imported', name: '匯入的口吻', text: data.voice }] : []);
    const voicesAdded = mergeVoices(voices);
    const presetsAdded = mergePresets(data.presets);
    if (data.customStyles && typeof data.customStyles === 'object') {
        for (const [k, v] of Object.entries(data.customStyles)) {
            if (/^custom-/.test(k) && v && v.name && !state.customStyles[k] && Object.keys(state.customStyles).length < 20) state.customStyles[k] = v;
        }
        save(STORAGE_KEYS.customStyles, state.customStyles);
        renderStyles();
    }
    if (typeof data.hashtags === 'string' && data.hashtags && !$('hashtags-input').value) {
        $('hashtags-input').value = data.hashtags.slice(0, 200);
        saveInputs();
    }
    return { added, existing: valid.length - added, voicesAdded, presetsAdded };
}

actions.exportHistory = () => {
    const data = buildBackup();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `貼文廚房備份-${new Date().toISOString().slice(0, 10)}.json`);
    toast('已匯出（不含照片）', 'success');
};
actions.importHistory = () => $('import-file').click();

export async function importHistoryFile(file) {
    if (!file) return;
    try {
        const r = applyBackup(JSON.parse(await file.text()));
        renderHistoryList();
        toast(`匯入 ${r.added} 張單${r.existing ? `（${r.existing} 張已存在）` : ''}`, 'success');
    } catch (e) {
        toast(e.message || '匯入失敗', 'error');
    }
}
