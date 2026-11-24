// 貼文廚房 · 發文前檢查：錯字、語句、容易過時的資訊、事實、平台限制
import * as K from '../kitchen.js';
import { actions } from './base.js';
import { $, CHEAP_MODEL, addSpend, escapeHtml, fmtUsd, ic, state, toast, withClaude } from './core.js';
import { requireKey, showKeyModal } from './settings.js';
import { renderTicket } from './order.js';
import { saveOrder } from './history.js';

const TYPE_STYLE = {
    '錯字': 'bg-[color:var(--stamp-soft)] text-[#8f2a1b]',
    '語句': 'bg-amber-100 text-amber-900',
    '可能過時': 'bg-sky-100 text-sky-900',
    '事實': 'bg-violet-100 text-violet-900',
    '平台限制': 'bg-stone-200 text-stone-800',
    '其他': 'bg-stone-200 text-stone-800'
};

function showCheckModal(html) {
    $('check-body').innerHTML = html;
    $('check-modal').classList.remove('hidden');
}
export function closeCheck() { $('check-modal').classList.add('hidden'); state.check = null; }
actions.closeCheck = closeCheck;

actions.checkTicket = async el => {
    const i = Number(el.dataset.i);
    const o = state.order;
    const item = o?.items[i];
    if (!item || item.busy || item.streaming) return;
    const v = item.versions[item.idx];

    // 先跑不用 AI 的檢查；沒有 Key 也能看到這部分
    const local = K.localChecks(v.caption, o.platform);
    if (!state.apiKey) {
        if (!local.length) { requireKey(); return; }
        state.check = { i, issues: local, fixed: v.caption, changed: false };
        renderCheck('（未設定 API Key，只做了基本檢查）');
        return;
    }
    if (!requireKey()) return;

    state.check = { i, loading: true };
    showCheckModal(`<p class="text-sm flex items-center gap-2">${ic('spinner', 'spin')}小編正在校稿…</p>`);
    try {
        const r = await withClaude(client => K.checkCaption(client, {
            model: state.cheapRefine ? CHEAP_MODEL : state.model,
            caption: v.caption,
            platform: o.platform,
            placeInfo: o.context?.placeInfo || null,
            imageAnalysis: o.analysis
        }));
        addSpend(r.cost);
        if (!state.check || state.check.i !== i) return;
        state.check = { i, issues: r.issues, fixed: r.fixedCaption, changed: r.changed, cost: r.cost };
        renderCheck();
    } catch (e) {
        console.error(e);
        closeCheck();
        toast(e.message || '檢查失敗，請稍後再試', 'error');
        if (/API Key/.test(e.message || '')) showKeyModal();
    }
};

function renderCheck(note = '') {
    const c = state.check;
    if (!c) return;
    const list = c.issues.length
        ? c.issues.map(x => `
            <li class="border-b border-dashed border-[color:var(--rule)] pb-2">
                <span class="text-xs font-bold px-2 py-0.5 rounded ${TYPE_STYLE[x.type] || TYPE_STYLE['其他']}">${escapeHtml(x.type)}</span>
                ${x.quote ? `<span class="text-sm ml-1">「${escapeHtml(x.quote)}」</span>` : ''}
                <p class="text-sm mt-1">${escapeHtml(x.note)}</p>
                ${x.suggestion ? `<p class="text-xs text-[color:var(--ink-2)] mt-0.5">建議：${escapeHtml(x.suggestion)}</p>` : ''}
            </li>`).join('')
        : `<li class="text-sm flex items-center gap-2">${ic('ok', 'text-emerald-600')}沒發現需要修改的地方，可以放心發文</li>`;
    showCheckModal(`
        ${note ? `<p class="text-xs text-[color:var(--ink-3)] mb-2">${escapeHtml(note)}</p>` : ''}
        <ul class="space-y-2">${list}</ul>
        ${c.changed ? `
            <p class="sec-title mt-4 mb-1">修正後的版本</p>
            <p class="text-sm whitespace-pre-wrap break-words bg-[color:var(--paper-2)] rounded p-3 max-h-56 overflow-y-auto">${escapeHtml(c.fixed)}</p>
            <button data-action="applyCheckFix" class="btn-ink w-full py-2.5 text-sm mt-3">${ic('check', 'mr-1')}套用修正（存成新版本）</button>` : ''}
        ${c.cost ? `<p class="mono text-[10px] text-[color:var(--ink-3)] mt-3 text-right">這次檢查約 ${fmtUsd(c.cost.usd)}</p>` : ''}`);
}

actions.applyCheckFix = () => {
    const c = state.check;
    const item = state.order?.items[c?.i];
    if (!item || !c.changed) return;
    const n = c.issues.filter(x => x.type !== '可能過時' && x.type !== '平台限制').length;
    item.versions.push({ caption: c.fixed, translation: item.versions[item.idx].translation || '', instruction: '發文前檢查修正', reply: `修正了 ${n || '幾'} 個地方` });
    item.idx = item.versions.length - 1;
    renderTicket(c.i);
    saveOrder(state.order);
    closeCheck();
    toast('已套用修正，舊版本還在，可以用 ‹ › 切回去', 'success');
};
