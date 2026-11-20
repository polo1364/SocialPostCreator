// 後端測試：不會呼叫真正的 Claude API（只測驗證、路由、工具函式）
// 執行：npm test
const test = require('node:test');
const assert = require('node:assert');

const { app } = require('../server');
const { parsePartialJson, repairJson } = require('../lib/partial-json');
const { estimateCost } = require('../lib/pricing');

let server;
let base;

test.before(async () => {
    await new Promise(resolve => {
        server = app.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise(resolve => server.close(resolve)));

function tinyPng() {
    // 1x1 透明 PNG
    return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
}

function photoForm(count = 1, extra = {}) {
    const fd = new FormData();
    for (let i = 0; i < count; i++) fd.append('images', new Blob([tinyPng()], { type: 'image/png' }), `p${i}.png`);
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    return fd;
}

test('health、模型與平台端點', async () => {
    const h = await fetch(`${base}/health`).then(r => r.json());
    assert.equal(h.status, 'ok');
    const models = await fetch(`${base}/api/models`).then(r => r.json());
    assert.equal(models.default, 'claude-sonnet-5-5');
    const platforms = await fetch(`${base}/api/platforms`).then(r => r.json());
    assert.equal(platforms.platforms.threads.limit, 500);
});

test('首頁與 PWA 檔案可存取，原始碼不外洩', async () => {
    assert.equal((await fetch(`${base}/`)).status, 200);
    for (const p of ['/manifest.webmanifest', '/sw.js', '/styles.css', '/icons/icon-192.png']) {
        assert.equal((await fetch(`${base}${p}`)).status, 200, p);
    }
    for (const p of ['/server.js', '/package.json', '/lib/pricing.js', '/.gitignore']) {
        assert.equal((await fetch(`${base}${p}`)).status, 404, p);
    }
});

test('出單：沒有照片回 400、沒有 Key 回 401', async () => {
    const noPhoto = await fetch(`${base}/api/caption`, { method: 'POST', body: new FormData() });
    assert.equal(noPhoto.status, 400);
    const noKey = await fetch(`${base}/api/caption`, { method: 'POST', body: photoForm(1, { description: 'x' }) });
    assert.equal(noKey.status, 401);
    assert.match((await noKey.json()).error, /API Key/);
});

test('出單：超過 5 張照片回 400', async () => {
    const res = await fetch(`${base}/api/caption`, { method: 'POST', headers: { 'x-api-key': 'sk-ant-test' }, body: photoForm(6) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /5 張/);
});

test('出單：不支援的檔案格式回 400', async () => {
    const fd = new FormData();
    fd.append('images', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
    const res = await fetch(`${base}/api/caption`, { method: 'POST', headers: { 'x-api-key': 'sk-ant-test' }, body: fd });
    assert.equal(res.status, 400);
});

test('微調：缺少內容時回 400', async () => {
    const post = body => fetch(`${base}/api/refine`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'sk-ant-test' }, body: JSON.stringify(body) });
    assert.equal((await post({ instruction: '短一點' })).status, 400);
    assert.equal((await post({ caption: '測試' })).status, 400);
});

test('搜尋：沒有名稱回 400', async () => {
    const res = await fetch(`${base}/api/search-place`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'sk-ant-test' }, body: '{}' });
    assert.equal(res.status, 400);
});

test('沒有 Key 時搜尋與微調都回 401', async () => {
    const json = { 'Content-Type': 'application/json' };
    const search = await fetch(`${base}/api/search-place`, { method: 'POST', headers: json, body: JSON.stringify({ placeName: 'x' }) });
    assert.equal(search.status, 401);
    const refine = await fetch(`${base}/api/refine`, { method: 'POST', headers: json, body: JSON.stringify({ caption: '測試', instruction: '短一點' }) });
    assert.equal(refine.status, 401);
});

test('串流 JSON 修補：寫到一半也能解析', () => {
    assert.deepEqual(parsePartialJson('{"captions":[{"style":"幽默","caption":"鬆餅疊三'), { captions: [{ style: '幽默', caption: '鬆餅疊三' }] });
    assert.deepEqual(parsePartialJson('{"a":[1,2,'), { a: [1, 2] });
    assert.deepEqual(parsePartialJson('{"s":"換行\\'), { s: '換行' });
    assert.deepEqual(parsePartialJson('{"s":"\\u59'), { s: '' });
    assert.equal(parsePartialJson('{"captions":[{"sty'), null);
    assert.equal(parsePartialJson(''), null);
    assert.equal(repairJson('no json'), null);
    const full = '{"image_analysis":{"summary":"x"},"captions":[]}';
    assert.deepEqual(parsePartialJson(full), JSON.parse(full));
});

test('費用估算', () => {
    const c = estimateCost('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 });
    assert.equal(c.usd, 3); // 2 + 1
    const s = estimateCost('claude-opus-5-5', { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 3 } });
    assert.equal(s.usd, 0.03);
    assert.equal(estimateCost('unknown-model', { input_tokens: 1 }), null);
});
