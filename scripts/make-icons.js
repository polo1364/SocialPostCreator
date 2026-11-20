// 產生 PWA 圖示（不需額外套件）：深色底＋鋸齒收據＋紅色指示燈。
// 用法：node scripts/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
function encodePng(size, pixel) {
    const raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0;
        for (let x = 0; x < size; x++) {
            const [r, g, b, a] = pixel(x, y);
            const o = y * (size * 4 + 1) + 1 + x * 4;
            raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

const BG = [31, 31, 34, 255];
const PAPER = [251, 250, 246, 255];
const INK = [190, 184, 170, 255];
const STAMP = [214, 69, 47, 255];

// maskable：圖示主體放在中央 80% 安全區
function draw(size, maskable) {
    const s = v => v * size;
    const inset = maskable ? 0.1 : 0;
    const scale = 1 - inset * 2;
    const u = (x, y) => [(x / size - inset) / scale, (y / size - inset) / scale];
    const radius = maskable ? 0 : 0.2;

    return (x, y) => {
        // 圓角底
        if (radius) {
            const cx = Math.min(Math.max(x, s(radius)), s(1 - radius));
            const cy = Math.min(Math.max(y, s(radius)), s(1 - radius));
            if ((x - cx) ** 2 + (y - cy) ** 2 > s(radius) ** 2) return [0, 0, 0, 0];
        }
        const [px, py] = u(x, y);
        // 收據紙：x 0.26–0.74，y 0.16–0.84，下緣鋸齒
        const left = 0.26, right = 0.74, top = 0.16, bottom = 0.84, tooth = 0.06;
        if (px >= left && px <= right && py >= top) {
            const t = ((px - left) % tooth) / tooth;
            const edge = bottom - (t < 0.5 ? t : 1 - t) * tooth;
            if (py <= edge) {
                // 指示燈
                if ((px - 0.5) ** 2 + (py - 0.27) ** 2 < 0.045 ** 2) return STAMP;
                // 文字線
                const lines = [[0.40, 0.66], [0.49, 0.58], [0.58, 0.66], [0.67, 0.50]];
                for (const [ly, w] of lines) {
                    if (Math.abs(py - ly) < 0.018 && px > 0.34 && px < 0.34 + (w - 0.34) + 0.0) return INK;
                }
                return PAPER;
            }
        }
        return BG;
    };
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const [name, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
    fs.writeFileSync(path.join(outDir, name), encodePng(size, draw(size, maskable)));
    console.log('wrote', name);
}
