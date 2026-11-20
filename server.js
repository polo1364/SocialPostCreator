const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { parsePartialJson } = require('./lib/partial-json');
const { estimateCost } = require('./lib/pricing');

const app = express();
const port = process.env.PORT || 3000;

// ===== 模型設定 =====
const MODELS = {
    'claude-opus-5-5': { label: 'Claude Opus 5.5', fallback: true, webSearch: 'web_search_20260209' },
    'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', fallback: true, webSearch: 'web_search_20260209' },
    'claude-haiku-5-5': { label: 'Claude Haiku 5.5', fallback: false, webSearch: 'web_search_20250305' }
};
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

function resolveModel(req) {
    const m = (req.headers['x-model'] || '').trim();
    return MODELS[m] ? m : DEFAULT_MODEL;
}

// ===== 金鑰 =====
// 使用者在前端手動填入自己的 Claude API Key（x-api-key），伺服器不保存任何金鑰。
function resolveCredential(req) {
    const userKey = (req.headers['x-api-key'] || '').trim();
    if (!userKey) return { error: { status: 401, message: '請先設定 Claude API Key' } };
    return { apiKey: userKey };
}

// 建立請求參數：Opus / Sonnet 開啟伺服器端拒答備援（fallbacks: "default"）
function buildParams(model, params) {
    const out = { model, ...params };
    if (MODELS[model].fallback) {
        out.betas = [FALLBACK_BETA];
        out.fallbacks = 'default';
    }
    return out;
}

function toUserError(error) {
    if (error instanceof Anthropic.AuthenticationError) return { status: 401, message: 'API Key 無效或已被撤銷，請重新設定' };
    if (error instanceof Anthropic.PermissionDeniedError) return { status: 403, message: '此 API Key 沒有使用該模型或功能的權限' };
    if (error instanceof Anthropic.RateLimitError) return { status: 429, message: '請求太頻繁或額度不足，請稍後再試' };
    if (error instanceof Anthropic.BadRequestError) {
        const msg = error.message || '';
        if (/credit|balance/i.test(msg)) return { status: 402, message: '帳戶餘額不足，請至 Anthropic Console 儲值' };
        return { status: 400, message: '請求格式有誤：' + msg.slice(0, 120) };
    }
    if (error instanceof Anthropic.APIConnectionError) return { status: 502, message: '無法連線到 Claude API，請檢查網路' };
    if (error instanceof Anthropic.APIError) return { status: error.status || 500, message: 'Claude API 暫時無法使用，請稍後再試' };
    return { status: 500, message: error.message || '生成失敗，請稍後再試' };
}

// ===== 上傳 =====
const MAX_IMAGES = 5;
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: MAX_IMAGES },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowed.includes(file.mimetype)) return cb(null, true);
        cb(new Error('只允許上傳 JPG、PNG、GIF、WebP 圖片'));
    }
});

// ===== Middleware 與靜態檔 =====
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// 只公開首頁與 public/（PWA 檔案、編譯後的 CSS），不會送出 server.js 等原始碼
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    }
}));

// PWA 分享目標的後備路由（service worker 還沒接手時）
app.post('/share-target', (req, res) => res.redirect(303, '/?shared=0'));

// ===== 共用工具 =====
function collectText(message) {
    return (message.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

// 有拒答備援時可能有多個 text 區塊，以最後一個為準
function lastText(message) {
    const blocks = (message.content || []).filter(b => b.type === 'text');
    return blocks.length ? blocks[blocks.length - 1].text : '';
}

function cleanJson(text) {
    if (!text) return '{}';
    const t = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const starts = [t.indexOf('{'), t.indexOf('[')].filter(i => i !== -1);
    if (starts.length === 0) return t;
    const start = Math.min(...starts);
    const end = t[start] === '{' ? t.lastIndexOf('}') : t.lastIndexOf(']');
    return end > start ? t.substring(start, end + 1) : t;
}

function safeJsonParse(value, fallback) {
    if (!value) return fallback;
    try { return JSON.parse(value); } catch { return fallback; }
}

function log(...args) {
    console.log(`[${new Date().toISOString()}]`, ...args);
}

// ===== 基本端點 =====
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/models', (req, res) => {
    res.json({ default: DEFAULT_MODEL, models: Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label })) });
});

// ===== 店家/景點搜尋 =====
app.post('/api/search-place', async (req, res) => {
    const { placeName, location, placeType } = req.body || {};
    const isAttraction = placeType === 'attraction';
    try {
        if (!placeName || !String(placeName).trim()) return res.status(400).json({ error: '請輸入名稱' });
        const cred = resolveCredential(req);
        if (cred.error) return res.status(cred.error.status).json({ error: cred.error.message });

        const model = resolveModel(req);
        const client = new Anthropic({ apiKey: cred.apiKey });
        const searchQuery = location ? `${placeName} ${location}` : placeName;

        const schema = isAttraction
            ? `{"found": true, "category": "attraction", "name": "景點名稱", "type": "景點類型", "signature": "主要特色", "location": "位置", "hours": "開放時間或 null", "ticketInfo": "門票資訊或 null", "reviews": ["網友評價關鍵詞"], "bestTime": "最佳造訪時間", "highlights": ["亮點"], "nearby": ["周邊景點"], "summary": "一句話介紹"}`
            : `{"found": true, "category": "store", "name": "店家名稱", "type": "店家類型（咖啡廳/餐廳/甜點店等）", "signature": "招牌餐點或特色", "location": "地址或位置", "hours": "營業時間或 null", "priceRange": "價位範圍或 null", "reviews": ["網友評價關鍵詞"], "highlights": ["亮點"], "summary": "一句話介紹"}`;

        const prompt = `請用網路搜尋查詢「${searchQuery}」這個${isAttraction ? '景點/旅遊地點' : '店家/餐廳'}的最新資訊與網友評價。

只根據搜尋到的內容整理，查不到的欄位填 null，不要編造。所有文字使用繁體中文。
最後只輸出一個 JSON 物件，不要任何其他文字，格式如下：
${schema}

如果完全查不到，輸出：
{"found": false, "category": "${isAttraction ? 'attraction' : 'store'}", "name": ${JSON.stringify(String(placeName))}, "message": "找不到相關資訊"}`;

        log(`[${model}] 搜尋${isAttraction ? '景點' : '店家'}「${searchQuery}」`);

        const messages = [{ role: 'user', content: prompt }];
        const tools = [{ type: MODELS[model].webSearch, name: 'web_search', max_uses: 5 }];
        const costs = [];

        // 伺服器工具回合可能以 pause_turn 暫停，最多續跑 3 次
        let response;
        for (let i = 0; i < 4; i++) {
            response = await client.beta.messages.create(buildParams(model, {
                max_tokens: 8000,
                output_config: { effort: 'low' },
                tools,
                messages
            }));
            costs.push(estimateCost(model, response.usage));
            if (response.stop_reason !== 'pause_turn') break;
            messages.push({ role: 'assistant', content: response.content });
        }
        const cost = sumCosts(costs);

        if (response.stop_reason === 'refusal') {
            return res.json({ placeInfo: { found: false, message: '此查詢無法處理' }, cost });
        }

        const text = lastText(response) || collectText(response);
        let placeInfo = safeJsonParse(cleanJson(text), null);
        if (!placeInfo) {
            placeInfo = {
                found: true,
                category: isAttraction ? 'attraction' : 'store',
                name: placeName,
                type: isAttraction ? '景點' : '店家',
                location: location || null,
                reviews: [],
                highlights: [],
                summary: text.replace(/\s+/g, ' ').substring(0, 120)
            };
        }
        log(`搜尋完成：${placeInfo.found ? '找到' : '未找到'}`);
        res.json({ placeInfo, cost });
    } catch (error) {
        log('搜尋錯誤:', error.message);
        const { status, message } = toUserError(error);
        res.status(status).json({ error: message, placeInfo: { found: false, message } });
    }
});

app.post('/api/search-store', (req, res, next) => {
    req.body = { ...(req.body || {}), placeType: 'store' };
    req.url = '/api/search-place';
    app.handle(req, res, next);
});

function sumCosts(list) {
    const valid = list.filter(Boolean);
    if (!valid.length) return null;
    return valid.reduce((a, c) => ({
        usd: Math.round((a.usd + c.usd) * 1e6) / 1e6,
        inputTokens: a.inputTokens + c.inputTokens,
        outputTokens: a.outputTokens + c.outputTokens,
        searches: a.searches + c.searches
    }));
}

// ===== 風格、平台、語調 =====
const STYLE_DEFINITIONS = {
    humorous: { name: '幽默搞笑', description: '用幽默、搞笑的語調，加入有趣的梗或比喻，讓人會心一笑', emoji: '😂🤣😆' },
    warm: { name: '溫馨感性', description: '用溫暖、感性的語調，傳達幸福感和正能量，讓人感受到溫度', emoji: '🥰💕✨' },
    foodie: { name: '美食專家', description: '用專業美食評論的角度，描述食物的色香味和用餐體驗', emoji: '🍽️😋🔥' },
    literary: { name: '文青詩意', description: '用文藝、詩意的筆觸，帶有意境和哲理的感悟', emoji: '📖🌿☕' },
    energetic: { name: '活力熱情', description: '用充滿活力、熱情奔放的語調，帶動氣氛和正能量', emoji: '🎉💪🔥' },
    minimalist: { name: '簡約俐落', description: '用簡短、有力的句子，直接表達重點，不囉嗦', emoji: '✓💯👌' },
    storytelling: { name: '故事敘述', description: '用說故事的方式，娓娓道來這次的體驗和感受', emoji: '📝🎬💭' },
    trendy: { name: '潮流網紅', description: '用時下流行的網路用語和梗，貼近年輕人的說話方式', emoji: '🔥💅✨' }
};

const PLATFORMS = {
    general: { name: '不指定', length: '每則約五十到兩百字', rules: '一般社群貼文寫法，適當換行。' },
    instagram: { name: 'Instagram', length: '每則約八十到兩百五十字', limit: 2200, rules: '寫給 Instagram：第一行就要抓住目光；段落之間空一行；可以用 Emoji 當段落開頭；Hashtag 5 到 10 個，全部集中放在文末。' },
    threads: { name: 'Threads', length: '每則五十到一百五十字，絕對不可超過 500 字（Emoji 與 Hashtag 都算）', limit: 500, rules: '寫給 Threads：像隨手發文的口語短句，可以帶一點吐槽或問句引發回覆；Hashtag 最多 1 個或不用。' },
    facebook: { name: 'Facebook', length: '每則約一百到三百字', rules: '寫給 Facebook：可以寫得完整、有故事性，像跟朋友分享；Hashtag 0 到 3 個。' },
    xiaohongshu: { name: '小紅書', length: '每則約一百五十到四百字', limit: 1000, rules: '寫給小紅書：第一行是二十字內、含 Emoji 的吸睛標題；內文分點或分段、大量使用 Emoji；文末放 5 到 10 個 Hashtag。仍使用繁體中文。' }
};

function resolvePlatform(value) {
    return PLATFORMS[value] ? value : 'general';
}

const RATING_TONES = {
    1: { mood: '失望、不滿意', direction: '表達失望的情緒，委婉但誠實地指出不足之處，提醒其他人注意', keywords: '可惜、失望、不推薦、踩雷、下次不會再來' },
    2: { mood: '普通偏下、有待加強', direction: '表達中性偏負面的感受，客觀指出優缺點，但整體不太滿意', keywords: '普通、還好、有待加強、期望落差' },
    3: { mood: '中規中矩、還可以', direction: '表達中性的感受，優缺點並陳，不特別推薦也不特別不推', keywords: '還行、中規中矩、普通、可以接受' },
    4: { mood: '不錯、滿意', direction: '表達正面的感受，推薦給朋友，但也可以提及小小的改進空間', keywords: '不錯、推薦、值得一試、會再來' },
    5: { mood: '超棒、非常推薦', direction: '表達非常滿意和興奮的情緒，大力推薦，用熱情的語調', keywords: '超讚、必訪、大推、太棒了、絕對要來' }
};

const OPENINGS = ['用問句開頭引發好奇', '用感嘆句表達驚喜', '用對話口吻像在跟朋友聊天', '用描述場景的方式帶入', '用自言自語的內心獨白', '用倒敘法從結果說起', '用比喻或類比開場', '用誇張的形容詞開頭', '用反問句製造懸念', '直接切入主題不囉嗦'];
const PERSPECTIVES = ['從味覺和嗅覺的感受出發', '從視覺美感的角度切入', '從情感和回憶的連結著手', '從分享好物的心情出發', '從日常小確幸的視角描述', '從真心推薦的立場分享', '從意外驚喜的發現切入', '從療癒放鬆的體驗出發'];
const ENDINGS = ['用邀請大家留言的問句結尾', '用感性的人生感悟收尾', '用輕鬆的自嘲或吐槽結尾', '用期待再訪的話語結尾', '用強力推薦的呼籲結尾', '用簡短有力的一句話總結'];
const MOODS = ['帶著悠閒愜意的氛圍', '帶著興奮期待的心情', '帶著溫馨幸福的感覺', '帶著驚喜發現的語氣', '帶著滿足享受的態度', '帶著輕鬆自在的調性'];
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const CAPTIONS_SCHEMA = {
    type: 'object',
    properties: {
        image_analysis: {
            type: 'object',
            properties: {
                summary: { type: 'string' },
                subjects: { type: 'array', items: { type: 'string' } },
                visible_text: { type: 'array', items: { type: 'string' } },
                setting: { type: 'string' },
                mood: { type: 'string' },
                details: { type: 'array', items: { type: 'string' } }
            },
            required: ['summary', 'subjects', 'visible_text', 'setting', 'mood', 'details'],
            additionalProperties: false
        },
        captions: {
            type: 'array',
            items: {
                type: 'object',
                properties: { style: { type: 'string' }, caption: { type: 'string' } },
                required: ['style', 'caption'],
                additionalProperties: false
            }
        }
    },
    required: ['image_analysis', 'captions'],
    additionalProperties: false
};

const IMAGE_ANALYSIS_GUIDE = `【先仔細看照片，填寫 image_analysis】
- summary：一句話說明照片拍的是什麼（多張照片時總結整組內容）
- 多張照片時，各欄位涵蓋所有照片，必要時在項目前標註（照片 2）
- subjects：主要物件，越具體越好（例如「厚片鬆餅疊三層、淋楓糖、旁邊一球香草冰淇淋」，而不是「甜點」）；食物請寫出品項、份量、擺盤、醬汁與配料
- visible_text：照片中看得到的文字，照原文抄錄（招牌、菜單、價目、杯身、包裝、標示）；沒有就給空陣列
- setting：場景與環境（室內/戶外、裝潢風格、光線、時段、天氣、季節線索）
- mood：照片傳達的氛圍
- details：值得寫進貼文的小細節（顏色、質地、熱氣、拉花、窗外景色、人物動作等）
只寫照片裡真的看得到的東西；看不清楚就說「看起來像」，不要猜品牌或店名。
若有提供店家/景點資訊，只在照片內容與資料相符時才把兩者對上。`;

const SYSTEM_PROMPT = `你是一位台灣的社群媒體文案寫手，擅長用道地的繁體中文撰寫像真人發文的動態貼文。
全程使用繁體中文，可以使用 Emoji；不要夾雜英文或其他外語（品牌、店名原文除外）。
Hashtag 一律使用有意義的中文詞彙（例如 #美食推薦 #週末好去處）。`;

function buildPlaceContext(placeInfo) {
    if (!placeInfo || !placeInfo.found) return '';
    const isAttraction = placeInfo.category === 'attraction';
    const lines = [
        `- ${isAttraction ? '景點名稱' : '店名'}：${placeInfo.name || '未知'}`,
        `- 類型：${placeInfo.type || '未知'}`,
        placeInfo.signature && `- ${isAttraction ? '主要特色' : '特色/招牌'}：${placeInfo.signature}`,
        placeInfo.location && `- 地點：${placeInfo.location}`,
        placeInfo.priceRange && `- 價位：${placeInfo.priceRange}`,
        placeInfo.ticketInfo && `- 門票：${placeInfo.ticketInfo}`,
        placeInfo.bestTime && `- 最佳時間：${placeInfo.bestTime}`,
        Array.isArray(placeInfo.reviews) && placeInfo.reviews.length && `- 評價關鍵詞：${placeInfo.reviews.join('、')}`,
        Array.isArray(placeInfo.highlights) && placeInfo.highlights.length && `- 亮點：${placeInfo.highlights.join('、')}`,
        Array.isArray(placeInfo.nearby) && placeInfo.nearby.length && `- 周邊推薦：${placeInfo.nearby.join('、')}`,
        placeInfo.summary && `- 簡介：${placeInfo.summary}`
    ].filter(Boolean);
    return `
<place_info>
${lines.join('\n')}
</place_info>
貼文中提到的${isAttraction ? '景點' : '店家'}資訊必須符合以上事實，不可編造不存在的${isAttraction ? '景觀或設施' : '餐點或特色'}。`;
}

function buildVoiceContext(voiceSamples) {
    const v = typeof voiceSamples === 'string' ? voiceSamples.trim().slice(0, 3000) : '';
    if (!v) return '';
    return `
<my_past_posts>
${v}
</my_past_posts>
以上是使用者自己以前寫的貼文。請模仿他的口吻：用字、句子長短、標點與 Emoji 習慣、自稱方式；只學語氣，不要照抄內容。風格要求和語氣衝突時，以使用者的語氣為底、再加上該風格的味道。`;
}

function buildRatingContext(rating) {
    const tone = RATING_TONES[rating];
    if (!tone) return '';
    return `
【用戶評價：${rating} 星】
- 整體感受：${tone.mood}
- 貼文方向：${tone.direction}
- 可參考的詞彙：${tone.keywords}
所有貼文都要反映這個 ${rating} 星的語調。`;
}

function buildPlatformContext(platformKey) {
    const p = PLATFORMS[platformKey];
    return `【發文平台：${p.name}】${p.rules}`;
}

// ===== SSE 小工具 =====
function wantsStream(req) {
    return String(req.headers.accept || '').includes('text/event-stream');
}

function openSse(res) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    return (event, data) => {
        if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
}

// ===== 核心 API：產生貼文（支援串流） =====
const uploadImages = upload.fields([{ name: 'images', maxCount: MAX_IMAGES }, { name: 'image', maxCount: 1 }]);

app.post('/api/caption', uploadImages, async (req, res) => {
    const streaming = wantsStream(req);
    let send = null;
    let stream = null;
    try {
        const files = [...(req.files?.images || []), ...(req.files?.image || [])].slice(0, MAX_IMAGES);
        if (files.length === 0) return res.status(400).json({ error: '請上傳照片' });
        const cred = resolveCredential(req);
        if (cred.error) return res.status(cred.error.status).json({ error: cred.error.message });

        const multi = files.length > 1;
        const model = resolveModel(req);
        const platform = resolvePlatform(req.body.platform);
        const userDescription = (req.body.description || (multi ? '這組照片' : '這張照片')).trim().slice(0, 1000);
        const placeInfo = safeJsonParse(req.body.placeInfo, null);
        const rating = parseInt(req.body.rating, 10) || 0;
        const redoStyle = STYLE_DEFINITIONS[req.body.redoStyle] ? req.body.redoStyle : null;
        const avoidCaption = typeof req.body.avoidCaption === 'string' ? req.body.avoidCaption.slice(0, 2000) : '';

        let stylesToUse;
        if (redoStyle) {
            stylesToUse = [redoStyle];
        } else {
            const requested = safeJsonParse(req.body.styles, []);
            const valid = Array.isArray(requested) ? requested.filter(s => STYLE_DEFINITIONS[s]) : [];
            stylesToUse = valid.length >= 3 ? valid.slice(0, 5) : ['humorous', 'warm', 'foodie'];
        }

        const styleRequirements = stylesToUse.map((key, i) => {
            const s = STYLE_DEFINITIONS[key];
            return `${i + 1}. 【${s.name}】${s.description}，可使用 ${s.emoji} 等相關表情`;
        }).join('\n');

        const photoIntro = multi
            ? `以下共有 ${files.length} 張照片（已標上「照片 1」到「照片 ${files.length}」），來自同一次經驗。請把它們當成一組來看，貼文可以串起多張照片的內容（例如餐點、環境、店外觀），但不要逐張流水帳。`
            : '觀察這張圖片。';
        const countText = stylesToUse.length === 1 ? '一則貼文' : `${stylesToUse.length} 則風格各異的貼文`;
        const redoText = redoStyle && avoidCaption
            ? `\n【這次是重做】下面是上一版，請寫一則角度、開頭、句型都明顯不同的新版本：\n<previous_caption>\n${avoidCaption}\n</previous_caption>\n`
            : '';

        const prompt = `${photoIntro}結合用戶描述「${userDescription}」，創作 ${countText}。
${buildRatingContext(rating)}
${buildPlaceContext(placeInfo)}
${buildVoiceContext(req.body.voiceSamples)}

${IMAGE_ANALYSIS_GUIDE}

${buildPlatformContext(platform)}
${redoText}
【本次創作方向】
- 開場：${pick(OPENINGS)}
- 視角：${pick(PERSPECTIVES)}
- 結尾：${pick(ENDINGS)}
- 氛圍：${pick(MOODS)}

【風格要求，依序各寫一則】
${styleRequirements}

【寫作規則】
1. 每則開頭完全不同，句型結構有變化
2. 自然口語化，像真人在社群發文，適當使用 Emoji 與換行
3. ${PLATFORMS[platform].length}
4. 每則至少提到一個 image_analysis 裡的具體細節，讓讀者看得出是在講這${multi ? '組' : '張'}照片
5. 圖片裡看不到、資料裡也沒有的細節不要編造

再輸出 captions 陣列，每項的 style 填上方的風格名稱（例如「幽默搞笑」），caption 填貼文內容。`;

        log(`[${model}] [${platform}] 為「${userDescription.slice(0, 30)}」生成 ${stylesToUse.length} 則貼文（${files.length} 張照片${redoStyle ? '，重做' : ''}）`);

        const client = new Anthropic({ apiKey: cred.apiKey });
        stream = client.beta.messages.stream(buildParams(model, {
            max_tokens: 16000,
            system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
            output_config: {
                effort: 'medium',
                format: { type: 'json_schema', schema: CAPTIONS_SCHEMA }
            },
            messages: [{
                role: 'user',
                content: [
                    ...files.flatMap((f, i) => [
                        ...(multi ? [{ type: 'text', text: `照片 ${i + 1}：` }] : []),
                        { type: 'image', source: { type: 'base64', media_type: f.mimetype, data: f.buffer.toString('base64') } }
                    ]),
                    { type: 'text', text: prompt }
                ]
            }]
        }));

        if (streaming) {
            send = openSse(res);
            res.on('close', () => { if (!res.writableEnded) stream.abort(); });

            // 邊收邊解析：每個 text 區塊重新累積（拒答備援換模型時會開新區塊）
            let acc = '';
            let lastSent = '';
            let timer = null;
            const flush = () => {
                timer = null;
                const partial = parsePartialJson(acc);
                if (!partial) return;
                const snapshot = JSON.stringify({ analysis: partial.image_analysis || null, captions: partial.captions || [] });
                if (snapshot !== lastSent) {
                    lastSent = snapshot;
                    send('partial', JSON.parse(snapshot));
                }
            };
            stream.on('streamEvent', ev => {
                if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
                    if (acc) send('reset', {});
                    acc = '';
                    lastSent = '';
                } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
                    acc += ev.delta.text;
                    if (!timer) timer = setTimeout(flush, 70);
                }
            });
        }

        const response = await stream.finalMessage();
        const cost = estimateCost(model, response.usage);

        let failure = null;
        if (response.stop_reason === 'refusal') failure = { status: 422, message: 'AI 無法處理這些照片或描述，請換照片或調整描述' };
        else if (response.stop_reason === 'max_tokens') failure = { status: 500, message: '回應過長被截斷，請減少風格數量後重試' };

        let captions = [];
        let imageAnalysis = null;
        if (!failure) {
            const data = safeJsonParse(cleanJson(lastText(response)), null);
            captions = Array.isArray(data?.captions) ? data.captions.filter(c => c && typeof c.caption === 'string' && c.caption.trim()) : [];
            imageAnalysis = data?.image_analysis || null;
            if (captions.length === 0) failure = { status: 500, message: 'AI 回應格式錯誤，請重試' };
        }

        if (failure) {
            if (send) { send('error', { error: failure.message, cost }); return res.end(); }
            return res.status(failure.status).json({ error: failure.message, cost });
        }

        log(`成功生成 ${captions.length} 則貼文（約 US$${cost?.usd ?? '?'}）`);
        const payload = { captions, imageAnalysis, model, platform, placeInfo: placeInfo || null, cost };
        if (send) { send('done', payload); return res.end(); }
        res.json(payload);
    } catch (error) {
        if (error instanceof Anthropic.APIUserAbortError || res.destroyed) return;
        log('生成錯誤:', error.message);
        const { status, message } = toUserError(error);
        if (send) { send('error', { error: message }); return res.end(); }
        if (!res.headersSent) res.status(status).json({ error: message });
    }
});

// ===== 微調 API：依一句指示改寫單則貼文 =====
const REFINE_SCHEMA = {
    type: 'object',
    properties: { caption: { type: 'string' }, reply: { type: 'string' } },
    required: ['caption', 'reply'],
    additionalProperties: false
};

app.post('/api/refine', async (req, res) => {
    try {
        const { caption, style, instruction, description, imageAnalysis, placeInfo, rating, history, platform, voiceSamples } = req.body || {};
        if (typeof caption !== 'string' || !caption.trim()) return res.status(400).json({ error: '缺少要修改的貼文' });
        if (typeof instruction !== 'string' || !instruction.trim()) return res.status(400).json({ error: '請輸入想怎麼改' });
        const cred = resolveCredential(req);
        if (cred.error) return res.status(cred.error.status).json({ error: cred.error.message });

        const model = resolveModel(req);
        const platformKey = resolvePlatform(platform);
        const client = new Anthropic({ apiKey: cred.apiKey });

        const a = imageAnalysis && typeof imageAnalysis === 'object' ? imageAnalysis : null;
        const analysisText = a ? [
            a.summary && `- 概要：${a.summary}`,
            Array.isArray(a.subjects) && a.subjects.length && `- 主體：${a.subjects.join('、')}`,
            Array.isArray(a.visible_text) && a.visible_text.length && `- 照片中的文字：${a.visible_text.join('、')}`,
            a.setting && `- 場景：${a.setting}`,
            a.mood && `- 氛圍：${a.mood}`,
            Array.isArray(a.details) && a.details.length && `- 細節：${a.details.join('、')}`
        ].filter(Boolean).join('\n') : '';

        const pastSteps = Array.isArray(history) ? history.slice(-6)
            .filter(h => h && typeof h.instruction === 'string')
            .map((h, i) => `${i + 1}. ${h.instruction.slice(0, 200)}`).join('\n') : '';

        const r = parseInt(rating, 10) || 0;
        const system = `你是一位台灣的社群媒體小編，正在跟使用者一起修改一則貼文。
全程使用繁體中文，可以使用 Emoji；Hashtag 一律用有意義的中文詞彙。
照著使用者的指示改寫，保留原本的風格與事實；照片資訊和店家資料裡沒有的細節不要編造。`;

        const prompt = `${analysisText ? `<photo>\n${analysisText}\n</photo>\n` : ''}${buildPlaceContext(placeInfo)}
${buildVoiceContext(voiceSamples)}
${description ? `使用者原本的描述：「${String(description).slice(0, 1000)}」\n` : ''}${RATING_TONES[r] ? `使用者給了 ${r} 星（${RATING_TONES[r].mood}），語調要符合。\n` : ''}貼文風格：${String(style || '自由發揮').slice(0, 20)}
${buildPlatformContext(platformKey)}（長度：${PLATFORMS[platformKey].length}，除非使用者這次要求改變長度）
${pastSteps ? `\n先前已做過的修改（請維持這些要求）：\n${pastSteps}\n` : ''}
<current_caption>
${caption.slice(0, 3000)}
</current_caption>

使用者這次的要求：「${instruction.slice(0, 500)}」

caption 填改寫後的完整貼文；reply 用一句輕鬆口語的話回覆使用者你改了什麼（二十字內）。`;

        log(`[${model}] 微調貼文：${instruction.slice(0, 40)}`);

        const response = await client.beta.messages.create(buildParams(model, {
            max_tokens: 8000,
            system,
            output_config: { effort: 'low', format: { type: 'json_schema', schema: REFINE_SCHEMA } },
            messages: [{ role: 'user', content: prompt }]
        }));
        const cost = estimateCost(model, response.usage);

        if (response.stop_reason === 'refusal') return res.status(422).json({ error: '這個修改要求無法處理，換個說法試試', cost });
        const data = safeJsonParse(cleanJson(lastText(response)), null);
        if (!data || typeof data.caption !== 'string' || !data.caption.trim()) throw new Error('AI 回應格式錯誤，請重試');

        res.json({ caption: data.caption.trim(), reply: (data.reply || '改好了！').trim(), model, cost });
    } catch (error) {
        log('微調錯誤:', error.message);
        const { status, message } = toUserError(error);
        res.status(status).json({ error: message });
    }
});

app.get('/api/styles', (req, res) => res.json({ styles: STYLE_DEFINITIONS }));
app.get('/api/platforms', (req, res) => res.json({ platforms: Object.fromEntries(Object.entries(PLATFORMS).map(([k, p]) => [k, { name: p.name, limit: p.limit || null }])) }));

// 錯誤處理中間件
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: '圖片檔案大小超過限制（每張最大 10MB）' });
    }
    if (err instanceof multer.MulterError && (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')) {
        return res.status(400).json({ error: `一次最多上傳 ${MAX_IMAGES} 張照片` });
    }
    if (err && /圖片/.test(err.message)) return res.status(400).json({ error: err.message });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: '資料太大' });
    console.error('Unhandled error:', err);
    res.status(500).json({ error: '伺服器發生錯誤' });
});

if (require.main === module) {
    app.listen(port, '0.0.0.0', () => {
        console.log('🚀 貼文廚房已上線');
        console.log(`📍 本地端: http://localhost:${port}`);
        console.log(`🤖 預設模型: ${MODELS[DEFAULT_MODEL].label}（可在前端切換）`);
    });
}

module.exports = { app, PLATFORMS, STYLE_DEFINITIONS };
