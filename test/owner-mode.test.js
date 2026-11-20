// 站長模式測試：設定伺服器 Key 與通行碼後，檢查通行碼與限流（不呼叫 Claude）
const test = require('node:test');
const assert = require('node:assert');

process.env.ANTHROPIC_API_KEY = 'sk-ant-server-test';
process.env.ACCESS_PASSWORD = 'open-sesame';
process.env.SERVER_RATE_LIMIT = '2';
// 指向不存在的位址，確保測試絕不會真的呼叫 Anthropic
process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9';

const { app } = require('../server');

let server;
let base;

test.before(async () => {
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise(resolve => server.close(resolve)));

test('config 顯示站長模式需要通行碼', async () => {
    const cfg = await fetch(`${base}/api/config`).then(r => r.json());
    assert.equal(cfg.serverKey, true);
    assert.equal(cfg.needsPassword, true);
});

test('check-access 驗證通行碼', async () => {
    assert.equal((await fetch(`${base}/api/check-access`, { method: 'POST', headers: { 'x-access-password': 'wrong' } })).status, 401);
    assert.equal((await fetch(`${base}/api/check-access`, { method: 'POST', headers: { 'x-access-password': 'open-sesame' } })).status, 200);
});

test('沒帶通行碼或通行碼錯誤時不會用站長 Key', async () => {
    const post = headers => fetch(`${base}/api/search-place`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ placeName: 'x' }) });
    const none = await post({});
    assert.equal(none.status, 401);
    const wrong = await post({ 'x-access-password': 'nope' });
    assert.equal(wrong.status, 401);
    assert.match((await wrong.json()).error, /通行碼錯誤/);
});

test('站長 Key 依 IP 限流', async () => {
    // 限流在通過通行碼驗證後才計數：前兩次會消耗額度（連到不存在的位址而失敗，不影響計數），第三次應回 429
    const post = () => fetch(`${base}/api/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-access-password': 'open-sesame' },
        body: JSON.stringify({ caption: '測試', instruction: '短一點' })
    });
    const r1 = await post();
    const r2 = await post();
    assert.notEqual(r1.status, 429);
    assert.notEqual(r2.status, 429);
    const r3 = await post();
    assert.equal(r3.status, 429);
});
