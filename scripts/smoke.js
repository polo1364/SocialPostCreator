// 真 Key 冒煙測試：用網站實際使用的同一套流程（public/kitchen.js），真的呼叫 Claude 跑一次「出單（串流）＋微調」。
// 會產生費用（約 US$0.01–0.05）。用法（PowerShell）：
//   $env:ANTHROPIC_API_KEY="sk-ant-..."; npm run smoke
// 可選：$env:SMOKE_IMAGE="C:\path\to\photo.jpg"（不給就用內建的小測試圖）
//       $env:SMOKE_MODEL="claude-haiku-5-5"（預設 claude-sonnet-5-5）
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const key = (process.env.ANTHROPIC_API_KEY || '').trim();
if (!key) {
    console.error('請先設定環境變數 ANTHROPIC_API_KEY');
    process.exit(1);
}
const model = process.env.SMOKE_MODEL || 'claude-sonnet-5-5';

function testImage() {
    if (process.env.SMOKE_IMAGE) {
        const file = process.env.SMOKE_IMAGE;
        const ext = path.extname(file).toLowerCase();
        const mediaType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        return { mediaType, data: fs.readFileSync(file).toString('base64') };
    }
    // 內建：一張 1x1 的紅色 PNG
    return { mediaType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==' };
}

async function main() {
    const K = await import('../public/kitchen.js');
    const client = new Anthropic({ apiKey: key });
    try {
        console.log(`▶ 出單（串流），模型 ${model}`);
        const t0 = Date.now();
        let partials = 0;
        let firstAt = null;
        const final = await K.streamCaptions(client, {
            model,
            images: [testImage()],
            description: '週末下午茶，測試用',
            styles: ['humorous', 'warm', 'foodie'],
            platform: 'facebook',
            language: 'en',
            hashtags: '#貼文廚房測試'
        }, () => { partials++; if (!firstAt) firstAt = Date.now() - t0; });
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
        const refined = await K.refineCaption(client, {
            model,
            caption: final.captions[0].caption,
            style: final.captions[0].style,
            instruction: '短一點',
            platform: 'facebook',
            language: 'en',
            imageAnalysis: final.imageAnalysis
        });
        console.log(`  ✔ 小編回覆：${refined.reply}（US$${refined.cost?.usd}）\n  ${refined.caption.replace(/\n/g, '\n  ')}`);
        console.log('\n全部通過 ✔');
    } catch (e) {
        console.error('\n✖', K.toUserError(e, Anthropic));
        process.exit(1);
    }
}

main();
