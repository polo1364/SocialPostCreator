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
    
    // 尋找 JSON 陣列
    const firstBrace = cleanText.indexOf('[');
    const lastBrace = cleanText.lastIndexOf(']');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleanText = cleanText.substring(firstBrace, lastBrace + 1);
    }
    
    return cleanText.trim();
}

// 健康檢查端點
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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

        // 初始化 Gemini AI
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ 
            model: MODEL_NAME,
            generationConfig: { 
                responseMimeType: "application/json",
                temperature: 0.9,
                topP: 0.95,
                topK: 40
            } 
        });

        // 準備圖片資料
        const imagePart = {
            inlineData: {
                data: req.file.buffer.toString("base64"),
                mimeType: req.file.mimetype,
            },
        };

        // 優化的 Prompt
        const prompt = `你是一位專業的社群媒體(Facebook/Instagram)文案專家，擅長撰寫吸引人且互動性高的動態貼文。

任務：觀察這張圖片，並結合用戶提供的背景描述「${userDescription}」，創作 3 則不同風格、高品質的貼文內容。

要求：
1. 貼文要自然、口語化，符合現代社群媒體調性
2. 適當加入相關的 Emoji 表情符號增加視覺吸引力
3. 三則貼文風格應包含：
   - 幽默有趣、輕鬆活潑
   - 感性抒情、有溫度
   - 簡短有力、直接明確
4. 每則貼文長度控制在 50-150 字之間
5. 內容要能引發互動（按讚、留言、分享）

請回傳一個純 JSON 字串陣列，格式如下：
["貼文內容1...", "貼文內容2...", "貼文內容3..."]`;

        console.log(`[${new Date().toISOString()}] 正在為描述「${userDescription}」生成貼文...`);

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const responseText = response.text();
        
        // 解析 JSON 回應
        const cleanedJson = cleanJson(responseText);
        const captions = JSON.parse(cleanedJson);

        // 驗證回應格式
        if (!Array.isArray(captions) || captions.length === 0) {
            throw new Error('API 回應格式不正確');
        }

        console.log(`[${new Date().toISOString()}] 成功生成 ${captions.length} 則貼文`);
        res.json({ captions });

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
});