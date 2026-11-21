// 網站檔案測試：確認在根目錄和 GitHub Pages 子路徑（/SocialPostCreator/）都能正常載入
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { app } = require('../server');

let server;
let base;

test.before(async () => {
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(resolve => server.close(resolve)));

const ASSETS = ['', 'sw.js', 'manifest.webmanifest', 'public/styles.css', 'public/app.css', 'public/app.js', 'public/kitchen.js', 'public/icons.svg', 'public/icons/icon-192.png'];

for (const prefix of ['/', '/SocialPostCreator/']) {
    test(`網站檔案可載入：${prefix}`, async () => {
        for (const p of ASSETS) {
            const res = await fetch(`${base}${prefix}${p}`);
            assert.equal(res.status, 200, `${prefix}${p}`);
        }
    });
}

test('不公開原始碼與設定檔', async () => {
    for (const p of ['/server.js', '/package.json', '/test/site.test.js', '/.gitignore', '/scripts/smoke.js']) {
        assert.equal((await fetch(`${base}${p}`)).status, 404, p);
    }
});

test('index.html 沒有絕對路徑（GitHub Pages 子路徑才不會壞）', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const abs = html.match(/(href|src)="\/(?!\/)[^"]*"/g);
    assert.equal(abs, null, `找到絕對路徑：${abs}`);
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    assert.doesNotMatch(js, /fetch\(['"`]\/api/, 'app.js 不應再呼叫後端 /api');
});

test('index.html 有 CSP、沒有 inline 腳本或事件', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.match(html, /http-equiv="Content-Security-Policy"/);
    assert.match(html, /connect-src[^"]*https:\/\/api\.anthropic\.com/);
    assert.doesNotMatch(html, /\son(click|submit|change|input)=/i);
    assert.doesNotMatch(html, /<script>/i);
});

test('manifest 與 service worker 用相對路徑', () => {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.webmanifest'), 'utf8'));
    assert.equal(m.start_url.startsWith('/'), false);
    assert.equal(m.scope, './');
    m.icons.forEach(i => assert.equal(i.src.startsWith('/'), false, i.src));
    const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    assert.doesNotMatch(sw, /'\/(public|styles|app)/);
});
