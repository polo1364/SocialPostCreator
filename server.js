const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const port = process.env.PORT || 3000;

// 設定 Multer 記憶體儲存
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { 
        fileSize: 10 * 1024 * 1024, // 限制 10MB
        files: 1
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const mimetype = allowedTypes.test(file.mimetype);
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('只允許上傳圖片檔案'));
    }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname));

// 路由
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// 使用 Gemini 2.5 Flash 模型
const MODEL_NAME = "gemini-2.0-flash-exp"; 

// 清理 JSON 回應
function cleanJson(text) {
    if (!text) return '[]';
    let cleanText = text.trim();
    
    // 移除 markdown 程式碼區塊標記
    cleanText = cleanText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    
    // 尋找 JSON 陣列或物件
    const firstBrace = cleanText.indexOf('[');
    const firstCurly = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf(']');
    const lastCurly = cleanText.lastIndexOf('}');
    
    // 判斷是陣列還是物件
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        if (firstCurly === -1 || firstBrace < firstCurly) {
            cleanText = cleanText.substring(firstBrace, lastBrace + 1);
        }
    }
    
    if (firstCurly !== -1 && lastCurly !== -1 && lastCurly > firstCurly) {
        if (firstBrace === -1 || firstCurly < firstBrace) {
            cleanText = cleanText.substring(firstCurly, lastCurly + 1);
        }
    }
    
    return cleanText.trim();
}

// 健康檢查端點
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 店家/景點搜尋 API：使用 Gemini 搜尋網路資訊
app.post('/api/search-place', async (req, res) => {
    try {
        const apiKey = req.headers['x-api-key'];
        if (!apiKey || !apiKey.trim()) {
            return res.status(401).json({ error: "請輸入有效的 API Key" });
        }

        const { placeName, location, placeType } = req.body;
        if (!placeName || !placeName.trim()) {
            return res.status(400).json({ error: "請輸入名稱" });
        }

        // 初始化 Gemini AI - 啟用 Google Search grounding 功能
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ 
            model: MODEL_NAME,
            tools: [{
                googleSearch: {}
            }],
            generationConfig: { 
                temperature: 0.3,
                topP: 0.8
            }
        });

        const searchQuery = location ? `${placeName} ${location}` : placeName;
        const isAttraction = placeType === 'attraction';
        
        let searchPrompt;
        
        if (isAttraction) {
            // 景點搜尋 prompt - 使用網路搜尋
            searchPrompt = `請使用網路搜尋功能，查詢「${searchQuery}」這個景點/旅遊地點的最新資訊。

請搜尋並提供：
1. 景點的正式名稱和類型
2. 地點位置
3. 網友評價和推薦原因
4. 特色亮點和必看重點
5. 最佳遊玩時間或季節
6. 門票或開放時間資訊（如有）
7. 周邊推薦景點

搜尋完成後，請整理成以下 JSON 格式回傳（請確保是有效的 JSON）：
{
  "found": true,
  "category": "attraction",
  "name": "景點名稱",
  "type": "景點類型",
  "signature": "主要特色",
  "location": "位置",
  "hours": "開放時間或null",
  "ticketInfo": "門票資訊或null",
  "reviews": ["網友評價1", "網友評價2", "網友評價3"],
  "bestTime": "最佳時間",
  "highlights": ["亮點1", "亮點2"],
  "nearby": ["周邊景點1", "周邊景點2"],
  "summary": "一句話介紹"
}

如果搜尋不到相關資訊，回傳：
{"found": false, "category": "attraction", "name": "${placeName}", "message": "找不到相關資訊"}`;
        } else {
            // 店家搜尋 prompt - 使用網路搜尋
            searchPrompt = `請使用網路搜尋功能，查詢「${searchQuery}」這間店家/餐廳的最新資訊和網友評價。

請搜尋並提供：
1. 店家的正式名稱和類型（咖啡廳/餐廳/甜點店等）
2. 地址或位置
3. 網友真實評價和推薦原因
4. 招牌餐點或特色商品
5. 價位範圍
6. 營業時間（如有）
7. 值得一提的亮點

搜尋完成後，請整理成以下 JSON 格式回傳（請確保是有效的 JSON）：
{
  "found": true,
  "category": "store",
  "name": "店家名稱",
  "type": "店家類型",
  "signature": "招牌餐點或特色",
  "location": "地址或位置",
  "hours": "營業時間或null",
  "priceRange": "價位範圍或null",
  "reviews": ["網友評價1", "網友評價2", "網友評價3"],
  "highlights": ["亮點1", "亮點2"],
  "summary": "一句話介紹"
}

如果搜尋不到相關資訊，回傳：
{"found": false, "category": "store", "name": "${placeName}", "message": "找不到相關資訊"}`;
        }

        const typeLabel = isAttraction ? '景點' : '店家';
        console.log(`[${new Date().toISOString()}] 正在使用 Google Search 搜尋${typeLabel}「${searchQuery}」...`);

        const result = await model.generateContent(searchPrompt);
        const response = await result.response;
        
        // 處理可能包含多個 parts 的回應（Google Search grounding）
        let responseText = '';
        if (response.candidates && response.candidates[0]) {
            const parts = response.candidates[0].content.parts;
            for (const part of parts) {
                if (part.text) {
                    responseText += part.text;
                }
            }
        }
        
        if (!responseText) {
            responseText = response.text();
        }
        
        console.log(`[${new Date().toISOString()}] 搜尋回應:`, responseText.substring(0, 200) + '...');
        
        const cleanedJson = cleanJson(responseText);
        let placeInfo;
        
        try {
            placeInfo = JSON.parse(cleanedJson);
        } catch (parseError) {
            console.error('JSON 解析錯誤:', parseError);
            // 如果解析失敗，嘗試從文字中提取資訊
            placeInfo = {
                found: true,
                category: isAttraction ? 'attraction' : 'store',
                name: placeName,
                type: isAttraction ? '景點' : '店家',
                signature: '特色待補充',
                location: location || '位置待確認',
                reviews: ['網友推薦'],
                highlights: [],
                summary: responseText.substring(0, 100)
            };
        }

        console.log(`[${new Date().toISOString()}] ${typeLabel}搜尋完成:`, placeInfo.found ? '找到' : '未找到');
        res.json({ placeInfo });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] 搜尋錯誤:`, error);
        res.status(500).json({ 
            error: "搜尋失敗，請稍後再試",
            placeInfo: { found: false, message: "搜尋服務暫時無法使用" }
        });
    }
});

// 相容舊的 API 端點
app.post('/api/search-store', async (req, res) => {
    req.body.placeType = 'store';
    req.url = '/api/search-place';
    app.handle(req, res);
});

// 風格定義
const STYLE_DEFINITIONS = {
    humorous: {
        name: "幽默搞笑",
        description: "用幽默、搞笑的語調，加入有趣的梗或比喻，讓人會心一笑",
        emoji: "😂🤣😆"
    },
    warm: {
        name: "溫馨感性",
        description: "用溫暖、感性的語調，傳達幸福感和正能量，讓人感受到溫度",
        emoji: "🥰💕✨"
    },
    foodie: {
        name: "美食專家",
        description: "用專業美食評論的角度，描述食物的色香味和用餐體驗",
        emoji: "🍽️😋🔥"
    },
    literary: {
        name: "文青詩意",
        description: "用文藝、詩意的筆觸，帶有意境和哲理的感悟",
        emoji: "📖🌿☕"
    },
    energetic: {
        name: "活力熱情",
        description: "用充滿活力、熱情奔放的語調，帶動氣氛和正能量",
        emoji: "🎉💪🔥"
    },
    minimalist: {
        name: "簡約俐落",
        description: "用簡短、有力的句子，直接表達重點，不囉嗦",
        emoji: "✓💯👌"
    },
    storytelling: {
        name: "故事敘述",
        description: "用說故事的方式，娓娓道來這次的體驗和感受",
        emoji: "📝🎬💭"
    },
    trendy: {
        name: "潮流網紅",
        description: "用時下流行的網路用語和梗，貼近年輕人的說話方式",
        emoji: "🔥💅✨"
    }
};

// 核心 API：產生貼文
app.post('/api/caption', upload.single('image'), async (req, res) => {
    try {
        const apiKey = req.headers['x-api-key'];
        if (!apiKey || !apiKey.trim()) {
            return res.status(401).json({ error: "請輸入有效的 API Key" });
        }

        if (!req.file) {
            return res.status(400).json({ error: "請上傳照片" });
        }

        const userDescription = (req.body.description || "這張照片").trim();
        const placeInfo = req.body.placeInfo ? JSON.parse(req.body.placeInfo) : null;
        const selectedStyles = req.body.styles ? JSON.parse(req.body.styles) : ['humorous', 'warm', 'foodie'];
        const rating = parseInt(req.body.rating) || 0; // 0 表示未選擇
        
        // 確保至少有3種風格
        const stylesToUse = selectedStyles.length >= 3 
            ? selectedStyles.slice(0, 5)  // 最多5種
            : ['humorous', 'warm', 'foodie'];
        
        // 星級對應的語調設定
        const RATING_TONES = {
            1: {
                mood: "失望、不滿意",
                direction: "表達失望的情緒，委婉但誠實地指出不足之處，提醒其他人注意",
                keywords: "可惜、失望、不推薦、踩雷、下次不會再來"
            },
            2: {
                mood: "普通偏下、有待加強",
                direction: "表達中性偏負面的感受，客觀指出優缺點，但整體不太滿意",
                keywords: "普通、還好、有待加強、期望落差"
            },
            3: {
                mood: "中規中矩、還可以",
                direction: "表達中性的感受，優缺點並陳，不特別推薦也不特別不推",
                keywords: "還行、中規中矩、普通、可以接受"
            },
            4: {
                mood: "不錯、滿意",
                direction: "表達正面的感受，推薦給朋友，但也可以提及小小的改進空間",
                keywords: "不錯、推薦、值得一試、會再來"
            },
            5: {
                mood: "超棒、非常推薦",
                direction: "表達非常滿意和興奮的情緒，大力推薦，用熱情的語調",
                keywords: "超讚、必訪、大推、太棒了、絕對要來"
            }
        };

        // 初始化 Gemini AI - 使用較高的溫度增加多樣性
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ 
            model: MODEL_NAME,
            generationConfig: { 
                responseMimeType: "application/json",
                temperature: 1.5,  // 高溫度確保每次生成都不同
                topP: 0.98,
                topK: 100  // 高 topK 增加詞彙多樣性
            } 
        });

        // 準備圖片資料
        const imagePart = {
            inlineData: {
                data: req.file.buffer.toString("base64"),
                mimeType: req.file.mimetype,
            },
        };

        // 建構店家/景點資訊區塊
        let placeContext = "";
        if (placeInfo && placeInfo.found) {
            const isAttraction = placeInfo.category === 'attraction';
            
            if (isAttraction) {
                placeContext = `
【景點真實資訊 - 請務必參考並融入貼文】
- 景點名稱：${placeInfo.name || '未知'}
- 類型：${placeInfo.type || '未知'}
- 主要特色：${placeInfo.signature || '未知'}
- 地點：${placeInfo.location || '未知'}
${placeInfo.ticketInfo ? `- 門票：${placeInfo.ticketInfo}` : ''}
${placeInfo.bestTime ? `- 最佳時間：${placeInfo.bestTime}` : ''}
${placeInfo.reviews && placeInfo.reviews.length > 0 ? `- 評價關鍵詞：${placeInfo.reviews.join('、')}` : ''}
${placeInfo.highlights && placeInfo.highlights.length > 0 ? `- 亮點：${placeInfo.highlights.join('、')}` : ''}
${placeInfo.nearby && placeInfo.nearby.length > 0 ? `- 周邊推薦：${placeInfo.nearby.join('、')}` : ''}
${placeInfo.summary ? `- 簡介：${placeInfo.summary}` : ''}

⚠️ 重要：貼文中提到的景點資訊必須符合以上事實，不可編造不存在的景觀或設施！
`;
            } else {
                placeContext = `
【店家真實資訊 - 請務必參考並融入貼文】
- 店名：${placeInfo.name || '未知'}
- 類型：${placeInfo.type || '未知'}
- 特色/招牌：${placeInfo.signature || '未知'}
- 地點：${placeInfo.location || '未知'}
${placeInfo.priceRange ? `- 價位：${placeInfo.priceRange}` : ''}
${placeInfo.reviews && placeInfo.reviews.length > 0 ? `- 評價關鍵詞：${placeInfo.reviews.join('、')}` : ''}
${placeInfo.highlights && placeInfo.highlights.length > 0 ? `- 亮點：${placeInfo.highlights.join('、')}` : ''}
${placeInfo.summary ? `- 簡介：${placeInfo.summary}` : ''}

⚠️ 重要：貼文中提到的店家資訊必須符合以上事實，不可編造不存在的餐點或特色！
`;
            }
        }

        // 建構風格要求
        const styleRequirements = stylesToUse.map((styleKey, index) => {
            const style = STYLE_DEFINITIONS[styleKey] || STYLE_DEFINITIONS.humorous;
            return `${index + 1}. 【${style.name}風格】${style.description}，可使用 ${style.emoji} 等相關表情`;
        }).join('\n');

        // 建構星級語調要求
        let ratingContext = "";
        if (rating > 0 && RATING_TONES[rating]) {
            const tone = RATING_TONES[rating];
            ratingContext = `
【用戶評價：${rating} 星 ⭐】
- 整體感受：${tone.mood}
- 貼文方向：${tone.direction}
- 建議使用的詞彙：${tone.keywords}
⚠️ 重要：所有貼文都必須反映這個 ${rating} 星的評價語調！`;
        }

        // 生成隨機元素增加多樣性（不包含任何數字或代碼）
        const now = new Date();
        
        // 隨機開場方式
        const openingStyles = [
            '用問句開頭引發好奇',
            '用感嘆句表達驚喜',
            '用對話口吻像在跟朋友聊天',
            '用描述場景的方式帶入',
            '用自言自語的內心獨白',
            '用倒敘法從結果說起',
            '用比喻或類比開場',
            '用誇張的形容詞開頭',
            '用反問句製造懸念',
            '直接切入主題不囉嗦'
        ];
        const randomOpening = openingStyles[Math.floor(Math.random() * openingStyles.length)];
        
        // 隨機寫作角度
        const perspectives = [
            '從味覺和嗅覺的感受出發',
            '從視覺美感的角度切入',
            '從情感和回憶的連結著手',
            '從分享好物的心情出發',
            '從日常小確幸的視角描述',
            '從真心推薦的立場分享',
            '從意外驚喜的發現切入',
            '從療癒放鬆的體驗出發'
        ];
        const randomPerspective = perspectives[Math.floor(Math.random() * perspectives.length)];
        
        // 隨機結尾方式
        const endings = [
            '用邀請大家留言的問句結尾',
            '用感性的人生感悟收尾',
            '用輕鬆的自嘲或吐槽結尾',
            '用期待再訪的話語結尾',
            '用強力推薦的呼籲結尾',
            '用簡短有力的一句話總結'
        ];
        const randomEnding = endings[Math.floor(Math.random() * endings.length)];
        
        // 隨機情境氛圍
        const moods = [
            '帶著悠閒愜意的氛圍',
            '帶著興奮期待的心情',
            '帶著溫馨幸福的感覺',
            '帶著驚喜發現的語氣',
            '帶著滿足享受的態度',
            '帶著輕鬆自在的調性'
        ];
        const randomMood = moods[Math.floor(Math.random() * moods.length)];

        // 優化的 Prompt - 強調多樣性和事實性
        const prompt = `你是一位台灣的專業社群媒體文案專家，擅長用繁體中文撰寫吸引人的動態貼文。

【語言規範】
- 全程使用繁體中文
- 可以使用 Emoji 表情符號
- 禁止出現任何英文、日文、俄文等外語
- 禁止出現任何亂碼、隨機字母或無意義的符號組合
- Hashtag 標籤必須是有意義的中文詞彙
${ratingContext}

【本次創作方向】
- 開場：${randomOpening}
- 視角：${randomPerspective}
- 結尾：${randomEnding}
- 氛圍：${randomMood}

任務：觀察這張圖片，結合用戶描述「${userDescription}」，創作 ${stylesToUse.length} 則風格各異的貼文。
${placeContext}

【風格要求】
${styleRequirements}

【重要規則】
1. 每則貼文的開頭必須完全不同
2. 每則貼文的句型結構必須有變化
3. 自然口語化，像真人在社群發文
4. 適當使用 Emoji 增加視覺效果
5. 長度控制在五十到兩百字
6. 如果加入 Hashtag，必須是有意義的中文標籤（如 #美食推薦 #週末好去處）
7. 絕對禁止在貼文中出現任何隨機代碼、亂碼或無意義的字母數字組合

請回傳 JSON 陣列：
[
  {"style": "風格名稱", "caption": "貼文內容"},
  ...
]`;

        console.log(`[${new Date().toISOString()}] 正在為「${userDescription}」生成 ${stylesToUse.length} 種風格貼文...`);

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const responseText = response.text();
        
        // 解析 JSON 回應
        const cleanedJson = cleanJson(responseText);
        let captionsData = JSON.parse(cleanedJson);

        // 處理回應格式
        let captions;
        if (Array.isArray(captionsData)) {
            if (typeof captionsData[0] === 'string') {
                // 舊格式相容
                captions = captionsData.map((caption, index) => ({
                    style: stylesToUse[index] ? STYLE_DEFINITIONS[stylesToUse[index]]?.name || '自由發揮' : '自由發揮',
                    caption: caption
                }));
            } else {
                captions = captionsData;
            }
        } else {
            throw new Error('API 回應格式不正確');
        }

        // 驗證回應格式
        if (!Array.isArray(captions) || captions.length === 0) {
            throw new Error('API 回應格式不正確');
        }

        console.log(`[${new Date().toISOString()}] 成功生成 ${captions.length} 則貼文`);
        res.json({ 
            captions,
            placeInfo: placeInfo || null
        });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error:`, error);
        
        let errorMessage = "生成失敗，請稍後再試";
        if (error.message.includes('API key')) {
            errorMessage = "API Key 無效或已過期";
        } else if (error.message.includes('圖片')) {
            errorMessage = error.message;
        } else if (error.message.includes('格式')) {
            errorMessage = "AI 回應格式錯誤，請重試";
        }
        
        res.status(500).json({ error: errorMessage });
    }
});

// 獲取可用風格列表
app.get('/api/styles', (req, res) => {
    res.json({ styles: STYLE_DEFINITIONS });
});

// 錯誤處理中間件
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: '圖片檔案大小超過限制（最大 10MB）' });
        }
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ error: '伺服器發生錯誤' });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 AI 社群貼文產生器已上線`);
    console.log(`📍 本地端: http://localhost:${port}`);
    console.log(`🤖 使用模型: ${MODEL_NAME}`);
    console.log(`✨ 功能：店家搜尋、多風格選擇、多樣化生成`);
});
