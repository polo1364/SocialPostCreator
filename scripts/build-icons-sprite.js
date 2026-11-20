// 從 Font Awesome Free 只挑出用到的圖示，產生 public/icons.svg（SVG sprite），取代整包 CSS＋字型。
// 用法：npm run build:sprite（需要 devDependency @fortawesome/fontawesome-free）
// 圖示授權：Font Awesome Free，CC BY 4.0（https://fontawesome.com/license/free）
const fs = require('fs');
const path = require('path');

// id: [類別, 檔名]；類別 solid / regular / brands
const ICONS = {
    'camera': ['solid', 'camera-retro'],
    'store': ['solid', 'store'],
    'mountain': ['solid', 'mountain-sun'],
    'search': ['solid', 'magnifying-glass'],
    'x': ['solid', 'xmark'],
    'left': ['solid', 'chevron-left'],
    'right': ['solid', 'chevron-right'],
    'plus': ['solid', 'plus'],
    'star': ['solid', 'star'],
    'star-o': ['regular', 'star'],
    'arrow-right': ['solid', 'arrow-right'],
    'receipt': ['solid', 'receipt'],
    'gear': ['solid', 'gear'],
    'phone': ['solid', 'mobile-screen'],
    'copy': ['regular', 'copy'],
    'rotate': ['solid', 'rotate'],
    'redo': ['solid', 'rotate-right'],
    'image': ['solid', 'image'],
    'send': ['solid', 'paper-plane'],
    'eye': ['solid', 'eye'],
    'eye-off': ['solid', 'eye-slash'],
    'pen': ['solid', 'pen-nib'],
    'shield': ['solid', 'shield-halved'],
    'trash': ['solid', 'trash'],
    'check': ['solid', 'check'],
    'ok': ['solid', 'circle-check'],
    'warn': ['solid', 'circle-exclamation'],
    'info': ['solid', 'circle-info'],
    'spinner': ['solid', 'spinner'],
    'external': ['solid', 'arrow-up-right-from-square'],
    'comment': ['solid', 'comment'],
    'book': ['solid', 'book-open'],
    'share': ['solid', 'share-nodes'],
    'crop': ['solid', 'crop-simple'],
    'download': ['solid', 'download'],
    'export': ['solid', 'file-export'],
    'import': ['solid', 'file-import'],
    'language': ['solid', 'language'],
    'hashtag': ['solid', 'hashtag'],
    'a11y': ['solid', 'universal-access'],
    'facebook': ['brands', 'facebook'],
    'instagram': ['brands', 'instagram'],
    'threads': ['brands', 'threads']
};

const root = path.join(__dirname, '..', 'node_modules', '@fortawesome', 'fontawesome-free', 'svgs');
const symbols = Object.entries(ICONS).map(([id, [set, name]]) => {
    const svg = fs.readFileSync(path.join(root, set, `${name}.svg`), 'utf8');
    const viewBox = svg.match(/viewBox="([^"]+)"/)[1];
    const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<!--[\s\S]*?-->/g, '').trim();
    return `<symbol id="${id}" viewBox="${viewBox}">${inner.replace(/<path /g, '<path fill="currentColor" ')}</symbol>`;
});

const out = `<svg xmlns="http://www.w3.org/2000/svg"><!-- Font Awesome Free 6.5.2 subset, CC BY 4.0 https://fontawesome.com/license/free -->${symbols.join('')}</svg>\n`;
fs.writeFileSync(path.join(__dirname, '..', 'public', 'icons.svg'), out);
console.log(`wrote public/icons.svg（${symbols.length} 個圖示，${(out.length / 1024).toFixed(1)} KB）`);
