// 貼文廚房 · 多組口吻、套餐（常用組合）、每月預算
import { actions } from './base.js';
import { $, LANGUAGES, PLATFORMS, STORAGE_KEYS, allStyles, escapeHtml, ic, load, remove, save, saveInputs, state, toast } from './core.js';
import { renderLanguages, renderPlatforms, renderStyles } from './form.js';

// ===== 多組口吻 =====
// state.voices：[{ id, name, text }]；state.voiceId：目前使用哪一組（'' = 不用）

export function restoreVoices() {
    const list = load(STORAGE_KEYS.voices, null);
    if (Array.isArray(list)) {
        state.voices = list.filter(v => v && v.id && typeof v.text === 'string').slice(0, 10);
    } else {
        // 舊版只有一組「我的口吻」→ 轉成第一組
        const legacy = load(STORAGE_KEYS.voice, '') || '';
        state.voices = legacy.trim() ? [{ id: 'v-legacy', name: '我的口吻', text: legacy }] : [];
        if (state.voices.length) save(STORAGE_KEYS.voices, state.voices);
        if (state.voices.length && load(STORAGE_KEYS.voiceOn, false)) save(STORAGE_KEYS.voiceId, 'v-legacy');
        remove(STORAGE_KEYS.voice);
        remove(STORAGE_KEYS.voiceOn);
    }
    const id = load(STORAGE_KEYS.voiceId, '');
    state.voiceId = state.voices.some(v => v.id === id) ? id : '';
}

function saveVoices() {
    save(STORAGE_KEYS.voices, state.voices);
    save(STORAGE_KEYS.voiceId, state.voiceId);
}

export const activeVoice = () => state.voices.find(v => v.id === state.voiceId)?.text || '';

export function renderVoiceStatus() {
    const chips = [{ id: '', name: '不用' }, ...state.voices];
    $('voice-chips').innerHTML = chips.map(v => `
        <button type="button" class="${v.id === state.voiceId ? 'active' : ''}" data-action="selectVoice" data-v="${escapeHtml(v.id)}" role="radio" aria-checked="${v.id === state.voiceId}">${escapeHtml(v.name)}</button>`).join('')
        + (state.voices.length < 10 ? `<button type="button" data-action="newVoice">${ic('plus', 'mr-1')}新增</button>` : '');
    const active = state.voices.find(v => v.id === state.voiceId);
    $('voice-edit-btn').classList.toggle('hidden', !active);
    $('voice-status').textContent = active ? `模仿「${active.name}」（${active.text.length} 字範例）` : '不模仿，用一般寫法';
}

actions.selectVoice = el => {
    state.voiceId = el.dataset.v || '';
    saveVoices();
    renderVoiceStatus();
};

function openVoiceModal(voice) {
    state.editingVoiceId = voice ? voice.id : null;
    const draft = load(STORAGE_KEYS.voiceDraft, null);
    const useDraft = draft && typeof draft === 'object' && draft.id === state.editingVoiceId;
    $('voice-name').value = useDraft ? draft.name : (voice ? voice.name : '');
    $('voice-input').value = useDraft ? draft.text : (voice ? voice.text : '');
    $('voice-count').textContent = `${$('voice-input').value.length}/3000`;
    $('voice-title').textContent = voice ? '編輯口吻' : '新增口吻';
    $('voice-delete-btn').classList.toggle('hidden', !voice);
    $('voice-modal').classList.remove('hidden');
    setTimeout(() => (voice ? $('voice-input') : $('voice-name')).focus(), 50);
}

export function saveVoiceDraft() {
    save(STORAGE_KEYS.voiceDraft, { id: state.editingVoiceId, name: $('voice-name').value, text: $('voice-input').value });
}

actions.newVoice = () => openVoiceModal(null);
export function showVoiceModal() { openVoiceModal(state.voices.find(v => v.id === state.voiceId) || null); }
actions.showVoiceModal = showVoiceModal;
export function closeVoiceModal() { $('voice-modal').classList.add('hidden'); remove(STORAGE_KEYS.voiceDraft); }
actions.closeVoiceModal = closeVoiceModal;

actions.saveVoice = () => {
    const name = $('voice-name').value.trim().slice(0, 12) || '我的口吻';
    const text = $('voice-input').value.trim().slice(0, 3000);
    if (!text) return toast('貼幾篇你寫過的貼文當範例', 'error');
    const existing = state.voices.find(v => v.id === state.editingVoiceId);
    if (existing) {
        existing.name = name;
        existing.text = text;
    } else {
        const id = `v-${Date.now()}`;
        state.voices.push({ id, name, text });
        state.voiceId = id;
    }
    saveVoices();
    renderVoiceStatus();
    closeVoiceModal();
    toast(`之後的貼文會模仿「${name}」`, 'success');
};

actions.deleteVoice = () => {
    const v = state.voices.find(x => x.id === state.editingVoiceId);
    if (!v || !confirm(`刪除口吻「${v.name}」？`)) return;
    state.voices = state.voices.filter(x => x.id !== v.id);
    if (state.voiceId === v.id) state.voiceId = '';
    saveVoices();
    renderVoiceStatus();
    closeVoiceModal();
};

actions.clearVoice = () => { $('voice-input').value = ''; $('voice-count').textContent = '0/3000'; saveVoiceDraft(); };

// 匯入備份時合併口吻（同名的略過）
export function mergeVoices(list) {
    let added = 0;
    for (const v of Array.isArray(list) ? list : []) {
        if (!v || typeof v.text !== 'string' || !v.text.trim()) continue;
        if (state.voices.some(x => x.id === v.id || x.name === v.name) || state.voices.length >= 10) continue;
        state.voices.push({ id: v.id || `v-${Date.now()}-${added}`, name: String(v.name || '匯入的口吻').slice(0, 12), text: v.text.slice(0, 3000) });
        added++;
    }
    if (added) { saveVoices(); renderVoiceStatus(); }
    return added;
}

// ===== 套餐（常用組合） =====
// 一鍵套用：平台、單選／複選、品項、份數、Hashtag、外語、口吻

export function restorePresets() {
    const list = load(STORAGE_KEYS.presets, []);
    state.presets = Array.isArray(list) ? list.filter(p => p && p.id && p.name).slice(0, 12) : [];
}

function presetSummary(p) {
    const styles = (p.styles || []).map(k => allStyles()[k]?.name).filter(Boolean);
    return [
        PLATFORMS[p.platform]?.name,
        p.styleMode === 'single' ? `${styles[0] || ''}×${p.copies || 1}` : styles.join('、'),
        p.hashtags,
        p.language ? `附${LANGUAGES[p.language]}` : '',
        state.voices.find(v => v.id === p.voiceId)?.name
    ].filter(Boolean).join(' · ');
}

export function renderPresets() {
    const box = $('preset-chips');
    if (!state.presets.length) {
        box.innerHTML = '<span class="text-xs text-[color:var(--ink-3)]">還沒有套餐：把常用的平台、品項、Hashtag 存起來，下次一鍵套用</span>';
        return;
    }
    box.innerHTML = state.presets.map(p => `
        <span class="preset-chip" title="${escapeHtml(presetSummary(p))}">
            <button type="button" data-action="applyPreset" data-v="${escapeHtml(p.id)}">${ic('receipt', 'mr-1')}${escapeHtml(p.name)}</button>
            <button type="button" data-action="deletePreset" data-v="${escapeHtml(p.id)}" aria-label="刪除套餐「${escapeHtml(p.name)}」">${ic('x')}</button>
        </span>`).join('');
}

function currentAsPreset(name) {
    return {
        id: `p-${Date.now()}`,
        name,
        platform: state.platform,
        styleMode: state.styleMode,
        styles: [...state.styles],
        copies: state.copies,
        hashtags: $('hashtags-input').value.trim(),
        language: state.language,
        voiceId: state.voiceId
    };
}

actions.showSavePreset = () => {
    $('preset-name').value = '';
    $('preset-summary').textContent = presetSummary(currentAsPreset(''));
    $('preset-modal').classList.remove('hidden');
    setTimeout(() => $('preset-name').focus(), 50);
};
export function closePresetModal() { $('preset-modal').classList.add('hidden'); }
actions.closePresetModal = closePresetModal;

actions.savePreset = () => {
    const name = $('preset-name').value.trim().slice(0, 12);
    if (!name) return toast('幫套餐取個名字', 'error');
    if (state.presets.length >= 12) return toast('套餐最多 12 個', 'error');
    const existing = state.presets.findIndex(p => p.name === name);
    const preset = currentAsPreset(name);
    if (existing > -1) {
        if (!confirm(`已經有「${name}」，要用目前的設定覆蓋嗎？`)) return;
        preset.id = state.presets[existing].id;
        state.presets[existing] = preset;
    } else {
        state.presets.push(preset);
    }
    save(STORAGE_KEYS.presets, state.presets);
    closePresetModal();
    renderPresets();
    toast(`已存成套餐「${name}」`, 'success');
};

actions.applyPreset = el => {
    const p = state.presets.find(x => x.id === el.dataset.v);
    if (!p) return;
    const styles = allStyles();
    if (PLATFORMS[p.platform]) state.platform = p.platform;
    state.styleMode = p.styleMode === 'single' ? 'single' : 'multi';
    const valid = (p.styles || []).filter(k => styles[k]);
    if (valid.length) state.styles = valid;
    state.copies = Math.min(Math.max(Number(p.copies) || 1, 1), 3);
    $('hashtags-input').value = p.hashtags || '';
    state.language = LANGUAGES[p.language] !== undefined ? p.language : '';
    if (p.voiceId === '' || state.voices.some(v => v.id === p.voiceId)) {
        state.voiceId = p.voiceId;
        saveVoices();
    }
    renderPlatforms();
    renderStyles();
    renderLanguages();
    renderVoiceStatus();
    saveInputs();
    const missing = (p.styles || []).length - valid.length;
    toast(`已套用「${p.name}」${missing ? `（${missing} 個自訂品項已不存在）` : ''}`, 'success');
};

actions.deletePreset = el => {
    const p = state.presets.find(x => x.id === el.dataset.v);
    if (!p || !confirm(`刪除套餐「${p.name}」？`)) return;
    state.presets = state.presets.filter(x => x.id !== p.id);
    save(STORAGE_KEYS.presets, state.presets);
    renderPresets();
};

export function mergePresets(list) {
    let added = 0;
    for (const p of Array.isArray(list) ? list : []) {
        if (!p || !p.name || state.presets.some(x => x.id === p.id || x.name === p.name) || state.presets.length >= 12) continue;
        state.presets.push(p);
        added++;
    }
    if (added) { save(STORAGE_KEYS.presets, state.presets); renderPresets(); }
    return added;
}

// ===== 每月預算 =====
const monthKey = () => new Date().toISOString().slice(0, 7);

export function monthSpendUsd() {
    const m = load(STORAGE_KEYS.monthSpend, null);
    return m && m.month === monthKey() ? Number(m.usd) || 0 : 0;
}

export function addMonthSpend(usd) {
    const before = monthSpendUsd();
    const after = Math.round((before + usd) * 1e6) / 1e6;
    save(STORAGE_KEYS.monthSpend, { month: monthKey(), usd: after });
    const budget = Number(load(STORAGE_KEYS.budget, 0)) || 0;
    if (!budget) return;
    const twd = x => x * state.rate;
    for (const level of [1, 0.8]) {
        if (twd(before) < budget * level && twd(after) >= budget * level) {
            toast(level === 1 ? `本月已超過預算 NT$${budget}（約 NT$${twd(after).toFixed(0)}）` : `本月花費已達預算的 80%（約 NT$${twd(after).toFixed(0)} / ${budget}）`, 'error');
            break;
        }
    }
}

// 出單前：超過預算時先問一聲
export function budgetAllows() {
    const budget = Number(load(STORAGE_KEYS.budget, 0)) || 0;
    if (!budget) return true;
    const spent = monthSpendUsd() * state.rate;
    if (spent < budget) return true;
    return confirm(`本月已花約 NT$${spent.toFixed(0)}，超過你設的預算 NT$${budget}。\n仍要出單嗎？`);
}

export function renderBudget() {
    const budget = Number(load(STORAGE_KEYS.budget, 0)) || 0;
    $('budget-input').value = budget || '';
    const spent = monthSpendUsd() * state.rate;
    $('month-spend').textContent = `本月約 NT$${spent.toFixed(spent < 10 ? 2 : 0)}${budget ? ` / 預算 NT$${budget}` : '（未設預算）'}`;
    const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
    $('budget-bar').style.width = `${pct}%`;
    $('budget-bar').classList.toggle('over', pct >= 80);
    $('budget-bar-wrap').classList.toggle('hidden', !budget);
}

export function saveBudgetInput() {
    const v = Math.max(0, Math.round(Number($('budget-input').value) || 0));
    save(STORAGE_KEYS.budget, v);
}
