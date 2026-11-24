// 貼文廚房 · 設定：API Key、模型、匯率
import { $, MODELS, STORAGE_KEYS, actions, ic, remove, renderOrderCost, renderSpend, save, state, toast } from './core.js';
import { renderBudget, saveBudgetInput } from './profiles.js';
import { clientId, renderSyncStatus } from './sync.js';
import { checkBtnState } from './order.js';

// ===== 金鑰與設定 =====
export function maskKey(k) { return k.length > 16 ? `${k.slice(0, 10)}…${k.slice(-4)}` : '••••'; }

export function updateKeyStatus() {
    const model = MODELS.find(m => m.id === state.model);
    $('key-dot').className = `dot ${state.apiKey ? 'bg-emerald-400' : 'bg-red-400'}`;
    $('key-status').textContent = state.apiKey ? (model ? model.label.replace('Claude ', '') : '已設定') : '未設定 API Key';
}

export function renderModelOptions() {
    $('model-options').innerHTML = MODELS.map(m => `
        <div class="model-row" data-action="selectModel" data-v="${m.id}" role="radio" aria-checked="${m.id === state.pendingModel}" tabindex="0">
            <span class="menu-item ${m.id === state.pendingModel ? 'selected' : ''} !p-0 !w-auto"><span class="box">${ic('check')}</span></span>
            <span class="font-bold text-sm">${m.label}</span>
            <span class="flex-1 border-b-2 border-dotted border-[color:var(--rule)] -translate-y-1"></span>
            <span class="text-xs text-[color:var(--ink-3)]">${m.desc}</span>
        </div>`).join('');
}
actions.selectModel = el => { state.pendingModel = el.dataset.v; renderModelOptions(); };

export function setKeyEye(show) { $('key-eye').innerHTML = ic(show ? 'eye-off' : 'eye'); }

export function showKeyModal() {
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
    renderBudget();
    $('google-client-id').value = clientId();
    renderSyncStatus();
    $('key-modal').classList.remove('hidden');
    setTimeout(() => input.focus(), 50);
}
actions.showKeyModal = showKeyModal;

export function closeKeyModal() {
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

export function saveKey() {
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
    saveBudgetInput();
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

export function requireKey() {
    if (state.apiKey) return true;
    toast('請先設定 Claude API Key', 'error');
    showKeyModal();
    return false;
}
