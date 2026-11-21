// 本機預覽用的靜態伺服器。網站本身是純前端（瀏覽器直接呼叫 Claude），正式環境放在 GitHub Pages。
// 同時把網站掛在「/」和「/SocialPostCreator/」，方便在本機確認 GitHub Pages 子路徑也正常。
const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const root = __dirname;

// 只公開網站需要的檔案（與 GitHub Pages 上實際用到的相同）
const site = express.Router();
site.get('/', (req, res) => res.sendFile(path.join(root, 'index.html')));
site.get('/index.html', (req, res) => res.sendFile(path.join(root, 'index.html')));
site.get('/sw.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(root, 'sw.js'));
});
site.get('/manifest.webmanifest', (req, res) => {
    res.type('application/manifest+json');
    res.sendFile(path.join(root, 'manifest.webmanifest'));
});
site.use('/public', express.static(path.join(root, 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/SocialPostCreator', site);
app.use('/', site);

if (require.main === module) {
    app.listen(port, '0.0.0.0', () => {
        console.log('🚀 貼文廚房（本機預覽）');
        console.log(`📍 http://localhost:${port}/`);
        console.log(`📍 GitHub Pages 子路徑測試：http://localhost:${port}/SocialPostCreator/`);
    });
}

module.exports = { app };
