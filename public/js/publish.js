// 貼文廚房 · 存成圖片、準備發文（臉書）
import { $, RATIOS, actions, copyText, escapeHtml, ic, state, toast } from './core.js';
import { OVERLAY_POSITIONS, OVERLAY_STYLES, drawOverlay, ensureFonts } from './overlay.js';
import { canvasToJpeg, toBitmap } from './form.js';

// ===== 存成圖片 =====
export function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

export const isTouch = () => matchMedia('(pointer: coarse)').matches;

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
export async function openPublish(el) {
    const i = Number(el.dataset.i);
    const o = state.order;
    const item = o?.items[i];
    if (!item) return;
    const bitmaps = [];
    for (const b of o.images || []) {
        try { bitmaps.push(await toBitmap(b)); } catch (e) { /* 略過壞檔 */ }
    }
    const prevOverlay = state.publish?.overlay;
    state.publish = {
        i, ratio: 'original', pos: 50, bitmaps,
        overlay: { style: 'none', title: '', sub: o.context?.placeInfo?.name || '', position: 'bottom', all: false, ...(prevOverlay ? { style: prevOverlay.style, position: prevOverlay.position, all: prevOverlay.all } : {}) }
    };
    renderOverlayControls();
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

export function closePublish() {
    $('publish-modal').classList.add('hidden');
    state.publish?.bitmaps.forEach(b => b.close?.());
    state.publish = null;
}
actions.closePublish = closePublish;

export function renderAltTexts() {
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

export function publishText() {
    const o = state.order;
    const item = o?.items[state.publish?.i];
    if (!item) return '';
    const v = item.versions[item.idx];
    return $('include-translation').checked && v.translation ? `${v.caption}\n\n${v.translation}` : v.caption;
}
export function renderPublishCaption() { $('publish-caption').textContent = publishText(); }

actions.setRatio = el => {
    if (!state.publish) return;
    state.publish.ratio = el.dataset.v;
    state.publish.pos = 50;
    $('crop-pos').value = 50;
    [...$('ratio-btns').children].forEach(b => b.classList.toggle('active', b.dataset.v === el.dataset.v));
    drawCropPreview();
};

// 依比例與位置算出裁切框（位置 0–100：沿著可移動的方向）
export function cropRect(w, h, ratio, pos) {
    if (!ratio) return { sx: 0, sy: 0, sw: w, sh: h, axis: null };
    const t = pos / 100;
    if (w / h > ratio) {
        const sw = Math.round(h * ratio);
        return { sx: Math.round((w - sw) * t), sy: 0, sw, sh: h, axis: 'x' };
    }
    const sh = Math.round(w / ratio);
    return { sx: 0, sy: Math.round((h - sh) * t), sw: w, sh, axis: 'y' };
}

export function drawCropPreview() {
    const p = state.publish;
    const canvas = $('crop-canvas');
    const bmp = p?.bitmaps[0];
    if (!bmp) { canvas.width = 1; canvas.height = 1; $('crop-pos-wrap').classList.add('hidden'); return; }
    const ratio = RATIOS.find(r => r.id === p.ratio)?.value || null;
    const r = cropRect(bmp.width, bmp.height, ratio, p.pos);
    const scale = Math.min(1, 640 / Math.max(r.sw, r.sh));
    canvas.width = Math.round(r.sw * scale);
    canvas.height = Math.round(r.sh * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, r.sx, r.sy, r.sw, r.sh, 0, 0, canvas.width, canvas.height);
    drawOverlay(ctx, canvas.width, canvas.height, p.overlay);
    $('crop-pos-wrap').classList.toggle('hidden', !r.axis);
    $('crop-pos-label').textContent = r.axis === 'x' ? '左右位置' : '上下位置';
}

export async function croppedPhotos() {
    const p = state.publish;
    if (!p) return [];
    await ensureFonts(`${p.overlay.title}${p.overlay.sub}`);
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
        if (k === 0 || p.overlay.all) drawOverlay(ctx, c.width, c.height, p.overlay);
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

// ===== 照片加字 =====
export function renderOverlayControls() {
    const ov = state.publish?.overlay;
    if (!ov) return;
    $('overlay-styles').innerHTML = OVERLAY_STYLES.map(x => `<button type="button" data-action="setOverlayStyle" data-v="${x.id}" class="${x.id === ov.style ? 'active' : ''}" aria-pressed="${x.id === ov.style}">${x.name}</button>`).join('');
    $('overlay-positions').innerHTML = OVERLAY_POSITIONS.map(x => `<button type="button" data-action="setOverlayPosition" data-v="${x.id}" class="${x.id === ov.position ? 'active' : ''}" aria-pressed="${x.id === ov.position}">${x.name}</button>`).join('');
    $('overlay-title').value = ov.title;
    $('overlay-sub').value = ov.sub;
    $('overlay-all').checked = ov.all;
    $('overlay-fields').classList.toggle('hidden', ov.style === 'none');
    $('overlay-all-wrap').classList.toggle('hidden', ov.style === 'none' || (state.publish.bitmaps.length < 2));
}

let overlayTimer = null;
export function redrawWithFonts() {
    const ov = state.publish?.overlay;
    if (!ov) return;
    drawCropPreview();
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => ensureFonts(`${ov.title}${ov.sub}`).then(drawCropPreview), 150);
}

actions.setOverlayStyle = el => {
    if (!state.publish) return;
    state.publish.overlay.style = el.dataset.v;
    renderOverlayControls();
    redrawWithFonts();
};
actions.setOverlayPosition = el => {
    if (!state.publish) return;
    state.publish.overlay.position = el.dataset.v;
    renderOverlayControls();
    redrawWithFonts();
};
export function onOverlayInput() {
    const ov = state.publish?.overlay;
    if (!ov) return;
    ov.title = $('overlay-title').value.slice(0, 24);
    ov.sub = $('overlay-sub').value.slice(0, 30);
    ov.all = $('overlay-all').checked;
    redrawWithFonts();
}
