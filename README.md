# 貼文廚房 · AI 社群貼文產生器

上傳照片「點單」，Claude 幫你「出單」社群貼文，還能像聊天一樣微調。

**線上使用：** https://polo1364.github.io/SocialPostCreator/

純前端網頁：瀏覽器直接用你自己的 Claude API Key 呼叫 Claude，Key 只存在你的瀏覽器、不經過任何伺服器。放在 GitHub Pages 就能用，不需要後端。

## 功能

- 一次最多 5 張照片，自動轉正並調整到最適合辨識的解析度
- 先辨識照片（主廚筆記），再依風格寫 3–5 則貼文，邊寫邊印出來
- 主要為臉書設計：預設臉書寫法；「準備發文」可裁成臉書比例（1:1、4:5、1.91:1、限動 9:16）、複製替代文字，手機一鍵分享照片＋文案
- 也支援 IG、Threads、小紅書，會依平台調整長度、換行與 Hashtag
- 常用 Hashtag、外語版本（英／日／韓）、收藏、紀錄匯出／匯入
- 「我的口吻」：貼幾篇自己寫過的貼文，讓 Claude 模仿你的語氣
- 店家／景點資訊：Claude 上網查詢後融入貼文
- 每張收據都能聊天微調、切換版本、單道重做、存成圖片
- 訂單紀錄（含照片）存在瀏覽器裡，可重新打開接著改
- 顯示每單與累計的估算費用
- PWA：可加到手機主畫面，從相簿「分享」照片直接送進來

## 本機預覽

```bash
npm install
npm start
```

打開 http://localhost:3000 （或 http://localhost:3000/SocialPostCreator/ 模擬 GitHub Pages 子路徑），在右上角設定填入自己的 Claude API Key（到 [Anthropic Console](https://console.anthropic.com/settings/keys) 取得）。`server.js` 只是本機預覽用的靜態伺服器。

## 程式結構

- `index.html`：版面
- `public/app.js`：畫面與互動
- `public/kitchen.js`：提示詞、結構化輸出與呼叫 Claude 的流程（瀏覽器與 Node 共用）
- `sw.js`、`manifest.webmanifest`：PWA

所有路徑都是相對路徑，放在 GitHub Pages 的子路徑也能正常運作。

## 開發

```bash
npm test            # 自動測試（不會呼叫真正的 Claude API）
npm run build:css   # 修改 index.html 的 Tailwind class 後重新編譯 public/styles.css
npm run build:icons # 重新產生 PWA 圖示
npm run build:sprite # 重新產生 public/icons.svg（只含用到的圖示）
```

### 真 Key 冒煙測試

實際呼叫 Claude 跑一次出單＋微調，確認整條流程正常（會產生約 US$0.01–0.05 費用）：

```powershell
$env:ANTHROPIC_API_KEY="sk-ant-..."; npm run smoke
```

可加 `$env:SMOKE_IMAGE="C:照片.jpg"` 用自己的照片。

`public/styles.css`、`public/icons.svg` 是編譯後的檔案，已一併提交，GitHub Pages 不需要額外建置。
