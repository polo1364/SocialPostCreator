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

const ASSETS = ['', 'sw.js', 'manifest.webmanifest', 'public/styles.css', 'public/app.css', 'public/app.js', 'public/kitchen.js', 'public/js/core.js', 'public/js/order.js', 'public/icons.svg', 'public/icons/icon-192.png'];

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

test('PWA 可安裝的條件都齊全', () => {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.webmanifest'), 'utf8'));
    assert.ok(m.name && m.short_name, '要有名稱');
    assert.equal(m.display, 'standalone');
    assert.ok(m.icons.some(i => i.sizes === '192x192'), '要有 192 圖示');
    assert.ok(m.icons.some(i => i.sizes === '512x512' && i.purpose !== 'maskable'), '要有 512 圖示');
    assert.ok(m.icons.some(i => i.purpose === 'maskable'), '要有 maskable 圖示');
    for (const i of m.icons) assert.ok(fs.existsSync(path.join(__dirname, '..', i.src)), `圖示檔不存在：${i.src}`);
    const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    assert.match(sw, /addEventListener\('fetch'/, 'service worker 要處理 fetch');
    assert.match(sw, /SKIP_WAITING/, '要支援「重新整理」切換新版本');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.match(html, /rel="manifest"/);
    assert.match(html, /rel="apple-touch-icon"/);
    assert.match(html, /id="install-modal"/);
});

test('前端模組：每個 import 的名稱都真的有被 export', () => {
    const dir = path.join(__dirname, '..', 'public');
    const files = ['app.js', ...fs.readdirSync(path.join(dir, 'js')).map(f => `js/${f}`)];
    const exportsOf = {};
    for (const f of [...files, 'kitchen.js']) {
        const code = fs.readFileSync(path.join(dir, f), 'utf8');
        exportsOf[f] = new Set([
            ...[...code.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+([\w$]+)/gm)].map(m => m[1]),
            ...[...code.matchAll(/^export\s+\{([^}]+)\}/gm)].flatMap(m => m[1].split(',').map(s => s.trim()))
        ]);
    }
    for (const f of files) {
        const code = fs.readFileSync(path.join(dir, f), 'utf8');
        for (const m of code.matchAll(/^import\s+\{([^}]+)\}\s+from\s+'([^']+)'/gm)) {
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[2]));
            assert.ok(exportsOf[target], `${f} 匯入了不存在的檔案 ${m[2]}`);
            for (const name of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
                assert.ok(exportsOf[target].has(name), `${f} 從 ${m[2]} 匯入的 ${name} 不存在`);
            }
        }
    }
});

test('service worker 的離線清單裡每個檔案都存在', () => {
    const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    const list = sw.match(/const SHELL = \[([^\]]+)\]/)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1)).filter(p => p !== './');
    for (const p of list) assert.ok(fs.existsSync(path.join(__dirname, '..', p)), `離線清單裡的檔案不存在：${p}`);
    const js = fs.readdirSync(path.join(__dirname, '..', 'public', 'js'));
    for (const f of js) assert.ok(list.includes(`public/js/${f}`), `public/js/${f} 沒有放進離線清單`);
});

test('前端每個 JS 檔都沒有語法錯誤', () => {
    const { execFileSync } = require('child_process');
    const dir = path.join(__dirname, '..', 'public');
    const files = ['app.js', 'kitchen.js', ...fs.readdirSync(path.join(dir, 'js')).map(f => `js/${f}`)];
    for (const f of files) {
        try { execFileSync(process.execPath, ['--check', path.join(dir, f)], { stdio: 'pipe' }); }
        catch (e) { assert.fail(`public/${f} 有語法錯誤：\n${e.stderr}`); }
    }
    execFileSync(process.execPath, ['--check', path.join(__dirname, '..', 'sw.js')], { stdio: 'pipe' });
});

test('base.js 不 import 任何東西（必須最先載入）', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'base.js'), 'utf8');
    assert.doesNotMatch(code, /^import /m);
});
