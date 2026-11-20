// 真 Key 冒煙測試：實際呼叫 Claude 跑一次「出單（串流）＋微調」，確認整條流程正常。
// 會產生費用（約 US$0.01–0.05）。用法（PowerShell）：
//   $env:ANTHROPIC_API_KEY="sk-ant-..."; npm run smoke
// 可選：$env:SMOKE_IMAGE="C:\path\to\photo.jpg"（不給就用內建的小測試圖）
//       $env:SMOKE_MODEL="claude-haiku-5-5"（預設 claude-sonnet-5-5）
const fs = require('fs');
const path = require('path');

const key = (process.env.ANTHROPIC_API_KEY || '').trim();
if (!key) {
    console.error('請先設定環境變數 ANTHROPIC_API_KEY');
    process.exit(1);
}
const model = process.env.SMOKE_MODEL || 'claude-sonnet-5-5';

// 不讓伺服器讀到環境變數裡的 Key（伺服器只用請求帶的 Key）
const { app } = require('../server');

function testImage() {
    if (process.env.SMOKE_IMAGE) {
        const file = process.env.SMOKE_IMAGE;
        const ext = path.extname(file).toLowerCase();
        const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        return { buf: fs.readFileSync(file), type, name: path.basename(file) };
    }
    // 內建：一張 1x1 的紅色 PNG
    const buf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    return { buf, type: 'image/png', name: 'red.png' };
}

async function main() {
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'x-api-key': key, 'x-model': model };
    let failed = false;

    try {
        console.log(`▶ 出單（串流），模型 ${model}`);
        const img = testImage();
        const fd = new FormData();
        fd.append('images', new Blob([img.buf], { type: img.type }), img.name);
        fd.append('description', '週末下午茶，測試用');
        fd.append('styles', JSON.stringify(['humorous', 'warm', 'foodie']));
        fd.append('platform', 'facebook');
        fd.append('language', 'en');
        fd.append('hashtags', '#貼文廚房測試');

        const t0 = Date.now();
        const res = await fetch(`${base}/api/caption`, { method: 'POST', headers: { ...headers, Accept: 'text/event-stream' }, body: fd });
        if (!String(res.headers.get('content-type')).includes('text/event-stream')) {
            throw new Error(`沒有回傳串流：${res.status} ${await res.text()}`);
        }
        let partials = 0;
        let firstAt = null;
        let final = null;
        let error = null;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) > -1) {
                const raw = buf.slice(0, idx);
                buf = buf.slice(idx + 2);
                const event = (raw.match(/^event: (.*)$/m) || [])[1];
                const data = JSON.parse((raw.match(/^data: (.*)$/m) || [])[1] || 'null');
                if (event === 'partial') { partials++; if (!firstAt) firstAt = Date.now() - t0; }
                if (event === 'done') final = data;
                if (event === 'error') error = data;
            }
        }
        if (error) throw new Error(`出單失敗：${error.error}`);
        if (!final) throw new Error('沒有收到 done 事件');
        console.log(`  ✔ 收到 ${partials} 次部分結果，第一筆在 ${firstAt} ms，總共 ${Date.now() - t0} ms`);
        console.log(`  ✔ ${final.captions.length} 則貼文、${final.altTexts.length} 段替代文字，估算 US$${final.cost?.usd}`);
        console.log(`  ✔ 主廚筆記：${final.imageAnalysis?.summary}`);
        for (const c of final.captions) {
            console.log(`\n  【${c.style}】\n  ${c.caption.replace(/\n/g, '\n  ')}`);
            if (c.translation) console.log(`  (EN) ${c.translation.slice(0, 120)}…`);
        }
        if (!final.captions.every(c => c.caption.includes('#貼文廚房測試'))) console.warn('\n  ⚠ 有貼文沒帶上常用 Hashtag');
        if (!final.captions.every(c => c.translation)) console.warn('  ⚠ 有貼文沒有英文翻譯');

        console.log('\n▶ 微調');
        const r2 = await fetch(`${base}/api/refine`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ caption: final.captions[0].caption, style: final.captions[0].style, instruction: '短一點', platform: 'facebook', language: 'en', imageAnalysis: final.imageAnalysis })
        });
        const refined = await r2.json();
        if (!r2.ok) throw new Error(`微調失敗：${refined.error}`);
        console.log(`  ✔ 小編回覆：${refined.reply}（US$${refined.cost?.usd}）\n  ${refined.caption.replace(/\n/g, '\n  ')}`);
        console.log('\n全部通過 ✔');
    } catch (e) {
        failed = true;
        console.error('\n✖', e.message);
    } finally {
        server.close();
    }
    process.exit(failed ? 1 : 0);
}

main();
