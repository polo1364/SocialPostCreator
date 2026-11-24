// 貼文廚房 · 出單與出餐區：串流、收據、微調、重做
import * as K from '../kitchen.js';
import { budgetAllows } from './profiles.js';
import { $, CHEAP_MODEL, LANGUAGES, MODELS, PLATFORMS, QUICK_REFINES, STORAGE_KEYS, actions, addSpend, allStyles, escapeHtml, fmtUsd, ic, imagePayload, load, renderOrderCost, save, state, styleKeyByName, toast, withClaude } from './core.js';
import { requireKey, showKeyModal } from './settings.js';
import { activeHashtags, prepareImage } from './form.js';
import { activeVoice } from './profiles.js';
import { openPublish } from './publish.js';
import { forgetOrder, persistPhotos, rememberOrder, rememberOrderSoon, saveOrder } from './history.js';

// ===== 串流 =====
export async function streamCaption(opts, onPartial) {
    return withClaude(client => K.streamCaptions(client, { ...opts, model: state.model }, onPartial));
}

// ===== 出單 =====
export function checkBtnState() {
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

export function nextOrderNo() {
    const n = (Number(load(STORAGE_KEYS.orderNo, 0)) || 0) + 1;
    save(STORAGE_KEYS.orderNo, n);
    return String(n).padStart(4, '0');
}

export function releaseOrder(o) { (o?.photoUrls || []).forEach(u => URL.revokeObjectURL(u)); }

export function commonOpts(o) {
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

export async function generateCaption() {
    if (state.generating) return;
    if (!requireKey()) return;
    if (!state.files.length) return toast('請先放照片', 'error');
    const desc = $('user-desc').value.trim();
    if (!desc) return toast('請寫一下備註', 'error');
    if (!budgetAllows()) return;

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

export function applyPartial(order, partial) {
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

export function charCountHtml(text) {
    const len = [...text].length;
    const limit = PLATFORMS[state.order?.platform]?.limit;
    if (!limit) return `字數 ${len}`;
    return `<span class="${len > limit ? 'over-limit' : ''}">字數 ${len}/${limit}${len > limit ? ' 超過上限' : ''}</span>`;
}

export function updateTicketBody(i) {
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
export function renderOrder(animate = false, scroll = true) {
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

export function renderAnalysis(a) {
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

export function chatDraftKey(i) { return `${state.order?.historyId}-${i}`; }
export function getChatDraft(i) { return (load(STORAGE_KEYS.chatDrafts, {}) || {})[chatDraftKey(i)] || ''; }
export function setChatDraft(i, text) {
    const all = load(STORAGE_KEYS.chatDrafts, {}) || {};
    if (text) all[chatDraftKey(i)] = text; else delete all[chatDraftKey(i)];
    const keys = Object.keys(all);
    if (keys.length > 50) keys.slice(0, keys.length - 50).forEach(k => delete all[k]);
    save(STORAGE_KEYS.chatDrafts, all);
}

export function renderTicket(i) {
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
                        ${total > 1 ? `<button class="ver-btn !w-auto px-1.5" data-action="openCompare" data-i="${i}" ${locked ? 'disabled' : ''} title="兩個版本並排比較">比較</button>` : ''}
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
            <button type="button" data-action="checkTicket" data-i="${i}" ${locked ? 'disabled' : ''} title="檢查錯字、容易過時的資訊與平台限制">${ic('check', 'mr-1')}發文前檢查</button>
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

export async function refineCaption(i, instruction) {
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
