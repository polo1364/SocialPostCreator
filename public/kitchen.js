// 貼文廚房的「廚房」：所有提示詞、結構化輸出 schema 與呼叫 Claude 的流程。
// 瀏覽器與 Node（冒煙測試、單元測試）共用；不直接 import SDK，由呼叫端把 Anthropic 類別傳進來。

// ===== 模型 =====
export const MODELS = {
    'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', fallback: true, webSearch: 'web_search_20260209' },
    'claude-opus-5-5': { label: 'Claude Opus 5.5', fallback: true, webSearch: 'web_search_20260209' },
    'claude-haiku-5-5': { label: 'Claude Haiku 5.5', fallback: false, webSearch: 'web_search_20250305' }
};
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export function resolveModel(m) {
    return MODELS[m] ? m : DEFAULT_MODEL;
}

// Opus / Sonnet 開啟伺服器端拒答備援（fallbacks: "default"）
export function buildParams(model, params) {
    const out = { model, ...params };
    if (MODELS[model].fallback) {
        out.betas = [FALLBACK_BETA];
        out.fallbacks = 'default';
    }
    return out;
}

// 瀏覽器直接呼叫 Claude：Key 只存在使用者自己的瀏覽器，不經過任何伺服器
export function createClient(Anthropic, apiKey) {
    return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

export function toUserError(error, Anthropic) {
    const is = name => Anthropic && Anthropic[name] && error instanceof Anthropic[name];
    if (is('AuthenticationError')) return 'API Key 無效或已被撤銷，請重新設定';
    if (is('PermissionDeniedError')) return '此 API Key 沒有使用該模型或功能的權限';
    if (is('RateLimitError')) return '請求太頻繁或額度不足，請稍後再試';
    if (is('BadRequestError')) {
        const msg = error.message || '';
        if (/credit|balance/i.test(msg)) return '帳戶餘額不足，請至 Anthropic Console 儲值';
        return '請求格式有誤：' + msg.slice(0, 120);
    }
    if (is('APIConnectionError')) return '無法連線到 Claude API，請檢查網路';
    if (is('APIError')) return 'Claude API 暫時無法使用，請稍後再試';
    return error?.message || '發生錯誤，請稍後再試';
}

// ===== 費用估算（官方每百萬 tokens 牌價，僅供參考） =====
export const PRICES = {
    'claude-opus-5-5': { input: 4, output: 20 },
    'claude-sonnet-5-5': { input: 2, output: 10 },
    'claude-haiku-5-5': { input: 0.1, output: 0.5 }
};
const WEB_SEARCH_PER_REQUEST = 10 / 1000;

export function estimateCost(model, usage) {
    const p = PRICES[model];
    if (!p || !usage) return null;
    const input = usage.input_tokens || 0;
    const output = usage.output_tokens || 0;
    const cacheWrite = usage.cache_creation_input_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const searches = usage.server_tool_use?.web_search_requests || 0;
    const usd = (input * p.input + cacheWrite * p.input * 1.25 + cacheRead * p.input * 0.1 + output * p.output) / 1e6
        + searches * WEB_SEARCH_PER_REQUEST;
    return { usd: Math.round(usd * 1e6) / 1e6, inputTokens: input + cacheWrite + cacheRead, outputTokens: output, searches };
}

export function sumCosts(list) {
    const valid = list.filter(Boolean);
    if (!valid.length) return null;
    return valid.reduce((a, c) => ({
        usd: Math.round((a.usd + c.usd) * 1e6) / 1e6,
        inputTokens: a.inputTokens + c.inputTokens,
        outputTokens: a.outputTokens + c.outputTokens,
        searches: a.searches + c.searches
    }));
}

// ===== JSON 工具 =====
// 把串流中還沒寫完的 JSON 補上結尾後解析；補不起來就回傳 null，等下一段再試
export function repairJson(text) {
    if (!text) return null;
    const start = text.indexOf('{');
    if (start === -1) return null;
    let s = text.slice(start);
    const stack = [];
    let inString = false;
    let escaped = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{' || ch === '[') stack.push(ch);
        else if (ch === '}' || ch === ']') stack.pop();
    }
    if (inString) {
        if (escaped) s = s.slice(0, -1);
        s = s.replace(/\\u[0-9a-fA-F]{0,3}$/, '');
        s += '"';
    }
    s = s.replace(/[\s,]+$/, '');
    for (let i = stack.length - 1; i >= 0; i--) {
        s = s.replace(/[\s,]+$/, '');
        s += stack[i] === '{' ? '}' : ']';
    }
    return s;
}

export function parsePartialJson(text) {
    const repaired = repairJson(text);
    if (!repaired) return null;
    try { return JSON.parse(repaired); } catch { return null; }
}

export function cleanJson(text) {
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

// 有拒答備援時可能有多個 text 區塊，以最後一個為準
export function lastText(message) {
    const blocks = (message.content || []).filter(b => b.type === 'text');
    return blocks.length ? blocks[blocks.length - 1].text : '';
}

// ===== 風格、平台、語調 =====
export const STYLE_DEFINITIONS = {
    humorous: { name: '幽默搞笑', description: '用幽默、搞笑的語調，加入有趣的梗或比喻，讓人會心一笑', emoji: '😂🤣😆' },
    warm: { name: '溫馨感性', description: '用溫暖、感性的語調，傳達幸福感和正能量，讓人感受到溫度', emoji: '🥰💕✨' },
    foodie: { name: '美食專家', description: '用專業美食評論的角度，描述食物的色香味和用餐體驗', emoji: '🍽️😋🔥' },
    literary: { name: '文青詩意', description: '用文藝、詩意的筆觸，帶有意境和哲理的感悟', emoji: '📖🌿☕' },
    energetic: { name: '活力熱情', description: '用充滿活力、熱情奔放的語調，帶動氣氛和正能量', emoji: '🎉💪🔥' },
    minimalist: { name: '簡約俐落', description: '用簡短、有力的句子，直接表達重點，不囉嗦', emoji: '✓💯👌' },
    storytelling: { name: '故事敘述', description: '用說故事的方式，娓娓道來這次的體驗和感受', emoji: '📝🎬💭' },
    trendy: { name: '潮流網紅', description: '用時下流行的網路用語和梗，貼近年輕人的說話方式', emoji: '🔥💅✨' },
    roast: { name: '毒舌吐槽', description: '犀利又好笑的吐槽口吻，嘴上嫌棄但其實喜歡，不人身攻擊也不惡意', emoji: '😏🙄🤣' },
    review: { name: '開箱評測', description: '像部落客開箱，條列重點、優缺點、價格與 CP 值，最後給個人評分', emoji: '🔍📝⭐' },
    travel: { name: '旅遊日記', description: '像旅行日記，記錄行程、交通、當下心情與途中的小發現', emoji: '✈️🗺️📸' },
    retro: { name: '懷舊復古', description: '帶點懷舊情懷，連結童年回憶或老時光的味道', emoji: '📻🎞️🕰️' },
    oneliner: { name: '一句話', description: '只用一到兩句話，短而有記憶點，適合當圖說', emoji: '💬✨' },
    elder: { name: '長輩圖風', description: '模仿長輩圖的祝福語氣，早安、平安、正能量滿滿，帶點幽默', emoji: '🌸🙏☀️' }
};

export const MAX_STYLES = 6;
export const MAX_COPIES = 3;

// 使用者自訂的品項：key 一律以 custom- 開頭，名稱與說明有長度上限，避免塞進奇怪的長文
export function sanitizeCustomStyles(custom) {
    const out = {};
    if (!custom || typeof custom !== 'object') return out;
    for (const [key, v] of Object.entries(custom).slice(0, 20)) {
        if (!/^custom-[\w-]{1,40}$/.test(key) || !v || typeof v !== 'object') continue;
        const name = String(v.name || '').trim().slice(0, 12);
        if (!name) continue;
        out[key] = {
            name,
            description: String(v.description || '').trim().slice(0, 120) || `用「${name}」的風格來寫`,
            emoji: String(v.emoji || '').trim().slice(0, 4) || '✍️'
        };
    }
    return out;
}

// 決定這次要寫哪些風格：可單選（1 道，可出多份）或複選（1–6 道）
export function resolveStyles({ styles, copies, redoStyle, customStyles } = {}) {
    const all = { ...STYLE_DEFINITIONS, ...sanitizeCustomStyles(customStyles) };
    if (redoStyle && all[redoStyle]) return { keys: [redoStyle], all };
    const valid = [...new Set(Array.isArray(styles) ? styles.filter(k => all[k]) : [])].slice(0, MAX_STYLES);
    if (!valid.length) return { keys: ['humorous'], all };
    const n = Math.min(Math.max(parseInt(copies, 10) || 1, 1), MAX_COPIES);
    if (valid.length === 1 && n > 1) return { keys: Array(n).fill(valid[0]), all };
    return { keys: valid, all };
}

export const PLATFORMS = {
    general: { name: '不指定', length: '每則約五十到兩百字', rules: '一般社群貼文寫法，適當換行。' },
    instagram: { name: 'Instagram', length: '每則約八十到兩百五十字', limit: 2200, rules: '寫給 Instagram：第一行就要抓住目光；段落之間空一行；可以用 Emoji 當段落開頭；Hashtag 5 到 10 個，全部集中放在文末。' },
    threads: { name: 'Threads', length: '每則五十到一百五十字，絕對不可超過 500 字（Emoji 與 Hashtag 都算）', limit: 500, rules: '寫給 Threads：像隨手發文的口語短句，可以帶一點吐槽或問句引發回覆；Hashtag 最多 1 個或不用。' },
    facebook: { name: 'Facebook', length: '每則約一百到三百字', rules: '寫給 Facebook：可以寫得完整、有故事性，像跟朋友分享；Hashtag 0 到 3 個。' },
    xiaohongshu: { name: '小紅書', length: '每則約一百五十到四百字', limit: 1000, rules: '寫給小紅書：第一行是二十字內、含 Emoji 的吸睛標題；內文分點或分段、大量使用 Emoji；文末放 5 到 10 個 Hashtag。仍使用繁體中文。' }
};

export function resolvePlatform(value) {
    return PLATFORMS[value] ? value : 'general';
}

export const LANGUAGES = { en: '英文', ja: '日文', ko: '韓文' };

export function resolveLanguage(value) {
    return LANGUAGES[value] ? value : null;
}

function buildTranslationContext(lang) {
    if (!lang) return '每則的 translation 一律填空字串。';
    return `每則另外提供 translation：把該則貼文自然地翻成${LANGUAGES[lang]}，像當地人寫的社群貼文，保留 Emoji 與換行；Hashtag 可翻譯或保留原文。`;
}

export function cleanHashtags(value) {
    if (typeof value !== 'string') return [];
    return [...new Set(value.split(/[\s,，、#＃]+/)
        .map(t => t.trim())
        .filter(t => t && t.length <= 30))]
        .slice(0, 10)
        .map(t => '#' + t);
}

function buildHashtagContext(value) {
    const tags = cleanHashtags(value);
    if (!tags.length) return '';
    return `【使用者的常用 Hashtag】${tags.join(' ')}：每則都要原樣放在文末；平台建議的 Hashtag 數量若較少，就只放這些、不另外加。`;
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

export const CAPTIONS_SCHEMA = {
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
        alt_texts: { type: 'array', items: { type: 'string' } },
        captions: {
            type: 'array',
            items: {
                type: 'object',
                properties: { style: { type: 'string' }, caption: { type: 'string' }, translation: { type: 'string' } },
                required: ['style', 'caption', 'translation'],
                additionalProperties: false
            }
        }
    },
    required: ['image_analysis', 'alt_texts', 'captions'],
    additionalProperties: false
};

export const REFINE_SCHEMA = {
    type: 'object',
    properties: { caption: { type: 'string' }, translation: { type: 'string' }, reply: { type: 'string' } },
    required: ['caption', 'translation', 'reply'],
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

// ===== 出單：組出請求 =====
// images: [{ mediaType, data(base64) }]
export function buildCaptionRequest(opts) {
    const images = (opts.images || []).slice(0, 5);
    if (!images.length) throw new Error('請上傳照片');
    const multi = images.length > 1;
    const model = resolveModel(opts.model);
    const platform = resolvePlatform(opts.platform);
    const language = resolveLanguage(opts.language);
    const userDescription = String(opts.description || (multi ? '這組照片' : '這張照片')).trim().slice(0, 1000);
    const rating = parseInt(opts.rating, 10) || 0;
    const { keys: stylesToUse, all: styleDefs } = resolveStyles(opts);
    const redoStyle = opts.redoStyle && styleDefs[opts.redoStyle] ? opts.redoStyle : null;
    const avoidCaption = typeof opts.avoidCaption === 'string' ? opts.avoidCaption.slice(0, 2000) : '';
    const sameStyle = stylesToUse.length > 1 && stylesToUse.every(k => k === stylesToUse[0]);

    const styleRequirements = stylesToUse.map((key, i) => {
        const s = styleDefs[key];
        return `${i + 1}. 【${s.name}】${s.description}，可使用 ${s.emoji} 等相關表情`;
    }).join('\n');

    const photoIntro = multi
        ? `以下共有 ${images.length} 張照片（已標上「照片 1」到「照片 ${images.length}」），來自同一次經驗。請把它們當成一組來看，貼文可以串起多張照片的內容（例如餐點、環境、店外觀），但不要逐張流水帳。`
        : '觀察這張圖片。';
    const countText = stylesToUse.length === 1 ? '一則貼文'
        : sameStyle ? `${stylesToUse.length} 則都是「${styleDefs[stylesToUse[0]].name}」風格、但切入角度與寫法都明顯不同的貼文`
        : `${stylesToUse.length} 則風格各異的貼文`;
    const redoText = redoStyle && avoidCaption
        ? `\n【這次是重做】下面是上一版，請寫一則角度、開頭、句型都明顯不同的新版本：\n<previous_caption>\n${avoidCaption}\n</previous_caption>\n`
        : '';

    const prompt = `${photoIntro}結合用戶描述「${userDescription}」，創作 ${countText}。
${buildRatingContext(rating)}
${buildPlaceContext(opts.placeInfo)}
${buildVoiceContext(opts.voiceSamples)}
${buildHashtagContext(opts.hashtags)}

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

接著填 alt_texts：依照片順序，為每張照片寫一段替代文字（給視障者的讀屏軟體用，也可貼到臉書照片的「替代文字」），客觀描述畫面內容，四十到一百字，不加 Hashtag、Emoji 或行銷語氣。

最後輸出 captions 陣列，每項的 style 填上方的風格名稱（例如「幽默搞笑」），caption 填貼文內容。
${buildTranslationContext(language)}`;

    const params = buildParams(model, {
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: CAPTIONS_SCHEMA } },
        messages: [{
            role: 'user',
            content: [
                ...images.flatMap((img, i) => [
                    ...(multi ? [{ type: 'text', text: `照片 ${i + 1}：` }] : []),
                    { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } }
                ]),
                { type: 'text', text: prompt }
            ]
        }]
    });
    return { params, model, platform, language, imageCount: images.length, styleCount: stylesToUse.length };
}

// 出單（串流）。onPartial({ analysis, captions }) 會在每次有新文字時被呼叫
export async function streamCaptions(client, opts, onPartial = () => {}) {
    const { params, model, platform, language, imageCount } = buildCaptionRequest(opts);
    const stream = client.beta.messages.stream(params);

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
            onPartial(JSON.parse(snapshot));
        }
    };
    // 每個 text 區塊重新累積（拒答備援換模型時會開新區塊）
    stream.on('streamEvent', ev => {
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
            if (acc) onPartial({ analysis: null, captions: [] });
            acc = '';
            lastSent = '';
        } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            acc += ev.delta.text;
            if (!timer) timer = setTimeout(flush, 70);
        }
    });

    const response = await stream.finalMessage();
    if (timer) { clearTimeout(timer); timer = null; }
    const cost = estimateCost(model, response.usage);

    const fail = message => Object.assign(new Error(message), { cost });
    if (response.stop_reason === 'refusal') throw fail('AI 無法處理這些照片或描述，請換照片或調整描述');
    if (response.stop_reason === 'max_tokens') throw fail('回應過長被截斷，請減少風格數量後重試');

    const data = safeJsonParse(cleanJson(lastText(response)), null);
    const captions = Array.isArray(data?.captions) ? data.captions.filter(c => c && typeof c.caption === 'string' && c.caption.trim()) : [];
    if (!captions.length) throw fail('AI 回應格式錯誤，請重試');
    const altTexts = Array.isArray(data?.alt_texts) ? data.alt_texts.filter(t => typeof t === 'string').slice(0, imageCount) : [];
    return { captions, imageAnalysis: data?.image_analysis || null, altTexts, model, platform, language, cost };
}

// ===== 微調 =====
export function buildRefineRequest(opts) {
    const { caption, style, instruction, description, imageAnalysis, placeInfo, rating, history, platform, voiceSamples, hashtags, language } = opts || {};
    if (typeof caption !== 'string' || !caption.trim()) throw new Error('缺少要修改的貼文');
    if (typeof instruction !== 'string' || !instruction.trim()) throw new Error('請輸入想怎麼改');
    const model = resolveModel(opts.model);
    const platformKey = resolvePlatform(platform);

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
${buildHashtagContext(hashtags)}
${description ? `使用者原本的描述：「${String(description).slice(0, 1000)}」\n` : ''}${RATING_TONES[r] ? `使用者給了 ${r} 星（${RATING_TONES[r].mood}），語調要符合。\n` : ''}貼文風格：${String(style || '自由發揮').slice(0, 20)}
${buildPlatformContext(platformKey)}（長度：${PLATFORMS[platformKey].length}，除非使用者這次要求改變長度）
${pastSteps ? `\n先前已做過的修改（請維持這些要求）：\n${pastSteps}\n` : ''}
<current_caption>
${caption.slice(0, 3000)}
</current_caption>

使用者這次的要求：「${instruction.slice(0, 500)}」

caption 填改寫後的完整貼文；${buildTranslationContext(resolveLanguage(language))}reply 用一句輕鬆口語的話回覆使用者你改了什麼（二十字內）。`;

    const params = buildParams(model, {
        max_tokens: 8000,
        system,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: REFINE_SCHEMA } },
        messages: [{ role: 'user', content: prompt }]
    });
    return { params, model };
}

export async function refineCaption(client, opts) {
    const { params, model } = buildRefineRequest(opts);
    const response = await client.beta.messages.create(params);
    const cost = estimateCost(model, response.usage);
    if (response.stop_reason === 'refusal') throw Object.assign(new Error('這個修改要求無法處理，換個說法試試'), { cost });
    const data = safeJsonParse(cleanJson(lastText(response)), null);
    if (!data || typeof data.caption !== 'string' || !data.caption.trim()) throw Object.assign(new Error('AI 回應格式錯誤，請重試'), { cost });
    return { caption: data.caption.trim(), translation: (data.translation || '').trim(), reply: (data.reply || '改好了！').trim(), model, cost };
}

// ===== 店家/景點搜尋（Claude 的 web search 伺服器工具） =====
export function buildSearchPrompt({ placeName, location, placeType }) {
    const isAttraction = placeType === 'attraction';
    const searchQuery = location ? `${placeName} ${location}` : placeName;
    const schema = isAttraction
        ? `{"found": true, "category": "attraction", "name": "景點名稱", "type": "景點類型", "signature": "主要特色", "location": "位置", "hours": "開放時間或 null", "ticketInfo": "門票資訊或 null", "reviews": ["網友評價關鍵詞"], "bestTime": "最佳造訪時間", "highlights": ["亮點"], "nearby": ["周邊景點"], "summary": "一句話介紹"}`
        : `{"found": true, "category": "store", "name": "店家名稱", "type": "店家類型（咖啡廳/餐廳/甜點店等）", "signature": "招牌餐點或特色", "location": "地址或位置", "hours": "營業時間或 null", "priceRange": "價位範圍或 null", "reviews": ["網友評價關鍵詞"], "highlights": ["亮點"], "summary": "一句話介紹"}`;
    return `請用網路搜尋查詢「${searchQuery}」這個${isAttraction ? '景點/旅遊地點' : '店家/餐廳'}的最新資訊與網友評價。

只根據搜尋到的內容整理，查不到的欄位填 null，不要編造。所有文字使用繁體中文。
最後只輸出一個 JSON 物件，不要任何其他文字，格式如下：
${schema}

如果完全查不到，輸出：
{"found": false, "category": "${isAttraction ? 'attraction' : 'store'}", "name": ${JSON.stringify(String(placeName))}, "message": "找不到相關資訊"}`;
}

export async function searchPlace(client, { placeName, location, placeType, model: m }) {
    if (!placeName || !String(placeName).trim()) throw new Error('請輸入名稱');
    const model = resolveModel(m);
    const isAttraction = placeType === 'attraction';
    const messages = [{ role: 'user', content: buildSearchPrompt({ placeName, location, placeType }) }];
    const tools = [{ type: MODELS[model].webSearch, name: 'web_search', max_uses: 5 }];
    const costs = [];
    let response;
    // 伺服器工具回合可能以 pause_turn 暫停，最多續跑 3 次
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
    if (response.stop_reason === 'refusal') return { placeInfo: { found: false, message: '此查詢無法處理' }, cost };
    const text = lastText(response);
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
    return { placeInfo, cost };
}
