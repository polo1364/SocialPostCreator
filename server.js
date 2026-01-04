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

        // 初始化 Gemini AI
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ 
            model: MODEL_NAME,
            generationConfig: { 
                responseMimeType: "application/json",
                temperature: 0.3,
                topP: 0.8
            }
        });

        const searchQuery = location ? `${placeName} ${location}` : placeName;
        const isAttraction = placeType === 'attraction';
        
        let searchPrompt;
        
        if (isAttraction) {
            // 景點搜尋 prompt
            searchPrompt = `請幫我搜尋「${searchQuery}」這個景點/旅遊地點的相關資訊。

請提供以下資訊（如果找不到某項資訊請填 null）：
1. 景點全名
2. 景點類型（例如：自然景觀、歷史古蹟、主題樂園、博物館、海灘、山景、夜市、老街等）
3. 主要特色或必看亮點（例如：日出、夜景、櫻花、古蹟、美食等）
4. 地址或所在區域
5. 開放時間（如有）
6. 門票資訊（如有）
7. 網路上的評價關鍵詞（例如：風景優美、人潮多、適合拍照、親子友善等）
8. 最佳遊玩季節或時間
9. 周邊推薦（如有）

請以 JSON 格式回傳，格式如下：
{
  "found": true,
  "category": "attraction",
  "name": "景點全名",
  "type": "景點類型",
  "signature": "主要特色或必看亮點",
  "location": "地址或所在區域",
  "hours": "開放時間或 null",
  "ticketInfo": "門票資訊或 null",
  "reviews": ["評價關鍵詞1", "評價關鍵詞2"],
  "bestTime": "最佳遊玩時間或季節",
  "highlights": ["亮點1", "亮點2"],
  "nearby": ["周邊推薦1", "周邊推薦2"],
  "summary": "一句話簡介這個景點"
}

如果完全找不到這個景點的資訊，請回傳：
{
  "found": false,
  "category": "attraction",
  "name": "${placeName}",
  "message": "找不到此景點的詳細資訊，建議手動補充描述"
}`;
        } else {
            // 店家搜尋 prompt
            searchPrompt = `請幫我搜尋「${searchQuery}」這間店家/餐廳的相關資訊。

請提供以下資訊（如果找不到某項資訊請填 null）：
1. 店家全名
2. 店家類型（例如：咖啡廳、餐廳、甜點店、早午餐等）
3. 主要特色或招牌（例如：招牌餐點、特色服務）
4. 地址或地區
5. 營業時間（如有）
6. 價位範圍（如有）
7. 網路上的評價關鍵詞（例如：氣氛好、餐點精緻、服務親切等）
8. 任何值得一提的亮點

請以 JSON 格式回傳，格式如下：
{
  "found": true,
  "category": "store",
  "name": "店家全名",
  "type": "店家類型",
  "signature": "招牌特色",
  "location": "地址或地區",
  "hours": "營業時間或 null",
  "priceRange": "價位範圍或 null",
  "reviews": ["評價關鍵詞1", "評價關鍵詞2"],
  "highlights": ["亮點1", "亮點2"],
  "summary": "一句話簡介這間店"
}

如果完全找不到這間店的資訊，請回傳：
{
  "found": false,
  "category": "store",
  "name": "${placeName}",
  "message": "找不到此店家的詳細資訊，建議手動補充描述"
}`;
        }

        const typeLabel = isAttraction ? '景點' : '店家';
        console.log(`[${new Date().toISOString()}] 正在搜尋${typeLabel}「${searchQuery}」...`);

        const result = await model.generateContent(searchPrompt);
        const response = await result.response;
        const responseText = response.text();
        
        const cleanedJson = cleanJson(responseText);
        const placeInfo = JSON.parse(cleanedJson);

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
        
        // 確保至少有3種風格
        const stylesToUse = selectedStyles.length >= 3 
            ? selectedStyles.slice(0, 5)  // 最多5種
            : ['humorous', 'warm', 'foodie'];

        // 初始化 Gemini AI - 使用較高的溫度增加多樣性
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ 
            model: MODEL_NAME,
            generationConfig: { 
                responseMimeType: "application/json",
                temperature: 1.2,  // 提高溫度增加多樣性
                topP: 0.95,
                topK: 64  // 增加 topK 增加多樣性
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

        // 生成隨機種子增加多樣性
        const randomSeed = Math.floor(Math.random() * 10000);
        const timeOfDay = new Date().getHours();
        const randomAdjectives = ['超棒的', '絕美的', '驚艷的', '療癒的', '完美的', '夢幻的', '精彩的', '難忘的'];
        const randomAdj = randomAdjectives[Math.floor(Math.random() * randomAdjectives.length)];

        // 優化的 Prompt - 強調多樣性和事實性
        const prompt = `你是一位專業的社群媒體(Facebook/Instagram)文案專家，擅長撰寫吸引人且真實的動態貼文。

【創意種子：${randomSeed}】- 請基於這個數字發揮獨特創意，讓每次生成都不一樣！
【今日靈感詞：${randomAdj}】- 可以融入這個詞彙增加新鮮感

任務：觀察這張圖片，並結合用戶提供的背景描述「${userDescription}」，創作 ${stylesToUse.length} 則完全不同風格的貼文。
${placeContext}

【風格要求 - 每則貼文必須有明顯不同的語調和表達方式】
${styleRequirements}

【重要規則】
1. 每則貼文必須風格鮮明且差異明顯，不可雷同
2. 貼文要自然、口語化，符合現代社群媒體調性
3. 適當加入相關的 Emoji 表情符號增加視覺吸引力
4. 每則貼文長度控制在 50-200 字之間
5. 內容要能引發互動（按讚、留言、分享）
6. 如果有店家資訊，務必參考真實資料，不可編造
7. 避免使用太過制式的開頭（不要每則都用「今天」開頭）
8. 可以用問句、感嘆句、對話式等多種開頭方式
9. 避免重複使用相同的表達方式和句型

請回傳一個 JSON 陣列，格式如下：
[
  {"style": "風格名稱", "caption": "貼文內容1..."},
  {"style": "風格名稱", "caption": "貼文內容2..."},
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
