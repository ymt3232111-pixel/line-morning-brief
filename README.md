# LINE 晨報分享工具（LIFF）

每天把 Claude 做好的晨報轉成圖片，LINE 會收到一則「今日晨報已完成」的提醒。點一下，就能一次勾選多個銀行群組分享出去。

```
晨報 HTML 放進 briefs/
      │
      ▼  GitHub Actions 自動執行
轉成圖片 → 放上 GitHub Pages → 推播提醒給「你自己」
                                      │
                                      ▼  你在 LINE 點「分享到銀行群組」
                            LIFF 頁面 → 勾選群組 → 以你本人名義送出
```

- 銀行群組**不需要**加入任何機器人。
- 推播每天只發 1 則，而且只發給你自己，免費方案的額度就夠用。
- 費用：GitHub 和 LINE 都用免費方案即可。

---

## 專案裡有什麼

| 檔案 | 用途 |
|---|---|
| `briefs/YYYY-MM-DD.html` | 每天的晨報。檔名一定要是日期，例如 `2026-10-08.html` |
| `briefs/logo.png` | 晨報用的公司 logo，放一次就好 |
| `scripts/render.mjs` | 把晨報轉成 LINE 可以傳的圖片：每個分頁一張，加上預覽圖和封面 |
| `scripts/notify.mjs` | 推一則「點此分享」的卡片到你的 LINE |
| `site/liff/index.html` | LIFF 分享頁，按鈕按下去會跳出 LINE 的群組選擇畫面 |
| `.github/workflows/daily-brief.yml` | 自動化流程，有新晨報就自動跑 |

---

## 開始前要準備

- 一個 **GitHub 帳號**（免費）：https://github.com/signup
- 你平常用的 **LINE 帳號**
- 大約 30～40 分鐘

做每一步時，把下面這幾個值記在記事本，最後都要用到：

```
GitHub 帳號名稱：
SITE_URL：
Channel access token：
Your user ID：
LIFF ID：
```

---

## 步驟 1：建立 GitHub 專案

1. 登入 GitHub，右上角 **＋ → New repository**。
2. **Repository name** 填 `line-morning-brief`。
3. 選 **Public**。免費的 GitHub Pages 只支援公開專案，請先看最後的「隱私提醒」。
4. 勾選 **Add a README file**，按 **Create repository**。
5. 上傳檔案：
   - 進到專案頁，按 **Add file → Upload files**。
   - 把這包解壓縮後的 `briefs`、`scripts`、`site` 三個資料夾，以及 `package.json`、`README.md`、`.gitignore` 拖進去，按 **Commit changes**。
   - ⚠️ `.github` 是隱藏資料夾，用拖的通常傳不上去，要另外手動建立：
     - 按 **Add file → Create new file**。
     - 檔名欄輸入 `.github/workflows/daily-brief.yml`。輸入 `/` 時會自動變成資料夾，這是正常的。
     - 把 `daily-brief.yml` 的內容整份貼上，按 **Commit changes**。

> 💡 如果你在這個對話裡連接 GitHub，我也可以直接幫你把檔案推上去，就不用手動上傳。

---

## 步驟 2：開啟 GitHub Pages

1. 在專案頁按 **Settings → Pages**。
2. **Build and deployment → Source** 選 **GitHub Actions**。
3. 記下你的網站網址，這就是 **SITE_URL**：
   ```
   https://你的GitHub帳號.github.io/line-morning-brief
   ```
   GitHub 帳號名稱請全部用小寫。

---

## 步驟 3：建立 LINE 官方帳號，開啟 Messaging API

這一步會讓「每日提醒」可以推到你的 LINE。

1. 到 LINE Official Account Manager：https://manager.line.biz/ ，用你的 LINE 帳號登入。
2. **建立 LINE 官方帳號**，名稱可以取「晨報小幫手」，類別隨意選。
3. 進入官方帳號後，點右上 **設定 → Messaging API → 啟用 Messaging API**。
4. 系統會要你選擇或建立「**服務提供者 (Provider)**」，請建一個新的，例如 `晨報`。**步驟 4 要用同一個 Provider。**
5. 到 LINE Developers Console：https://developers.line.biz/console/ ，點剛剛的 Provider，就會看到這個官方帳號的 channel。
6. 在 **Basic settings** 分頁最下面找到 **Your user ID**（U 開頭的一長串），複製下來，這是 **LINE_USER_ID**。
7. 切到 **Messaging API** 分頁：
   - 用手機 LINE 掃描頁面上的 QR code，**把官方帳號加為好友**。沒加好友就收不到推播。
   - 拉到最下面 **Channel access token (long-lived)**，按 **Issue**，複製下來，這是 **LINE_CHANNEL_ACCESS_TOKEN**。⚠️ 這串等於密碼，不要貼給任何人。
8. （選做）回到 Official Account Manager → **回應設定**，把「自動回應訊息」關掉，免得每次都跳出制式回覆。

---

## 步驟 4：建立 LIFF 分享頁

1. 在 LINE Developers Console，進入**和步驟 3 同一個 Provider**，按 **Create a new channel → LINE Login**。
   - Region 選 **Taiwan**。
   - App types 勾選 **Web app**。
   - 名稱、說明、Email 依畫面填寫，同意條款後建立。
2. 進入這個 LINE Login channel → **LIFF** 分頁 → **Add**：

   | 欄位 | 填什麼 |
   |---|---|
   | LIFF app name | `分享晨報` |
   | Size | **Full** |
   | Endpoint URL | `https://你的GitHub帳號.github.io/line-morning-brief/liff/`（**結尾要有 `/liff/`**） |
   | Scopes | 勾 **profile** 就好 |
   | Bot link feature | Off |
   | Scan QR | Off |

3. 按 **Add** 之後，列表上會出現 **LIFF ID**（像 `2001234567-AbCdEfGh`），複製下來。
4. ⚠️ **重要**：點進這個 LIFF app，找到 **shareTargetPicker** 的開關，**打開**。這個開關預設是關的，沒開的話分享按鈕不會有反應。
5. 關於 channel 狀態：LINE Login channel 預設是 **Developing**（開發中），只有你自己（管理員）能使用分享頁。只有你一個人要用的話不用改；要給同事一起用，再按 **Publish**。收到訊息的銀行群組成員不受影響。

---

## 步驟 5：把金鑰放進 GitHub

回到 GitHub 專案 → **Settings → Secrets and variables → Actions**。

**Secrets 分頁**（按 New repository secret），新增兩個：

| Name | Value |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | 步驟 3-7 的 token |
| `LINE_USER_ID` | 步驟 3-6 的 U 開頭 ID |

**Variables 分頁**（按 New repository variable），新增一個：

| Name | Value |
|---|---|
| `LIFF_ID` | 步驟 4-3 的 LIFF ID |

> 只有網站網址和預設不同時（例如你用了自訂網域），才需要再加一個 `SITE_URL` variable。

---

## 步驟 6：第一次測試

1. GitHub 專案 → **Actions** 分頁。第一次進去如果看到提示，按 **I understand… enable them**。
2. 左邊點 **Daily brief** → 右邊 **Run workflow** → 直接按綠色 **Run workflow**。
3. 等 2～4 分鐘，全部打勾就完成了。如果出現紅叉，點進去看錯誤訊息，對照下面的「疑難排解」。
4. 你的 LINE 會收到官方帳號傳來的卡片：「每日晨報（測試範例）」。
5. 點 **分享到銀行群組** → 會打開分享頁 → 按 **選擇群組並分享** → 勾選群組 → 送出。

👉 建議先建一個只有你自己的測試群組來試，確認沒問題再分享到真正的銀行群組。

---

## 步驟 7：每天的使用方式

每天只要把當天的晨報 HTML 放進 `briefs/`，檔名用日期，例如 `briefs/2026-10-09.html`，後面就會自動跑：轉圖 → 上線 → 推播提醒給你。

放檔案的方式有兩種：

- **手動**：在 Claude 做好晨報後下載 HTML → 到 GitHub 的 `briefs` 資料夾 → **Add file → Upload files** → 確認檔名是日期 → Commit。
- **全自動**：讓 Claude 用排程任務每天早上自動做晨報，並直接放進 `briefs/`。這需要你的 GitHub 專案連到 Claude，設定好後告訴我，我幫你建排程。

`briefs/` 裡已經放了 10/8 的「全球股債匯行情快搜」和公司 logo（`briefs/logo.png`），第一次測試就是用這份。之後每天只要放當天的 HTML，logo 不用重放。

### 轉圖規則（已針對你的晨報調好）

- **分頁自動拆圖**：「行情快搜」和「焦點新聞」會各轉成一張圖，分享時一次送出：文字 1 則加圖片 2 張。
- **寬度自動調整**：表格多寬就把版面撐多寬，你的晨報目前是 856px，輸出 1712px 高清圖，群組成員點開放大也看得清楚。
- **固定淺色模式**：就算你的電腦或手機開了深色模式，圖片還是固定白底。
- **分頁按鈕會自動藏起來**：圖片上不能點，所以不顯示。
- 檔案裡的 `<title>`（例如「全球行情 2026-10-08」）會變成提醒卡片和分享頁的標題。
- 圖片上的「閱讀原文」連結無法點擊。需要給連結的話，可以在分享頁的附帶文字裡貼上。

---

## 疑難排解

| 狀況 | 原因與解法 |
|---|---|
| 分享頁顯示「載入失敗：讀不到 config.json」 | 還沒成功跑過一次 Actions，或 `LIFF_ID` variable 沒設。設好後重跑步驟 6。 |
| 分享按鈕灰色，提示「不能分享」 | 步驟 4-4 的 **shareTargetPicker** 開關沒打開，或是用電腦瀏覽器開的。請在手機 LINE 裡開啟。 |
| 開分享頁出現 400 / 錯誤畫面 | LIFF 的 Endpoint URL 打錯，要跟 SITE_URL 一致，結尾是 `/liff/`。 |
| 沒收到 LINE 提醒，Actions 顯示 400 | 還沒把官方帳號加好友，或 `LINE_USER_ID` 貼錯（要用 Messaging API channel 頁面上的 Your user ID）。 |
| Actions 顯示 401 | Channel access token 錯誤，重新 Issue 一次後更新 Secret。 |
| Actions 顯示 429 | 當月訊息額度用完了。正常每天 1 則不會碰到。 |
| 群組裡的圖片是破圖 | 網站還沒部署完成。腳本會先等圖片上線才推播；如果還是破圖，確認步驟 2 的 Source 選的是 GitHub Actions。 |
| 圖片中文字變成方塊 | 晨報用了特殊字型。流程已經安裝 Noto CJK 中文字型，晨報 CSS 裡可以加上 `font-family: "Noto Sans CJK TC", sans-serif;`。 |
| Actions 卡在部署步驟，顯示 environment 保護規則錯誤 | Settings → Environments → github-pages，把 Deployment branches 設為允許 `main`。 |

---

## 隱私提醒（請務必看）

免費的 GitHub Pages 需要**公開專案**。這代表：

- 晨報 HTML 和產生的圖片，任何人都**看得到**。知道網址的人可以直接打開，在 GitHub 上也搜得到你的專案。
- LINE 的金鑰放在 Secrets 裡，是**安全的**，不會公開。

你的晨報是公開市場資訊整理，這樣沒問題。如果內容含有**客戶資料、內部報價、未公開資訊**，請不要用公開專案，可以改用以下方式：

- GitHub Pro（付費）的私人專案 + Pages
- Cloudflare R2 或 Firebase Storage 這類私人儲存空間

需要的話我可以幫你改成其他版本。

金融相關資訊分享到銀行群組前，也建議確認符合貴公司的合規規範。圖卡底部保留「資料來源」和「僅供參考」的說明。
