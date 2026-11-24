# 貼文廚房 · AI 社群貼文產生器

上傳照片「點單」，Claude 幫你「出單」社群貼文，還能像聊天一樣微調。

**線上使用：** https://polo1364.github.io/SocialPostCreator/

純前端網頁：瀏覽器直接用你自己的 Claude API Key 呼叫 Claude，Key 只存在你的瀏覽器、不經過任何伺服器。放在 GitHub Pages 就能用，不需要後端。

## 功能

- 一次最多 5 張照片，自動轉正並調整到最適合辨識的解析度
- 先辨識照片（主廚筆記），再依風格寫貼文，邊寫邊印出來
- 品項（風格）：14 種內建＋自訂；每次出一則，單選一種或複選 1–6 種融合成一則
- **套餐**：把平台、品項、Hashtag、外語、口吻存成一組，一鍵套用
- **多組口吻**：例如「個人帳號」「店家粉專」，各自模仿不同語氣
- 主要為臉書設計：「準備發文」可裁成臉書比例、**照片加字做配圖**、複製替代文字、手機一鍵分享照片＋文案
- 也支援 IG、Threads、小紅書，會依平台調整長度、換行與 Hashtag
- 每張收據：聊天微調、切換與**並排比較版本**、單道重做、**發文前檢查**（錯字、容易過時的資訊、平台限制）、存成圖片
- 常用 Hashtag、外語版本（英／日／韓）、收藏、店家／景點資訊（Claude 上網查詢）
- 重新整理不會弄丟：照片、出餐區、出單中的進度、打到一半的字都會保留
- 訂單紀錄（含照片）存在瀏覽器裡；可匯出／匯入備份檔
- 每單與累計的估算費用、**每月預算提醒**
- PWA：可安裝到手機主畫面、沒網路也能打開、有新版本會提示
- 鍵盤操作與讀屏軟體：對話框焦點管理、Tab 循環、跳到點單的連結

## 本機預覽

```bash
npm install
npm start
```

打開 http://localhost:3000 （或 http://localhost:3000/SocialPostCreator/ 模擬 GitHub Pages 子路徑）。`server.js` 只是本機預覽用的靜態伺服器。

## 程式結構

- `index.html`：版面
- `public/kitchen.js`：提示詞、結構化輸出與呼叫 Claude 的流程（瀏覽器與 Node 共用）
- `public/app.js`：進入點與初始化
- `public/js/`：畫面邏輯，依功能分檔
  - `base.js` 動作登記表（最先載入）、`core.js` 共用狀態與工具
  - `form.js` 點單表、`profiles.js` 口吻／套餐／預算
  - `order.js` 出單與收據、`compare.js` 版本比較、`check.js` 發文前檢查
  - `publish.js` 準備發文、`overlay.js` 照片加字
  - `history.js` 訂單紀錄、重整還原、匯出匯入
  - `settings.js` 設定、`pwa.js` 安裝與更新、`a11y.js` 鍵盤與讀屏
- `sw.js`、`manifest.webmanifest`：PWA

所有路徑都是相對路徑，放在 GitHub Pages 的子路徑也能正常運作。

## 開發

```bash
npm test             # 自動測試（不會呼叫真正的 Claude API）
npm run build:css    # 修改 Tailwind class 後重新編譯 public/styles.css
npm run build:icons  # 重新產生 PWA 圖示
npm run build:sprite # 重新產生 public/icons.svg（只含用到的圖示）
```

新增 `public/js/` 底下的檔案時，記得加進 `sw.js` 的離線清單（測試會檢查）。

### 真 Key 冒煙測試

實際呼叫 Claude 跑一次出單＋微調，確認整條流程正常（會產生約 US$0.01–0.05 費用）：

```powershell
$env:ANTHROPIC_API_KEY="sk-ant-..."; npm run smoke
```

可加 `$env:SMOKE_IMAGE="C:\照片.jpg"` 用自己的照片。

`public/styles.css`、`public/icons.svg` 是編譯後的檔案，已一併提交，GitHub Pages 不需要額外建置。
