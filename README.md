# Tumblr Restore Tool

這是一個幫助你從 Tumblr 文章中提取並下載圖片與影片的本地工具。

## 如何使用

1. **安裝依賴** (如果您是第一次執行)：
   ```bash
   npm install
   ```

2. **啟動伺服器**：
   ```bash
   npm start
   ```

3. **開啟瀏覽器**：
   前往 `http://localhost:3000`

4. **下載媒體**：
   將 Tumblr 文章網址貼入輸入框，點擊「解析網址」，然後點擊「下載所有媒體」。
   下載的檔案會存放在專案目錄下的 `downloads/` 資料夾中。

## 技術棧
- **後端**: Node.js, Express, Axios, Cheerio
- **前端**: Vanilla JS, CSS (Glassmorphism design)
- **下載**: 使用 `stream/promises` 確保大檔案下載穩定性
