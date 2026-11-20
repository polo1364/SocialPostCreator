# 貼文廚房 · AI 社群貼文產生器

上傳照片「點單」，Claude 幫你「出單」社群貼文，還能像聊天一樣微調。

## 功能

- 一次最多 5 張照片，自動轉正並調整到最適合辨識的解析度
- 先辨識照片（主廚筆記），再依風格寫 3–5 則貼文，邊寫邊印出來
- 選發文平台：IG、Threads、FB、小紅書，會依平台調整長度、換行與 Hashtag
- 「我的口吻」：貼幾篇自己寫過的貼文，讓 Claude 模仿你的語氣
- 店家／景點資訊：Claude 上網查詢後融入貼文
- 每張收據都能聊天微調、切換版本、單道重做、存成圖片
- 訂單紀錄（含照片）存在瀏覽器裡，可重新打開接著改
- 顯示每單與累計的估算費用
- PWA：可加到手機主畫面，從相簿「分享」照片直接送進來

## 本機執行

```bash
npm install
npm start
```

打開 http://localhost:3000 ，在右上角設定填入自己的 Claude API Key（到 [Anthropic Console](https://console.anthropic.com/settings/keys) 取得）。

## 站長模式（選用）

在伺服器設定環境變數，就能讓沒有 API Key 的人用你的額度：

| 變數 | 說明 |
|---|---|
| `ANTHROPIC_API_KEY` | 站長的 Claude API Key；設定後才會開啟站長模式 |
| `ACCESS_PASSWORD` | 通行碼；建議一定要設，否則任何人都能用你的額度 |
| `SERVER_RATE_LIMIT` | 每個 IP 每小時可用次數，預設 40 |

使用者在設定裡切到「站長通行碼」並輸入通行碼即可使用；自己填了 Key 的人仍然用自己的 Key。

## 開發

```bash
npm test            # 後端測試（不會呼叫真正的 Claude API）
npm run build:css   # 修改 index.html 的 Tailwind class 後重新編譯 public/styles.css
npm run build:icons # 重新產生 PWA 圖示
```

`public/styles.css` 是編譯後的檔案，已一併提交，部署時不需要額外建置。
