// 貼文廚房 · 照片加字（做成臉書配圖）
// 在照片上畫標題與副標，四種樣式：不加字、白字陰影、黑底條、收據貼紙

export const OVERLAY_STYLES = [
    { id: 'none', name: '不加字' },
    { id: 'shadow', name: '白字' },
    { id: 'band', name: '黑底條' },
    { id: 'receipt', name: '收據貼紙' }
];
export const OVERLAY_POSITIONS = [
    { id: 'top', name: '上' },
    { id: 'middle', name: '中' },
    { id: 'bottom', name: '下' }
];

const SANS = '"Noto Sans TC", system-ui, sans-serif';
const MONO = '"Courier Prime", "Noto Sans TC", monospace';

// 確保畫布用得到網頁字型（Google Fonts 依用到的字分批下載）
export async function ensureFonts(text) {
    if (!document.fonts || !text) return;
    try {
        await Promise.all([
            document.fonts.load(`900 40px ${SANS}`, text),
            document.fonts.load(`700 20px ${SANS}`, text),
            document.fonts.load(`700 20px ${MONO}`, '★ POST KITCHEN')
        ]);
    } catch (e) { /* 載不到就用系統字型 */ }
}

// 依寬度換行（中文逐字、英文以單字為單位）
function wrapLines(ctx, text, maxWidth, maxLines) {
    const tokens = String(text).match(/[A-Za-z0-9@#'’.\-]+|\s+|./gu) || [];
    const lines = [];
    let line = '';
    for (const t of tokens) {
        const next = line + t;
        if (ctx.measureText(next).width > maxWidth && line.trim()) {
            lines.push(line.trim());
            line = t.trimStart();
            if (lines.length === maxLines) break;
        } else {
            line = next;
        }
    }
    if (lines.length < maxLines && line.trim()) lines.push(line.trim());
    if (lines.length === maxLines && tokens.join('').length > lines.join('').length + 1) {
        lines[maxLines - 1] = lines[maxLines - 1].replace(/.$/u, '…');
    }
    return lines;
}

function anchorY(position, h, blockH, margin) {
    if (position === 'top') return margin;
    if (position === 'middle') return (h - blockH) / 2;
    return h - blockH - margin;
}

export function drawOverlay(ctx, w, h, opts) {
    const o = opts || {};
    const title = (o.title || '').trim();
    const sub = (o.sub || '').trim();
    if (!o.style || o.style === 'none' || (!title && !sub)) return;

    const base = Math.min(w, h);
    const titleSize = Math.round(base * 0.085);
    const subSize = Math.round(base * 0.045);
    const margin = Math.round(base * 0.06);
    const lineGap = Math.round(titleSize * 0.25);

    ctx.save();
    ctx.textBaseline = 'top';

    if (o.style === 'receipt') {
        const pw = Math.round(w * 0.72);
        const pad = Math.round(base * 0.04);
        const headSize = Math.round(base * 0.03);
        ctx.font = `900 ${titleSize}px ${SANS}`;
        const tLines = title ? wrapLines(ctx, title, pw - pad * 2, 2) : [];
        ctx.font = `700 ${subSize}px ${SANS}`;
        const sLines = sub ? wrapLines(ctx, sub, pw - pad * 2, 2) : [];
        const tooth = Math.round(base * 0.018);
        const ph = pad * 2 + headSize + lineGap * 2 + tLines.length * (titleSize + lineGap) + sLines.length * (subSize + lineGap) + tooth;
        const x = Math.round((w - pw) / 2);
        const y = Math.round(anchorY(o.position, h, ph, margin));

        // 紙張（下緣鋸齒）＋陰影
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = Math.round(base * 0.03);
        ctx.shadowOffsetY = Math.round(base * 0.01);
        ctx.fillStyle = '#fbfaf6';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + pw, y);
        ctx.lineTo(x + pw, y + ph - tooth);
        const step = tooth * 2;
        for (let tx = x + pw; tx > x; tx -= step) {
            ctx.lineTo(Math.max(x, tx - tooth), y + ph);
            ctx.lineTo(Math.max(x, tx - step), y + ph - tooth);
        }
        ctx.closePath();
        ctx.fill();
        ctx.shadowColor = 'transparent';

        let cy = y + pad;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#8c877b';
        ctx.font = `700 ${headSize}px ${MONO}`;
        ctx.fillText('★ 貼文廚房 · POST KITCHEN ★', w / 2, cy);
        cy += headSize + lineGap;
        ctx.strokeStyle = '#bdb7a8';
        ctx.setLineDash([Math.max(2, base * 0.008), Math.max(2, base * 0.006)]);
        ctx.lineWidth = Math.max(1, base * 0.003);
        ctx.beginPath();
        ctx.moveTo(x + pad, cy);
        ctx.lineTo(x + pw - pad, cy);
        ctx.stroke();
        ctx.setLineDash([]);
        cy += lineGap;
        ctx.fillStyle = '#1c1b19';
        ctx.font = `900 ${titleSize}px ${SANS}`;
        for (const l of tLines) { ctx.fillText(l, w / 2, cy); cy += titleSize + lineGap; }
        ctx.fillStyle = '#d6452f';
        ctx.font = `700 ${subSize}px ${SANS}`;
        for (const l of sLines) { ctx.fillText(l, w / 2, cy); cy += subSize + lineGap; }
        ctx.restore();
        return;
    }

    const maxW = w - margin * 2;
    ctx.font = `900 ${titleSize}px ${SANS}`;
    const tLines = title ? wrapLines(ctx, title, maxW, 2) : [];
    ctx.font = `700 ${subSize}px ${SANS}`;
    const sLines = sub ? wrapLines(ctx, sub, maxW, 2) : [];
    const blockH = tLines.length * (titleSize + lineGap) + sLines.length * (subSize + lineGap);
    const y = anchorY(o.position, h, blockH, margin);

    if (o.style === 'band') {
        const bandPad = Math.round(base * 0.035);
        ctx.fillStyle = 'rgba(20, 20, 22, 0.72)';
        ctx.fillRect(0, y - bandPad, w, blockH + bandPad * 2 - lineGap);
    } else {
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = Math.round(base * 0.02);
        ctx.shadowOffsetY = Math.round(base * 0.004);
    }
    ctx.textAlign = 'center';
    let cy = y;
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${titleSize}px ${SANS}`;
    for (const l of tLines) { ctx.fillText(l, w / 2, cy); cy += titleSize + lineGap; }
    ctx.fillStyle = o.style === 'band' ? '#ffd2c8' : '#ffffff';
    ctx.font = `700 ${subSize}px ${SANS}`;
    for (const l of sLines) { ctx.fillText(l, w / 2, cy); cy += subSize + lineGap; }
    ctx.restore();
}
