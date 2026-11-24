// 貼文廚房 · 兩個版本並排比較，挑一版來用
import { actions } from './base.js';
import { $, escapeHtml, state, toast } from './core.js';
import { renderTicket } from './order.js';
import { saveOrder } from './history.js';

function versionLabel(v, k) {
    const how = k === 0 ? '原版' : (v.instruction || '修改');
    return `v${k + 1} · ${how.length > 10 ? how.slice(0, 10) + '…' : how}`;
}

function renderCompare() {
    const c = state.compare;
    const item = state.order?.items[c?.i];
    if (!item) return;
    const options = sel => item.versions.map((v, k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${escapeHtml(versionLabel(v, k))}</option>`).join('');
    $('compare-a').innerHTML = options(c.a);
    $('compare-b').innerHTML = options(c.b);
    for (const side of ['a', 'b']) {
        const v = item.versions[c[side]];
        $(`compare-${side}-text`).textContent = v.caption;
        $(`compare-${side}-count`).textContent = `${[...v.caption].length} 字${c[side] === item.idx ? ' · 目前使用中' : ''}`;
        $(`compare-${side}-use`).disabled = c[side] === item.idx;
    }
}

actions.openCompare = el => {
    const i = Number(el.dataset.i);
    const item = state.order?.items[i];
    if (!item || item.versions.length < 2) return;
    const b = item.idx;
    const a = b > 0 ? b - 1 : 1;
    state.compare = { i, a, b };
    renderCompare();
    $('compare-title').textContent = `比較版本 · ${item.style || '貼文'}`;
    $('compare-modal').classList.remove('hidden');
};

export function closeCompare() { $('compare-modal').classList.add('hidden'); state.compare = null; }
actions.closeCompare = closeCompare;

export function onCompareSelect(side, value) {
    if (!state.compare) return;
    state.compare[side] = Number(value);
    renderCompare();
}

actions.useCompare = el => {
    const c = state.compare;
    const item = state.order?.items[c?.i];
    if (!item) return;
    item.idx = c[el.dataset.v];
    renderTicket(c.i);
    saveOrder(state.order);
    closeCompare();
    toast(`改用 v${item.idx + 1}`, 'success');
};
